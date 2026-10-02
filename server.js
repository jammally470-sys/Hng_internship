require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
const { Pool } = require('pg');

const required = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SUPABASE_DATABASE_PASSWORD',
  'SUPABASE_DATABASE_CONNECTION_STRING',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/auth/google/callback`;
const production = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');

if (production && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be configured in production.');
}
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is unset; using a temporary secret for this local run.');
}

const google = new OAuth2Client({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri,
});

const databaseUrl = new URL(process.env.SUPABASE_DATABASE_CONNECTION_STRING);
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
  throw new Error('SUPABASE_DATABASE_CONNECTION_STRING must use the PostgreSQL protocol.');
}
// The separate password env value wins and is URL-encoded safely, including reserved characters.
databaseUrl.password = process.env.SUPABASE_DATABASE_PASSWORD;
let databaseSsl;
if (process.env.SUPABASE_DATABASE_SSL_CA) {
  databaseSsl = {
    ca: fs.readFileSync(path.resolve(__dirname, process.env.SUPABASE_DATABASE_SSL_CA), 'utf8'),
    rejectUnauthorized: true,
  };
} else if (production) {
  throw new Error('Set SUPABASE_DATABASE_SSL_CA to the Supabase CA certificate in production.');
} else {
  // Supabase's require-style TLS encrypts local development traffic without validating the server certificate.
  databaseSsl = { rejectUnauthorized: false };
  console.warn('[Supabase] local TLS is encrypted; set SUPABASE_DATABASE_SSL_CA to verify the server certificate.');
}
const database = new Pool({
  connectionString: databaseUrl.toString(),
  ssl: databaseSsl,
  max: 5,
  connectionTimeoutMillis: 10000,
});

const app = express();
app.disable('x-powered-by');
app.use(session({
  name: 'coretech.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.get(['/', '/gemini.html'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'gemini.html'));
});

app.get('/auth/google', (req, res) => {
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  req.session.oauthState = state;
  req.session.oauthNonce = nonce;

  res.redirect(google.generateAuthUrl({
    access_type: 'online',
    include_granted_scopes: true,
    prompt: 'select_account',
    response_type: 'code',
    scope: ['openid', 'email', 'profile'],
    state,
    nonce,
  }));
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = req.session.oauthState;
  const expectedNonce = req.session.oauthNonce;
  delete req.session.oauthState;
  delete req.session.oauthNonce;

  if (error) return res.redirect('/?auth_error=cancelled');
  if (typeof code !== 'string' || typeof state !== 'string' || !expectedState || state !== expectedState || !expectedNonce) {
    return res.redirect('/?auth_error=state_mismatch');
  }

  let stage = 'token_exchange';
  try {
    const { tokens } = await google.getToken(code);
    if (!tokens.id_token) throw new Error('Google did not return an ID token.');

    // verifyIdToken checks Google's signature, issuer, expiration, and this app's audience.
    stage = 'id_token_verification';
    const ticket = await google.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    stage = 'identity_claim_validation';
    const claims = ticket.getPayload();
    if (!claims || claims.nonce !== expectedNonce || !claims.sub || !claims.email || claims.email_verified !== true) {
      throw new Error('Google identity claims did not pass validation.');
    }

    stage = 'database_upsert';
    await database.query(`
      INSERT INTO public.users
        (google_sub, email, name, picture_url, email_verified, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (google_sub) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        picture_url = EXCLUDED.picture_url,
        email_verified = EXCLUDED.email_verified,
        updated_at = NOW()
    `, [claims.sub, claims.email, claims.name || claims.email, claims.picture || null, claims.email_verified]);

    const user = {
      id: claims.sub,
      email: claims.email,
      name: claims.name || claims.email,
      picture: claims.picture || null,
    };

    // Rotate the session ID after authentication to prevent session fixation.
    stage = 'session_rotation';
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => err ? reject(err) : resolve());
    });
    req.session.user = user;
    stage = 'session_save';
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
    return res.redirect('/?signed_in=1');
  } catch (err) {
    // Log only allowlisted diagnostic fields. Never log codes, tokens, secrets, or response bodies.
    const providerError = err?.response?.data?.error;
    const safeProviderError = typeof providerError === 'string' && /^[a-z0-9_-]{1,40}$/i.test(providerError)
      ? providerError
      : 'none';
    const safeNetworkCode = typeof err?.code === 'string' && /^[a-z0-9_-]{1,40}$/i.test(err.code)
      ? err.code
      : 'none';
    const httpStatus = Number.isInteger(err?.response?.status) ? err.response.status : 'none';
    const authError = safeProviderError === 'invalid_client'
      ? 'invalid_client'
      : safeProviderError === 'invalid_grant'
        ? 'invalid_grant'
        : stage === 'id_token_verification'
          ? 'invalid_id_token'
        : stage === 'identity_claim_validation'
          ? 'invalid_identity'
          : stage === 'database_upsert'
            ? 'database_error'
          : 'server_error';
    console.error(`[Google OAuth] stage=${stage} http=${httpStatus} provider=${safeProviderError} network=${safeNetworkCode}`);
    return res.redirect(`/?auth_error=${authError}`);
  }
});

app.get('/api/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.session.user || null });
});

app.post('/auth/logout', (req, res) => {
  if (!req.session) return res.sendStatus(204);
  req.session.destroy(() => {
    res.clearCookie('coretech.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: production,
      path: '/',
    });
    res.sendStatus(204);
  });
});

app.use((_req, res) => res.sendStatus(404));

app.listen(port, host, () => {
  const displayHost = host === '127.0.0.1' ? 'localhost' : host;
  console.log(`Coretech is running at http://${displayHost}:${port}`);
  console.log(`Google OAuth callback: ${redirectUri}`);
});

process.on('SIGTERM', () => {
  database.end().finally(() => process.exit(0));
});

require('dotenv').config();

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

function makePool() {
  const connectionString = process.env.SUPABASE_DATABASE_CONNECTION_STRING;
  const password = process.env.SUPABASE_DATABASE_PASSWORD;
  if (!connectionString || !password) {
    throw new Error('Set SUPABASE_DATABASE_CONNECTION_STRING and SUPABASE_DATABASE_PASSWORD in .env.');
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error('SUPABASE_DATABASE_CONNECTION_STRING must be a PostgreSQL connection URI.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('SUPABASE_DATABASE_CONNECTION_STRING must use the PostgreSQL protocol.');
  }

  // Set the password separately so reserved characters are safely URI-encoded.
  databaseUrl.password = password;
  let ssl;
  if (process.env.SUPABASE_DATABASE_SSL_CA) {
    ssl = {
      ca: fsSync.readFileSync(path.resolve(__dirname, '..', process.env.SUPABASE_DATABASE_SSL_CA), 'utf8'),
      rejectUnauthorized: true,
    };
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('Set SUPABASE_DATABASE_SSL_CA to the Supabase CA certificate in production.');
  } else {
    // Supabase's require-style TLS encrypts local development traffic without validating the server certificate.
    ssl = { rejectUnauthorized: false };
    console.warn('[Supabase] local TLS is encrypted; set SUPABASE_DATABASE_SSL_CA to verify the server certificate.');
  }
  return new Pool({
    connectionString: databaseUrl.toString(),
    ssl,
    max: 2,
    connectionTimeoutMillis: 10000,
  });
}

async function main() {
  const pool = makePool();
  try {
    const existing = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `);
    const existingColumns = new Set(existing.rows.map((row) => row.column_name));
    const requiredColumns = ['google_sub', 'email', 'name', 'picture_url', 'email_verified', 'created_at', 'updated_at'];

    if (existingColumns.size > 0) {
      const missingColumns = requiredColumns.filter((column) => !existingColumns.has(column));
      if (missingColumns.length) {
        throw new Error(`public.users already exists but is missing required columns: ${missingColumns.join(', ')}`);
      }
      console.log('Supabase table public.users already has the required columns.');
      return;
    }

    const schema = await fs.readFile(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
    await pool.query(schema);

    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `);
    const columns = new Set(result.rows.map((row) => row.column_name));
    const missingColumns = requiredColumns.filter((column) => !columns.has(column));
    if (missingColumns.length) {
      throw new Error(`public.users exists but is missing required columns: ${missingColumns.join(', ')}`);
    }

    console.log('Supabase table public.users is ready.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const code = typeof error?.code === 'string' && /^[a-z0-9_-]{1,40}$/i.test(error.code)
    ? error.code
    : 'setup_failed';
  const safeMessage = code === 'setup_failed' ? error.message : '';
  console.error(`[Supabase setup] ${code}${safeMessage ? `: ${safeMessage}` : ''}`);
  process.exitCode = 1;
});

# Coretech by Jamal

This storefront serves `gemini.html` through a small Node.js server so Google sign-in and Supabase database credentials stay on the server.

## Run locally

1. Install Node.js 20 or newer.
2. Keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_DATABASE_PASSWORD`, and `SUPABASE_DATABASE_CONNECTION_STRING` in the root `.env` file. The server never sends these values to the browser.
   For local development, database traffic uses encrypted TLS. To verify the server certificate, download the CA certificate from Supabase **Database settings → SSL Configuration**, save it as `supabase/prod-supabase.cer`, and set `SUPABASE_DATABASE_SSL_CA=supabase/prod-supabase.cer` in `.env`. In production, set `SUPABASE_DATABASE_SSL_CA` to the full PEM certificate contents in your host's environment settings, or point it to a certificate file included with the deployed app. The server verifies the certificate in either case.
3. In the Google Cloud OAuth client settings, add this exact authorized redirect URI:

   `http://localhost:3000/auth/google/callback`

4. Install the dependencies and start the site:

   ```sh
   npm install
   npm run db:setup
   npm start
   ```

5. Open `http://localhost:3000` and choose **Sign in → Continue with Google**.

`npm run db:setup` creates `public.users` (with row-level security enabled) if it does not exist. On each successful Google sign-in, the server upserts the verified Google subject, email, name, and profile image URL into that table. Repeated sign-ins update the existing row.

The app requests only the OpenID Connect `openid`, `email`, and `profile` scopes. It checks OAuth state, validates the Google ID token and nonce on the server, saves the profile in Supabase, then stores the session in an HTTP-only cookie.

## Deployment

Set `GOOGLE_REDIRECT_URI` to the HTTPS callback URL and register that exact URL in Google Cloud. Configure a long random `SESSION_SECRET`, set `NODE_ENV=production`, and serve behind HTTPS. The default Express session store is in-memory for local UI development; use a persistent session store before running multiple production instances. `.env` is ignored by Git; share `.env.example` without placing real credentials in it.

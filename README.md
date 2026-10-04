# Coretech by Jamal

This storefront serves `gemini.html` through a small Node.js server so Google sign-in and Supabase database credentials stay on the server.

## Run locally

1. Install Node.js 20 or newer.
2. Keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_DATABASE_PASSWORD`, and `SUPABASE_DATABASE_CONNECTION_STRING` in the root `.env` file. The server never sends these values to the browser.
   This app connects to Supabase Postgres without TLS. Supabase must allow non-SSL database connections; if SSL enforcement is enabled in the Supabase dashboard, this app will fail to connect. Database credentials and traffic are not encrypted in transit.
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

For Render, use `npm install` as the build command and `npm start` as the start command. The server binds to `0.0.0.0`, reads Render's `PORT`, and trusts Render's proxy in production so secure session cookies work over HTTPS. If `GOOGLE_REDIRECT_URI` is unset or points to localhost, the app uses Render's `RENDER_EXTERNAL_URL` to build its callback URL.

Add `https://<your-service>.onrender.com/auth/google/callback` to the authorized redirect URIs in your Google Cloud OAuth client. If you use a custom domain, set `GOOGLE_REDIRECT_URI` to that domain's HTTPS callback and authorize that exact URI instead.

Set a long random `SESSION_SECRET` and keep credentials in Render environment settings. The default Express session store is in-memory; use a persistent session store before running multiple production instances. `.env` is ignored by Git; share `.env.example` without placing real credentials in it.

# Coretech by Jamal

This storefront opens from `public/index.html`. Netlify serves the public directory directly, without requiring a Node.js backend or database credentials just to browse the catalog. The original `gemini.html` file opens the same page when double-clicked.

## Open the storefront

Open `gemini.html` or `public/index.html` in a browser and choose **Browse as guest**. An internet connection is needed for the hosted styles, fonts, and product images.

For a local Netlify preview, run `netlify dev --port 8889` and open `http://localhost:8889`. On Netlify, the site opens at its root URL automatically. Only files in `public` are published; server code and private configuration are not served.

Guest browsing does not create an account. Google sign-in still requires the existing Node.js backend described below; the static Netlify preview does not run that backend. When it is unavailable, the page explains this instead of navigating to a missing sign-in route.

## Run locally

1. Install Node.js 20 or newer.
2. Keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_DATABASE_PASSWORD`, and `SUPABASE_DATABASE_CONNECTION_STRING` in the root `.env` file. The server never sends these values to the browser.
   For local development, database traffic uses encrypted TLS. To verify the server certificate, download the CA certificate from Supabase **Database settings → SSL Configuration**, save it as `supabase/prod-supabase.cer`, and set `SUPABASE_DATABASE_SSL_CA=supabase/prod-supabase.cer` in `.env`. This CA setting is required for production.
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

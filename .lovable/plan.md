# Google sign-in: current state and steps to turn it on

## Answers (checked read-only)

1. **Is it on now?** No. The live auth settings show only `email: true`. Google is off, so the current button would get "provider is not enabled".
2. **Can it run on managed credentials?** Yes. Running `supabase--configure_social_auth` with `providers: ["google"]` turns on Google with Lovable's managed credentials. The owner doesn't need any Google Cloud setup. The same step creates `src/integrations/lovable/` and installs `@lovable.dev/cloud-auth-js`. Neither exists in the repo yet.
3. **Does `supabase.auth.signInWithOAuth` work as-is?** No. With managed credentials, sign-in has to go through Lovable's helper, which runs the managed broker (`/~oauth`). Calling Supabase directly needs the owner's own Google client ID and secret (BYOK).

## Exact client call

```ts
import { lovable } from "@/integrations/lovable/index";

const result = await lovable.auth.signInWithOAuth("google", {
  redirect_uri: `${window.location.origin}/auth`, // public same-origin page
});
if (result.error) { /* show the existing Spanish error */ }
if (result.redirected) return;  // browser leaves for Google
// otherwise the session is already set (popup in the editor preview)
```

- Keep `?next=` out of `redirect_uri`. Save the internal path in `sessionStorage` and go there once `/auth` sees the session through `onAuthStateChange` or `getSession`.
- `/auth` is public, so it's a valid return page.

## Redirect URLs

The live allow list already includes `https://traveliatos.life/**`, `https://www.traveliatos.life/**`, `https://iatos-ai.lovable.app/**` and the preview hosts. Nothing to add. Site URL is `https://iatos-ai.lovable.app`. Managed sign-in on custom domains goes through `/~oauth` on the same domain, so `traveliatos.life` works as long as the domain stays active.

## VITE_GOOGLE_LOGIN_ENABLED in the published build

`VITE_*` values are set when the build runs. `.env` is auto-generated and can't be edited, and Lovable's Secrets don't reach the frontend build. Options:
- (Recommended) Commit a non-secret default in code, for example treat a missing flag as `true` in `googleLoginEnabled()`, then republish.
- Or set `VITE_GOOGLE_LOGIN_ENABLED=true` in whatever external CI builds the site, if the site is hosted outside Lovable.

## Steps once approved

1. Run `supabase--configure_social_auth` with `["google"]`. This turns on the provider and generates the helper module.
2. Rewrite `startGoogleLogin()` in `src/lib/googleLogin.ts` to use `lovable.auth.signInWithOAuth`, and keep `next` in `sessionStorage`.
3. Turn the flag on through the default in code.
4. Update the existing tests for `googleLogin`, run them, then check the button in the preview.

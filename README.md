# Reframe

A mobile-first chat and 3D camera for AI image generation. Send a description, a reference image, or both from the floating composer. Reframe replies with an **Open Studio** card. Frame up to four shots in the full-screen Three.js studio, add visual direction, and send the captured compositions back as a user message. Generated photographs arrive as the next assistant reply.

## OpenRouter free models (default)

The default app on GitHub Pages and new Render builds uses **OpenRouter**. Open **Account → Continue with OpenRouter**, sign in and authorize Reframe in the OpenRouter window, then return to the app. You can also send your first prompt and sign in when asked; the request resumes after connection. **Use an API key instead** remains available as an optional alternative.

Sign-in uses OpenRouter’s authorization-code exchange with S256 PKCE and a random callback state. A dedicated `auth.html` return page works at both the site root and the GitHub Pages `/Reframe/` path. The generated app-specific key and PKCE verifier stay only in tab memory; no localStorage, sessionStorage, or backend credential storage is used. **Disconnect** or reload clears the key from Reframe without clearing the conversation on disconnect. To revoke the provider-side key, use [OpenRouter settings](https://openrouter.ai/settings/keys). Sign-in opens a separate window or tab so the current chat, attachments and studio frames remain intact; allow that window if your browser blocks it.

Reframe checks OpenRouter's current model catalog in the browser. It selects a concrete `:free` model only when all listed prices are zero and no conditional pricing is present. Requests disable provider fallback and specify zero maximum prompt, completion, image and request prices. The app does not use paid fallbacks or promotional discounts. Free-provider availability, account settings and usage limits still apply.

The two stages have separate capability requirements:

- **3D scene:** text output, with image input support when a reference is attached. The response must pass the existing geometry/schema validation.
- **Final photographs:** both image input and image output. Captured composition, product reference, notes and target ratio are sent together. A text-only answer is never shown as an image.

**A compatible free image-generation model is not guaranteed to exist.** The app checks this upfront, reports unavailable photo generation, and preserves the studio frames. Account → **Refresh availability** checks again. The app does not claim the complete workflow is free unless compatible models are available for both stages.

The live catalog and generation endpoint were blocked from the development workspace. The integration is verified with the official OpenRouter SDK's request/response definitions and fixture tests; live authorization, model availability, quality and account entitlement remain unverified. The authorization tests simulate OpenRouter’s redirect and key exchange; physical iOS sign-in still needs a device trial. No real user key is included in the repository.

## Deploy on Render

[Deploy Reframe on Render](https://render.com/deploy?repo=https://github.com/raagulmanoharan/Reframe)

The repository includes a `render.yaml` Blueprint for one **free** Docker web service. Select this repository and `main`, and deploy the Blueprint. The same service serves the interface and its backend. No shared provider key, database, or paid disk is required for this deployment. The default interface uses each visitor’s OpenRouter key as described above.

The previous ChatGPT integration is still available as an opt-in build with `--build-arg VITE_AI_MODE=chatgpt`. In that build:

1. Select **Continue with ChatGPT**. Open the OpenAI sign-in link, enter the displayed code, and return to Reframe. OpenAI may require enabling device code sign-in in ChatGPT security settings. This is device-code authentication, not a Google-style OAuth redirect.
2. Type a scene, add an image with **+**, or both, then use the up-arrow **Send message** button.
3. Select **Open Studio** on the response card. The studio fills the browser viewport on phones and desktops.
4. Orbit, zoom and pan. **Move objects** lets you tap and drag individual shapes across the ground, adjust their height, and undo movement.
5. Add an optional text note and capture up to **four frames**. Each frame snapshots the edited geometry, camera, reference, and note. Restoring a draft frame lets you edit its note; subsequent scene edits do not mutate its captured composition.
6. Select **Let’s Go**. The captured frames and notes appear as your next chat message, followed by an assistant image reply with individual **Save** links. If a batch fails partway through, completed images remain available and retry generates only unfinished frames.

Earlier studio cards retain their scenes and captured frames during this tab session. Image retries retain the submitted prompt, reference, compositions and notes even after another scene is created. The top-left **New chat** button asks before clearing the conversation; download images before starting over or reloading. The interface uses translucent surfaces, a bottom composer and responsive chat cards; physical iOS keyboard behavior still needs a device trial.

This integration uses the official Codex app-server (`@openai/codex` pinned to `0.163.0`) and its `chatgptDeviceCode` login, structured scene output, and image-generation tool. A ChatGPT account with appropriate Codex/image access and remaining usage is required. **Live sign-in and image generation still need an end-to-end account test; protocol and fixture tests do not verify account entitlement.** There is no simulated production output.

The free service can sleep when idle; allow time for the first request after inactivity. Sign-in clears on service restart, sign-out, or 30 minutes without app activity. This POC admits up to four concurrent browser sessions and one generation per session. Photos remain in the tab; download them before reloading.

Each browser session gets a separate Codex process with an in-memory credential store. Session cookies are HttpOnly, Secure in production, and SameSite=Strict. The server exposes fixed application routes, not the Codex RPC interface. Generation threads are ephemeral, have no execution environments or filesystem tools, and cannot approve tool requests. Input images are supplied as conversation images, not arbitrary filesystem paths. Generated artifacts and session working directories are cleaned up. Prompt/reference data goes through this server to OpenAI; provider data handling still applies.

## Run the Render version locally

The default container serves the OpenRouter interface. To build the optional ChatGPT interface, pass `--build-arg VITE_AI_MODE=chatgpt`. Keep that integration in its dedicated container so it cannot read or alter existing developer/agent Codex configuration:

```sh
docker build -t reframe .
docker run --rm -p 3000:3000 -e NODE_ENV=development reframe
```

The health endpoint is `/api/health`. In a managed environment, follow its Docker proxy/CA guidance and pass the `proxy_ca` build secret when needed. Do not mount host credential directories or add shared provider credentials to this container.

## Optional direct OpenAI version

Set `VITE_AI_MODE=openai` for the development server or production build to retain the earlier direct OpenAI API-key version. It uses `gpt-4.1-mini` for scenes and `gpt-image-1` for photographs; these are paid API requests. This mode is not the default and is never a fallback from OpenRouter. GitHub Pages now builds the default OpenRouter version.

## Run the static version

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

`npm run build` produces `dist/`; `npm run preview` serves it. No backend, environment variables, Vercel token, or shared API key is required. Do not put provider keys into source, GitHub Actions variables, or `VITE_*` variables. The interface accepts each user's key at runtime.

## Boundaries

- Generated scenes approximate product references with low-poly primitives; this is not mesh reconstruction.
- Object movement edits individual primitive shapes, not an automatically grouped product mesh. Notes are text annotations attached to a frame, not a drawing layer.
- Image generation is guided by the captured view but may alter composition or product details. Review outputs before commercial use.
- The optional direct OpenAI version explicitly requests high image quality and high input fidelity. The ChatGPT version asks for the highest available detail; Codex's image tool controls the actual quality and output resolution automatically.
- In the optional direct OpenAI version, GPT Image returns square, landscape, or portrait sizes. Exported AI photo aspect ratios can differ from the selected draft ratio; the app preserves the original output without cropping it.
- References are resized to 1024 px for upload. Shots and keys clear on reload. OpenRouter output resolution and image quality depend on the selected free model; spatial adherence is still guidance, not a guarantee.
- OpenRouter is the default for Pages and Render. The optional ChatGPT build uses the isolated session backend described above. An OpenRouter key does not use ChatGPT subscription access.

## Verification

```sh
npm run test:unit
npm test
npm run test:hosted
npm run test:openrouter
npm run build
```

OpenRouter tests check PKCE/state validation, callback delivery, pending-request continuation, cancellation, popup blocking, disconnect, free-price guards, modality selection, ordered composition/reference inputs, provider failures, chat rendering, downloads, unavailable free photo generation and recovery. Unit tests also check scene validation, image-only inputs, frame notes, provider requests, session/job isolation, CSRF protection, request limits, sign-out, and error handling. Browser tests intercept provider/backend responses with explicit fixtures to exercise both sign-in interfaces, chat message ordering, retained studio cards, full-screen studio layout, camera movement, object dragging/height/undo, immutable frame snapshots, the four-frame limit, notes, downloads, retries across chat turns, and new-chat cancellation/reset. These fixtures are not bundled into the app. Live provider checks require an authorized account.

Playwright uses `/usr/bin/chromium` by default; set `CHROMIUM_PATH` if needed. Tests start Vite automatically. Physical multitouch ergonomics still need a device trial.

## GitHub Pages

The Pages workflow builds and deploys `main` automatically. Vite uses relative asset URLs so the app works under `/Reframe/`. Select **GitHub Actions** in Settings → Pages. Subsequent pushes deploy automatically.

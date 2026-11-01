# Reframe

A mobile-first chat and 3D camera for AI image generation. Send a description, a reference image, or both from the floating composer. Reframe replies with an **Open Studio** card. Frame up to four shots in the full-screen Three.js studio, add visual direction, and send the captured compositions back as a user message. Generated photographs arrive as the next assistant reply.

## OpenRouter free models (default)

The default app on GitHub Pages and new Render builds uses **OpenRouter**. Open **Account → Continue with OpenRouter**, sign in and authorize Reframe in the OpenRouter window, then return to the app. You can also send your first prompt and sign in when asked; the request resumes after connection. **Use an API key instead** remains available as an optional alternative.

Sign-in uses OpenRouter’s authorization-code exchange with S256 PKCE and a random callback state. A dedicated `auth.html` return page works at both the site root and the GitHub Pages `/Reframe/` path. The generated app-specific key and PKCE verifier stay only in tab memory; no localStorage, sessionStorage, or backend credential storage is used. **Disconnect** or reload clears the key from Reframe without clearing the conversation on disconnect. To revoke the provider-side key, use [OpenRouter settings](https://openrouter.ai/settings/keys). Sign-in opens a separate window or tab so the current chat, attachments and studio frames remain intact; allow that window if your browser blocks it.

Reframe checks OpenRouter's current model catalog in the browser. It selects a concrete `:free` model only when all listed prices are zero and no conditional pricing is present. Requests disable provider fallback and specify zero maximum prompt, completion, image and request prices. The app does not use paid fallbacks or promotional discounts. Free-provider availability, account settings and usage limits still apply.

Scene generation develops a concise visual design brief and geometry in one structured response. Instructions expand an underspecified setting while preserving explicit counts, minimal scenes and reference-product identity. The app prefers a free reasoning-capable model and requests medium effort (or low/minimal when advertised). A free non-reasoning model can still use the same design contract. It requests up to 64 part definitions, with validated linear repetition for details such as chair slats, railings and supports, capped at 96 expanded parts. Rounded boxes, capsules, smooth curved surfaces and per-part roughness/metalness support more recognizable construction and materials. Complete objects remain grouped for editing.

The response budget adapts to advertised completion capacity, reserving space for reasoning and geometry. Incomplete or invalid output can retry once with a more compact scene (up to 32 definitions) and another eligible free model. No truncated geometry or placeholder scene is silently substituted. The original prompt and reference remain unchanged. Authentication errors, rate limits and refusals do not automatically retry. Catalog lookup, requests and response reading share a 120-second deadline, with a 75-second limit per attempt; **Stop** cancels the request. More detailed scenes can take longer. Free-provider throughput and quality remain variable.

The expanded design brief is captured with each frame and passed to photo generation as visual context. The edited composition, original request, reference and frame notes take precedence over that brief. This improves available guidance; it does not guarantee that an image model will obey geometry. This version builds the scene locally in Three.js. It does **not** run Blender: GitHub Pages cannot run a Blender worker, which would require a separate server.

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
4. Tap or click an object to select it, then drag it to move the whole object. A first drag on an unselected object or empty space orbits the camera. Pinch the selected object, or hover and drag its edges/corners, to resize it uniformly while keeping its base in place. Pinch outside the selection or scroll to zoom the camera; tap empty space to deselect. Each drag or pinch is one undo step. Resize handles also accept arrow keys. Height and Size sliders are removed; there are no camera/move mode buttons.
5. Add an optional text note and capture up to **four frames**. Each frame snapshots the edited geometry, camera, lens zoom, focus, blur, reference, and note. Restoring a draft frame lets you edit its note; subsequent scene edits do not mutate its captured composition.
6. Select **Let’s Go**. The captured frames and notes appear as your next chat message, followed by an assistant image reply with individual **Save** links. If a batch fails partway through, completed images remain available and retry generates only unfinished frames.

**Camera settings** opens three controls: lens zoom (0.5–3×), focus distance, and depth-of-field blur (off to strong). Tapping an object selects it and focuses at the tapped surface without moving it; a subsequent drag moves the selected object. Focus follows that point as the object or camera moves. The focus slider sets a manual plane instead. Pinch outside the selection or scroll to move the camera; lens zoom changes its field of view. Reset camera also resets these settings. Focus distances are relative scene units, not real-world meters.

The live depth-of-field preview uses a Three.js depth pass and bokeh shader, capped at 900 px with full 1024 px captures. It renders only when the view changes, and skips post-processing when blur is off. Each captured frame restores its own lens settings; additions preserve them. The captured blur and explicit camera instructions are sent to every supported image provider. This is approximate pre-visualization, not a calibrated optical simulation or a guarantee that an image model will reproduce the exact blur.

**Add element** opens a short description field. **Place node** inserts a clearly labeled placeholder that you can move and resize. **Regenerate** asks the same free scene provider for only that element, fits it into the placeholder, and preserves existing geometry and the camera. Captured frames remain immutable. A failed request keeps the placeholder available for retry; **Stop regeneration** cancels an OpenRouter request, and **Remove placeholder** discards the pending addition. Add one element at a time. The complete scene is bounded to 96 primitives; additions reserve up to 32.

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
- The AI assigns parts to named objects (for example, all sofa cushions and legs belong to Sofa). Selecting any part moves the entire object. Old snapshots without groups move as one unit; regenerate them to get separate objects. Notes are text annotations attached to a frame, not a drawing layer.
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

OpenRouter tests also reproduce truncated output, bounded retries, bounded part repetition and design-brief validation, semantic grouping, model capacity selection, reasoning settings, cancellation and response-body timeouts. They check PKCE/state validation, callback delivery, pending-request continuation, cancellation, popup blocking, disconnect, free-price guards, modality selection, ordered composition/reference inputs, provider failures, chat rendering, downloads, unavailable free photo generation and recovery. Unit tests also check scene validation, image-only inputs, frame notes, provider requests, session/job isolation, CSRF protection, request limits, sign-out, and error handling. Browser tests intercept provider/backend responses with explicit fixtures to exercise both sign-in interfaces, chat message ordering, retained studio cards, full-screen studio layout, camera movement, depth-dependent focus using rendered pixel sharpness, tap-to-focus tracking, per-frame lens restoration and provider instructions, selection-before-movement, native pinch resizing versus camera zoom, pointer cancellation, desktop edge resizing, grounded scaling and one-step undo, in-place additions and retry/cancellation, immutable frame snapshots, the four-frame limit, notes, downloads, retries across chat turns, and new-chat cancellation/reset. These fixtures are not bundled into the app. Live provider checks require an authorized account.

Playwright uses `/usr/bin/chromium` by default; set `CHROMIUM_PATH` if needed. Tests start Vite automatically. Physical multitouch ergonomics still need a device trial.

## GitHub Pages

The Pages workflow builds and deploys `main` automatically. Vite uses relative asset URLs so the app works under `/Reframe/`. Select **GitHub Actions** in Settings → Pages. Subsequent pushes deploy automatically.

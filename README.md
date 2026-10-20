# Reframe

A mobile-first 3D camera for AI image generation. Describe any scene and optionally upload a product reference. OpenAI generates a structured layout of primitives; Three.js renders it as a navigable low-poly scene. Frame a shot while seated, then generate a photograph from that exact captured composition and reference.

## Deploy on Render

[Deploy Reframe on Render](https://render.com/deploy?repo=https://github.com/raagulmanoharan/Reframe)

The repository includes a `render.yaml` Blueprint for one **free** Docker web service. Select this repository and `main`, and deploy the Blueprint. The same service serves the interface and its backend. No OpenAI API key, Vercel key, database, or paid disk is required for this deployment.

On the Render app:

1. Describe the scene and tap **Create scene**.
2. Select **Sign in with ChatGPT**. Open the OpenAI sign-in link, enter the displayed code, and return to Reframe. OpenAI may require enabling device code sign-in in ChatGPT security settings.
3. Orbit, zoom and pan to frame the scene. Capture a shot, then **Generate photos**.

This integration uses the official Codex app-server (`@openai/codex` pinned to `0.163.0`) and its `chatgptDeviceCode` login, structured scene output, and image-generation tool. A ChatGPT account with appropriate Codex/image access and remaining usage is required. **Live sign-in and image generation still need an end-to-end account test; protocol and fixture tests do not verify account entitlement.** There is no simulated production output.

The free service can sleep when idle; allow time for the first request after inactivity. Sign-in clears on service restart, sign-out, or 30 minutes without app activity. This POC admits up to four concurrent browser sessions and one generation per session. Photos remain in the tab; download them before reloading.

Each browser session gets a separate Codex process with an in-memory credential store. Session cookies are HttpOnly, Secure in production, and SameSite=Strict. The server exposes fixed application routes, not the Codex RPC interface. Generation threads are ephemeral, have no execution environments or filesystem tools, and cannot approve tool requests. Input images are supplied as conversation images, not arbitrary filesystem paths. Generated artifacts and session working directories are cleaned up. Prompt/reference data goes through this server to OpenAI; provider data handling still applies.

## Run the Render version locally

Use the container so it cannot read or alter an existing developer/agent Codex configuration:

```sh
docker build -t reframe .
docker run --rm -p 3000:3000 -e NODE_ENV=development reframe
```

The health endpoint is `/api/health`. In a managed environment, follow its Docker proxy/CA guidance and pass the `proxy_ca` build secret when needed. Do not mount host credential directories or add shared provider credentials to this container.

## Existing GitHub Pages version

Pages remains a static, API-key version. It cannot run the ChatGPT sign-in backend. Its usage is:

1. Open the app and select **Create scene**.
2. Enter your own OpenAI API key. It is kept only in JavaScript memory, never bundled, persisted, or sent to a Reframe server. Reload or **AI settings → Forget key** clears it.
3. Drag to orbit, pinch/scroll to move closer, and two-finger/right-drag to pan.
4. Capture angles, select shots, and choose **Generate photos**.
5. View and download the photographs. Downloads of unfinished shots are clearly named composition drafts.

Generation is billed to the user's OpenAI API account. Scene generation uses `gpt-4.1-mini`; image editing uses `gpt-image-1` with high input fidelity. The account needs API credit and access to those models (image generation may require organization verification). Product references and composition images are sent directly to OpenAI over HTTPS, only on generation. There are no preset scene fallbacks or fake generated images. The scene chips only fill the prompt.

## Run the static version

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

`npm run build` produces `dist/`; `npm run preview` serves it. No backend, environment variables, Vercel token, or shared API key is required. Do not put provider keys into source, GitHub Actions variables, or `VITE_*` variables. The interface accepts each user's key at runtime.

## Boundaries

- Generated scenes approximate product references with low-poly primitives; this is not mesh reconstruction.
- Image generation is guided by the captured view but may alter composition or product details. Review outputs before commercial use.
- GPT Image returns square, landscape, or portrait sizes. Exported AI photo aspect ratios can differ from the selected draft ratio; the app preserves the original output without cropping it.
- References are resized to 1024 px for upload. Shots and keys clear on reload.
- This personal POC uses a user-entered key in the browser. A shared commercial service should use an authenticated backend with server-side credentials.

## Verification

```sh
npm run test:unit
npm test
npm run test:hosted
npm run build
```

Unit tests check scene validation, provider requests, session/job isolation, CSRF protection, request limits, sign-out, and error handling. Browser tests intercept provider/backend responses with explicit test fixtures to exercise upload, scenes, camera movement, capture/restore, image generation, and both sign-in interfaces without spending credit. These fixtures are not bundled into the app. Live provider checks require an authorized account.

Playwright uses `/usr/bin/chromium` by default; set `CHROMIUM_PATH` if needed. Tests start Vite automatically. Physical multitouch ergonomics still need a device trial.

## GitHub Pages

The Pages workflow builds and deploys `main` automatically. Vite uses relative asset URLs so the app works under `/Reframe/`. Select **GitHub Actions** in Settings → Pages. Subsequent pushes deploy automatically.

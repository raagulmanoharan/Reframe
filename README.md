# Reframe

A mobile-first 3D camera for AI image generation. Describe any scene and optionally upload a product reference. OpenAI generates a structured layout of primitives; Three.js renders it as a navigable low-poly scene. Frame a shot while seated, then generate a photograph from that exact captured composition and reference.

## Use

1. Open the app and select **Create scene**.
2. Enter your own OpenAI API key. It is kept only in JavaScript memory, never bundled, persisted, or sent to a Reframe server. Reload or **AI settings → Forget key** clears it.
3. Drag to orbit, pinch/scroll to move closer, and two-finger/right-drag to pan.
4. Capture angles, select shots, and choose **Generate photos**.
5. View and download the photographs. Downloads of unfinished shots are clearly named composition drafts.

Generation is billed to the user's OpenAI API account. Scene generation uses `gpt-4.1-mini`; image editing uses `gpt-image-1` with high input fidelity. The account needs API credit and access to those models (image generation may require organization verification). Product references and composition images are sent directly to OpenAI over HTTPS, only on generation. There are no preset scene fallbacks or fake generated images. The scene chips only fill the prompt.

## Run

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
npm run build
```

Unit tests check scene validation and provider request construction/error handling. Browser tests intercept OpenAI responses with explicit test fixtures to exercise upload, arbitrary generated scenes, camera movement, capture/restore, image generation, and credential handling without spending API credit. These test fixtures are not bundled into the app. A live provider smoke test still requires a real OpenAI API key and model access.

Playwright uses `/usr/bin/chromium` by default; set `CHROMIUM_PATH` if needed. Tests start Vite automatically. Physical multitouch ergonomics still need a device trial.

## GitHub Pages

The Pages workflow builds and deploys `main` automatically. Vite uses relative asset URLs so the app works under `/Reframe/`. Select **GitHub Actions** in Settings → Pages. Subsequent pushes deploy automatically.

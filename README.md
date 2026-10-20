# Reframe

Mobile-first proof of concept for composing AI photographs through a low-poly 3D viewfinder. Built with Vite, Three.js, and OrbitControls.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Use the existing checkout; no additional worktree is needed. `npm run build` produces `dist/`. `npm run preview` serves that build.

## Try it

Choose Living room, Jewellery, or Industrial, or describe one of those scenes and select Create scene. Drag to orbit; pinch/scroll to move closer; two fingers or right-drag to pan. Reset view restores a useful starting camera. Capture multiple compositions, tap a thumbnail to restore its view, select images, and export PNGs. References accept JPG, PNG, and WEBP up to 10 MB and remain in browser memory.

## Prototype boundaries

Scene descriptions select one of three procedural templates using keywords, falling back to the living room. There is no generative AI, image-to-3D reconstruction, or photorealistic rendering API. Uploaded references are displayed locally and do not change geometry. Shots export actual 3D renders; the viewfinder fits the selected aspect ratio within the responsive stage, matching the exported composition. Contact sheets reset on reload. Some browsers may require permission to download multiple files.

## Verification

```sh
npm run build
npm test
```

Tests exercise desktop and mobile layouts, scene selection, shot capture/restore, aspect ratio, export, selection/deletion, reference upload, and help. Playwright uses `/usr/bin/chromium` by default; set `CHROMIUM_PATH` to another Chromium executable if needed. Tests start Vite automatically. Real multitouch ergonomics still need a physical-device trial.

## GitHub Pages

The Pages workflow builds and deploys `main` automatically. Vite uses relative asset URLs so the app works under `/Reframe/`.

In the repository's Settings → Pages, choose **GitHub Actions** as the build source. Pushes to `main` then deploy automatically; the workflow can also be run manually from Actions. No API keys or backend services are required.

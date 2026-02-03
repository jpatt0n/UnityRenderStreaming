# Unity RenderStreaming (Lawgiven fork)

## Purpose
- Unity RenderStreaming package + WebApp signaling server used by Lawgiven.
- WebApp client assets are synced into the rs-portal so `/access` can embed the receiver UI.

## Key paths
- `com.unity.renderstreaming/` — Unity package used inside the Lawgiven project.
- `RenderStreaming~/` — sample Unity project for the package.
- `WebApp/` — Node/Express signaling server + static web client.
- `WebApp/src/server.ts` — serves `/config` + `/signaling`, plus static assets under `/rs` and `/rs/module`.
- `WebApp/client/public/` — static HTML/CSS/JS assets for the receiver UI.
- `WebApp/client/src/` — ESM modules consumed by the receiver UI.
- `WebApp/client/public/js/config.js`, `WebApp/client/src/signaling.js`, `WebApp/client/public/js/videoplayer.js` — read `window.RENDER_STREAMING_CONFIG` for `signalingBaseUrl`, `basePath`, and optional `iceServers`.

## Integration with Lawgiven + rs-portal
- Lawgiven Unity runtime uses the RenderStreaming package and host components (`LGHostManager`, `LGHostRenderStreamingHandler`).
- The portal (`rs-website/rs-portal`) embeds the receiver UI in `/access` and points signaling at `stream.renderedsenseless.com`.
- Keep the portal’s static assets in sync with this repo via `rs-website/scripts/sync-renderstreaming-client.{sh,ps1}`.
  - `rs-portal/public/rs` mirrors `WebApp/client/public`.
  - `rs-portal/public/rs/module` mirrors `WebApp/client/src`.

## Running the WebApp
- `npm install`
- `npm run dev` (ts-node) or `npm run build` + `npm start` (node `build/index.js`).
- `npm run pack` builds a `webserver.exe` via `pkg` (Windows-friendly signaling host).

## Notes
- CORS is permissive in `WebApp/src/server.ts` so the portal domain can call the signaling endpoints.
- Base path `/rs` is for static assets; `/config` and `/signaling` also exist at the root for native embeds.

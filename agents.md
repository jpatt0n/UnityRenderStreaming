# Unity RenderStreaming (Lawgiven fork)

## Purpose
- Unity RenderStreaming package + WebApp signaling server used by Lawgiven.
- WebApp client assets are synced into the rs-portal so `/access` can embed the receiver UI.
- Interview mode extends the receiver UI with webcam sending and an interview control dock.

## Key paths
- `com.unity.renderstreaming/` — Unity package used inside the Lawgiven project.
- `RenderStreaming~/` — sample Unity project for the package.
- `WebApp/` — Node/Express signaling server + static web client.
- `WebApp/src/server.ts` — serves `/config` + `/signaling`, plus static assets under `/rs` and `/rs/module`.
- `WebApp/client/public/` — static HTML/CSS/JS assets for the receiver UI. `index.html` is the real receiver DOM, served at `localhost:55055` and `/rs/index.html`; `receiver/index.html` is only a redirect stub.
- `WebApp/client/src/` — ESM modules consumed by the receiver UI.
- **The receiver DOM exists twice**: here in `client/public/index.html`, and again as React in `rs-portal/src/pages/Access.tsx` for `/access`. The sync script copies this repo over `rs-portal/public/rs` and never touches `Access.tsx`, so a new element added to one page is missing from the other — and `main.js` null-guards every lookup, so it fails silently rather than loudly. Add to both.
- `WebApp/client/public/js/config.js`, `WebApp/client/src/signaling.js`, `WebApp/client/public/js/videoplayer.js` — read `window.RENDER_STREAMING_CONFIG` for `signalingBaseUrl`, `basePath`, optional `iceServers`, and optional `rnnoise` overrides (`enabled`, `preferSimd`, `workletPath`, `wasmPath`, `simdWasmPath`, `maxChannels`).
- `WebApp/client/public/receiver/rnnoise/` — vendored RNNoise AudioWorklet + wasm assets used by receiver mic capture.

## Integration with Lawgiven + rs-portal
- Lawgiven Unity runtime uses the RenderStreaming package and host components (`LGHostManager`, `LGHostRenderStreamingHandler`).
- The portal (`rs-website/rs-portal`) embeds the receiver UI in `/access` and points signaling at `stream.renderedsenseless.com`.
- Keep the portal’s static assets in sync with this repo via `rs-website/scripts/sync-renderstreaming-client.{sh,ps1}`.
  - `rs-portal/public/rs` mirrors `WebApp/client/public`.
  - `rs-portal/public/rs/module` mirrors `WebApp/client/src`.
- Interview connections are tagged in the connection id as `_interview_` so Unity can lock input and accept webcam tracks.

## Green room
- Guests connect on entering the green room and wait inside the show. `AdmissionService` issues a guest session up front; Unity decides admission. See `WebApp/ACCESS-CONTROL.md` for the full flow.
- The `green-room` data channel carries `{type:"state", admitted, username}` from Unity to the guest's page. Outbound only — the guest has no say. The label and the `admitted` field are a contract with `LGGreenRoomControlReceiver` in Lawgiven.
- The page holds `getUserMedia` for the microphone, and any webcam track, until `admitted` is true. A waiting guest sees the program feed and hears the show; nothing of theirs is on the wire.
- There is no `/admission/pending` API any more. The waiting list is Unity's, drawn from live guest connections that are still off air.

## Running the WebApp
- `npm install`
- `npm run dev` (ts-node) or `npm run build` + `npm start` (node `build/index.js`).
- `npm run pack` builds a `webserver.exe` via `pkg` (Windows-friendly signaling host).

## Notes
- CORS is permissive in `WebApp/src/server.ts` so the portal domain can call the signaling endpoints.
- Base path `/rs` is for static assets; `/config` and `/signaling` also exist at the root for native embeds.
- Input channel handshake/rebind is replace-not-append: `InputReceiver.SetChannel(...)` disposes prior remoting state before binding a new channel, and reconnect flows rely on this behavior.

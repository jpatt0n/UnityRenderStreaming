# GTCRN Self-Hosting Setup

## Important behavior
- No install is required for users.
- The user's browser still downloads the GTCRN runtime/model assets from your server on first load (then browser cache typically reuses them).
- Inference runs on the client machine (the browser's CPU), not on your Node signaling server.

## Where files must go
Place all files in:

`WebApp/client/public/receiver/gtcrn/`

Required files:
- `sherpa-onnx-speech-enhancement.js`
- `sherpa-onnx-wasm-main-speech-enhancement.js`
- `sherpa-onnx-wasm-main-speech-enhancement.data`
- `sherpa-onnx-wasm-main-speech-enhancement.wasm`

## Download commands (bash)
Run from repo root:

```bash
mkdir -p WebApp/client/public/receiver/gtcrn

curl -L -o WebApp/client/public/receiver/gtcrn/sherpa-onnx-speech-enhancement.js \
  https://huggingface.co/spaces/k2-fsa/wasm-speech-enhancement-gtcrn/resolve/main/sherpa-onnx-speech-enhancement.js

curl -L -o WebApp/client/public/receiver/gtcrn/sherpa-onnx-wasm-main-speech-enhancement.js \
  https://huggingface.co/spaces/k2-fsa/wasm-speech-enhancement-gtcrn/resolve/main/sherpa-onnx-wasm-main-speech-enhancement.js

curl -L -o WebApp/client/public/receiver/gtcrn/sherpa-onnx-wasm-main-speech-enhancement.data \
  https://huggingface.co/spaces/k2-fsa/wasm-speech-enhancement-gtcrn/resolve/main/sherpa-onnx-wasm-main-speech-enhancement.data

curl -L -o WebApp/client/public/receiver/gtcrn/sherpa-onnx-wasm-main-speech-enhancement.wasm \
  https://huggingface.co/spaces/k2-fsa/wasm-speech-enhancement-gtcrn/resolve/main/sherpa-onnx-wasm-main-speech-enhancement.wasm
```

## Download commands (PowerShell)
Run from repo root:

```powershell
New-Item -ItemType Directory -Force -Path "WebApp/client/public/receiver/gtcrn" | Out-Null

Invoke-WebRequest -Uri "https://huggingface.co/spaces/k2-fsa/wasm-speech-enhancement-gtcrn/resolve/main/sherpa-onnx-speech-enhancement.js" -OutFile "WebApp/client/public/receiver/gtcrn/sherpa-onnx-speech-enhancement.js"
Invoke-WebRequest -Uri "https://huggingface.co/spaces/k2-fsa/wasm-speech-enhancement-gtcrn/resolve/main/sherpa-onnx-wasm-main-speech-enhancement.js" -OutFile "WebApp/client/public/receiver/gtcrn/sherpa-onnx-wasm-main-speech-enhancement.js"
Invoke-WebRequest -Uri "https://huggingface.co/spaces/k2-fsa/wasm-speech-enhancement-gtcrn/resolve/main/sherpa-onnx-wasm-main-speech-enhancement.data" -OutFile "WebApp/client/public/receiver/gtcrn/sherpa-onnx-wasm-main-speech-enhancement.data"
Invoke-WebRequest -Uri "https://huggingface.co/spaces/k2-fsa/wasm-speech-enhancement-gtcrn/resolve/main/sherpa-onnx-wasm-main-speech-enhancement.wasm" -OutFile "WebApp/client/public/receiver/gtcrn/sherpa-onnx-wasm-main-speech-enhancement.wasm"
```

## Runtime defaults already wired
`WebApp/client/public/receiver/js/main.js` now defaults to self-hosted assets:
- base URL: `../gtcrn/` relative to `receiver/js/main.js`
- wasm main script: `sherpa-onnx-wasm-main-speech-enhancement.js`
- enhancement wrapper: `sherpa-onnx-speech-enhancement.js`
- model path: empty by default (uses the packaged model in this demo bundle)

No config changes are required if you use the file names above.

## Optional config overrides
You can override defaults in `window.RENDER_STREAMING_CONFIG.gtcrn`:

```js
window.RENDER_STREAMING_CONFIG = {
  gtcrn: {
    enabled: true,
    assetsBaseUrl: '/rs/receiver/gtcrn/',
    wasmMainScriptUrl: '/rs/receiver/gtcrn/sherpa-onnx-wasm-main-speech-enhancement.js',
    speechEnhancementScriptUrl: '/rs/receiver/gtcrn/sherpa-onnx-speech-enhancement.js',
    modelPath: '',
    provider: 'cpu',
    numThreads: 1,
    debug: 0
  }
};
```

## Quick verification
1. Start WebApp and load `/rs/index.html`.
2. Open DevTools Network tab and join with mic enabled.
3. Confirm requests for the 4 GTCRN files are served from your domain under `/rs/receiver/gtcrn/`.
4. Confirm no requests to external CDN/Hugging Face are required at runtime.

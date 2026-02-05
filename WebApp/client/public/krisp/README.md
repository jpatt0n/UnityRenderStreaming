Krisp SDK assets

Place the Krisp Web Browser SDK files from the Krisp SDK Portal here so the
receiver can load them at runtime.

Expected layout:
- dist/usermedia.mjs
- dist/krispsdk.mjs (optional, only needed for manual AudioContext integrations)
- dist/models/model_nc.kef
- dist/models/model_8.kef

If you use different file names or locations, override them via
window.RENDER_STREAMING_CONFIG.krisp:
  {
    enabled: true,
    basePath: "/rs/krisp",
    models: {
      modelNC: "/rs/krisp/dist/models/model_nc.kef",
      model8: "/rs/krisp/dist/models/model_8.kef"
    }
  }

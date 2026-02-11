const globalConfig = window.RENDER_STREAMING_CONFIG || {};
const signalingBaseUrl = (globalConfig.signalingBaseUrl || location.origin).replace(/\/$/, '');
const DEFAULT_ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302'] }];
const FALLBACK_BASE_PATH = window.location.pathname.startsWith('/rs') ? '/rs' : '';

function normalizeBasePath(path) {
  if (typeof path !== 'string') {
    return '';
  }
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function buildAssetPath(basePath, relativePath) {
  if (!relativePath.startsWith('/')) {
    return basePath ? `${basePath}/${relativePath}` : `/${relativePath}`;
  }
  return basePath ? `${basePath}${relativePath}` : relativePath;
}

export async function getServerConfig() {
  const protocolEndPoint = signalingBaseUrl + '/config';
  const createResponse = await fetch(protocolEndPoint);
  return await createResponse.json();
}

export function getBasePath() {
  return normalizeBasePath(globalConfig.basePath || FALLBACK_BASE_PATH);
}

export function getRTCConfiguration() {
  let config = {};
  config.sdpSemantics = 'unified-plan';
  if (Array.isArray(globalConfig.iceServers) && globalConfig.iceServers.length > 0) {
    config.iceServers = globalConfig.iceServers;
  } else {
    config.iceServers = DEFAULT_ICE_SERVERS;
  }
  return config;
}

export function getRNNoiseConfiguration() {
  const basePath = getBasePath();
  const rnnoiseConfig = globalConfig.rnnoise || {};

  return {
    enabled: rnnoiseConfig.enabled !== false,
    preferSimd: rnnoiseConfig.preferSimd !== false,
    maxChannels: Number.isFinite(rnnoiseConfig.maxChannels) ? rnnoiseConfig.maxChannels : 1,
    workletPath: rnnoiseConfig.workletPath || buildAssetPath(basePath, '/receiver/rnnoise/rnnoise-worklet.js'),
    wasmPath: rnnoiseConfig.wasmPath || buildAssetPath(basePath, '/receiver/rnnoise/rnnoise.wasm'),
    simdWasmPath: rnnoiseConfig.simdWasmPath || buildAssetPath(basePath, '/receiver/rnnoise/rnnoise_simd.wasm')
  };
}

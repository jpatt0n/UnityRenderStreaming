const globalConfig = window.RENDER_STREAMING_CONFIG || {};
const signalingBaseUrl = (globalConfig.signalingBaseUrl || location.origin).replace(/\/$/, '');
const DEFAULT_ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302'] }];

function normalizeBasePath(value) {
  if (!value) {
    return '';
  }
  return value.replace(/\/$/, '');
}

export function getBasePath() {
  return normalizeBasePath(
    globalConfig.basePath || (window.location.pathname.startsWith('/rs') ? '/rs' : '')
  );
}

export async function getServerConfig() {
  const protocolEndPoint = signalingBaseUrl + '/config';
  const createResponse = await fetch(protocolEndPoint);
  return await createResponse.json();
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

export function getKrispConfig() {
  const basePath = getBasePath();
  const krisp = globalConfig.krisp || {};
  const enabled = typeof krisp.enabled === 'boolean' ? krisp.enabled : true;
  const krispBasePath = normalizeBasePath(krisp.basePath || `${basePath}/krisp`);
  const defaultModels = {
    modelNC: `${krispBasePath}/dist/models/model_nc.kef`,
    model8: `${krispBasePath}/dist/models/model_8.kef`,
  };
  const models = Object.assign({}, defaultModels, krisp.models || {});
  const preload = krisp.preload === true;

  return {
    enabled,
    basePath: krispBasePath,
    models,
    preload,
  };
}

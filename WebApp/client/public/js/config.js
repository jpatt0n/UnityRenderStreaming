const globalConfig = window.RENDER_STREAMING_CONFIG || {};
const signalingBaseUrl = (globalConfig.signalingBaseUrl || location.origin).replace(/\/$/, '');
const DEFAULT_ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302'] }];

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

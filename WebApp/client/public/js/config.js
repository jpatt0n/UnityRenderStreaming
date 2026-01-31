import {getServers} from "./icesettings.js";

const globalConfig = window.RENDER_STREAMING_CONFIG || {};
const signalingBaseUrl = (globalConfig.signalingBaseUrl || location.origin).replace(/\/$/, '');

export async function getServerConfig() {
  const protocolEndPoint = signalingBaseUrl + '/config';
  const createResponse = await fetch(protocolEndPoint);
  return await createResponse.json();
}

export function getRTCConfiguration() {
  let config = {};
  config.sdpSemantics = 'unified-plan';
  config.iceServers = getServers();
  return config;
}

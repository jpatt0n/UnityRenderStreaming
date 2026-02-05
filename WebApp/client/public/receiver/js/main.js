import { getServerConfig, getRTCConfiguration, getKrispConfig } from "../../js/config.js";
import { createDisplayStringArray } from "../../js/stats.js";
import { VideoPlayer } from "../../js/videoplayer.js";
import { RenderStreaming } from "../../module/renderstreaming.js";
import { Signaling, WebSocketSignaling } from "../../module/signaling.js";

/** @type {RenderStreaming} */
let renderstreaming;
/** @type {boolean} */
let useWebSocket;
/** @type {boolean} */
let isTearingDown = false;

const codecPreferences = document.getElementById('codecPreferences');
const supportsSetCodecPreferences = window.RTCRtpTransceiver &&
  'setCodecPreferences' in window.RTCRtpTransceiver.prototype;

const statusDiv = document.getElementById('statusMessage');
const statsDiv = document.getElementById('message');
const statsPanel = document.getElementById('statsPanel');
const statsToggle = document.getElementById('statsToggle');
const settingsToggle = document.getElementById('settingsToggle');
const settingsMenu = document.getElementById('settingsMenu');
const settingsPanel = document.getElementById('settingsPanel');
const joinButton = document.getElementById('joinButton');
const disconnectButton = document.getElementById('disconnectButton');
const micStateLabel = document.getElementById('micStateLabel');
const krispCheck = document.getElementById('krispCheck');
const krispStateLabel = document.getElementById('krispStateLabel');

const playerDiv = document.getElementById('player');
const lockMouseCheck = document.getElementById('lockMouseCheck');
const usernameInput = document.getElementById('usernameInput');
const micCheck = document.getElementById('micCheck');
const audioSelect = document.querySelector('select#audioSource');
const videoPlayer = new VideoPlayer();
const krispConfig = getKrispConfig();
let krispUserMedia = null;
let krispLoadPromise = null;
let localAudioUsesKrisp = false;

setup();

window.document.oncontextmenu = function () {
  return false;     // cancel default menu
};

window.addEventListener('resize', function () {
  videoPlayer.resizeVideo();
}, true);

window.addEventListener('beforeunload', async () => {
  if (!renderstreaming)
    return;
  await renderstreaming.stop();
}, true);

if (joinButton) {
  joinButton.addEventListener('click', onClickJoinButton);
}

if (disconnectButton) {
  disconnectButton.addEventListener('click', onClickDisconnectButton);
}

if (settingsToggle && settingsMenu) {
  settingsToggle.addEventListener('click', () => {
    const isOpen = !settingsMenu.hidden;
    settingsMenu.hidden = isOpen;
    settingsToggle.setAttribute('aria-expanded', (!isOpen).toString());
  });
}

if (statsToggle && statsPanel) {
  statsToggle.addEventListener('click', () => {
    const isOpen = !statsPanel.hidden;
    statsPanel.hidden = isOpen;
    statsToggle.setAttribute('aria-expanded', (!isOpen).toString());
    statsToggle.classList.toggle('is-active', !isOpen);
  });
}

async function setup() {
  setUiState('ready');
  const res = await getServerConfig();
  useWebSocket = res.useWebSocket;
  showWarningIfNeeded(res.startupMode);
  showCodecSelect();
  await setupAudioInputSelect();
  restoreUsername();
  updateMicState();
  updateKrispState();
  if (settingsMenu) {
    settingsMenu.hidden = true;
    if (settingsToggle) {
      settingsToggle.setAttribute('aria-expanded', 'false');
    }
  }
}

function setUiState(state) {
  document.body.dataset.state = state;
  const isConnected = state === 'connected';
  const showSettings = state === 'ready' || state === 'disconnected';

  if (settingsPanel) {
    settingsPanel.style.display = showSettings ? 'block' : 'none';
  }

  if (statsToggle) {
    statsToggle.hidden = !isConnected;
  }

  if (disconnectButton) {
    disconnectButton.hidden = !isConnected;
  }

  if (!isConnected && statsPanel && statsToggle) {
    statsPanel.hidden = true;
    statsToggle.classList.remove('is-active');
    statsToggle.setAttribute('aria-expanded', 'false');
  }
}

function setStatusMessage(message, isHtml = false) {
  if (!statusDiv) {
    return;
  }
  if (!message) {
    statusDiv.hidden = true;
    statusDiv.textContent = '';
    return;
  }
  statusDiv.hidden = false;
  if (isHtml) {
    statusDiv.innerHTML = message;
  } else {
    statusDiv.textContent = message;
  }
}

function showWarningIfNeeded(startupMode) {
  const warningDiv = document.getElementById("warning");
  if (startupMode == "private") {
    warningDiv.innerHTML = "<h4>Warning</h4> This sample is not working on Private Mode.";
    warningDiv.hidden = false;
  }
}

function onClickJoinButton() {
  const username = sanitizeUsername(usernameInput.value);
  if (!username) {
    setStatusMessage('Please enter a username to connect.');
    return;
  }
  usernameInput.value = username;
  saveUsername(username);
  setStatusMessage('');

  setUiState('connecting');
  if (settingsMenu) {
    settingsMenu.hidden = true;
    if (settingsToggle) {
      settingsToggle.setAttribute('aria-expanded', 'false');
    }
  }

  videoPlayer.createPlayer(playerDiv, lockMouseCheck);
  setupRenderStreaming();
}

async function onClickDisconnectButton() {
  await teardownConnection('Disconnected.');
}

async function setupRenderStreaming() {
  codecPreferences.disabled = true;

  const signaling = useWebSocket ? new WebSocketSignaling() : new Signaling();
  const config = getRTCConfiguration();
  renderstreaming = new RenderStreaming(signaling, config);
  renderstreaming.onConnect = onConnect;
  renderstreaming.onDisconnect = onDisconnect;
  renderstreaming.onTrackEvent = (data) => videoPlayer.addTrack(data.track);
  renderstreaming.onGotOffer = setCodecPreferences;

  await renderstreaming.start();
  const username = sanitizeUsername(usernameInput.value);
  const connectionId = createConnectionId(username);
  await renderstreaming.createConnection(connectionId);
}

async function onConnect() {
  const channel = renderstreaming.createDataChannel("input");
  videoPlayer.setupInput(channel);
  if (micCheck && micCheck.checked) {
    await startMicrophone();
  }
  setStatusMessage('');
  setUiState('connected');
  showStatsMessage();
}

async function onDisconnect(connectionId) {
  const display = typeof connectionId === 'string' ? connectionId : 'session';
  const message = display.startsWith('Receive disconnect message') ? 'Disconnected.' : `Disconnected from ${display}.`;
  await teardownConnection(message);
}

async function teardownConnection(message) {
  if (isTearingDown) {
    return;
  }
  isTearingDown = true;
  clearStatsMessage();
  setStatusMessage(message || '');

  if (renderstreaming) {
    await renderstreaming.stop();
    renderstreaming = null;
  }

  videoPlayer.deletePlayer();
  stopMicrophone();
  if (supportsSetCodecPreferences) {
    codecPreferences.disabled = false;
  }
  setUiState('ready');
  isTearingDown = false;
}

function setCodecPreferences() {
  /** @type {RTCRtpCodecCapability[] | null} */
  let selectedCodecs = null;
  if (supportsSetCodecPreferences) {
    const preferredCodec = codecPreferences.options[codecPreferences.selectedIndex];
    if (preferredCodec.value !== '') {
      const [mimeType, sdpFmtpLine] = preferredCodec.value.split(' ');
      const { codecs } = RTCRtpSender.getCapabilities('video');
      const selectedCodecIndex = codecs.findIndex(c => c.mimeType === mimeType && c.sdpFmtpLine === sdpFmtpLine);
      const selectCodec = codecs[selectedCodecIndex];
      selectedCodecs = [selectCodec];
    }
  }

  if (selectedCodecs == null) {
    return;
  }
  const transceivers = renderstreaming.getTransceivers().filter(t => t.receiver.track.kind == "video");
  if (transceivers && transceivers.length > 0) {
    transceivers.forEach(t => t.setCodecPreferences(selectedCodecs));
  }
}

function showCodecSelect() {
  if (!supportsSetCodecPreferences) {
    setStatusMessage('Current Browser does not support <a href="https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpTransceiver/setCodecPreferences">RTCRtpTransceiver.setCodecPreferences</a>.', true);
    return;
  }

  const codecs = RTCRtpSender.getCapabilities('video').codecs;
  codecs.forEach(codec => {
    if (['video/red', 'video/ulpfec', 'video/rtx'].includes(codec.mimeType)) {
      return;
    }
    const option = document.createElement('option');
    option.value = (codec.mimeType + ' ' + (codec.sdpFmtpLine || '')).trim();
    option.innerText = option.value;
    codecPreferences.appendChild(option);
  });
  codecPreferences.disabled = false;
}

async function setupAudioInputSelect() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return;
  }
  if (!audioSelect) {
    return;
  }

  const deviceInfos = await navigator.mediaDevices.enumerateDevices();
  audioSelect.innerHTML = '';

  for (let i = 0; i !== deviceInfos.length; ++i) {
    const deviceInfo = deviceInfos[i];
    if (deviceInfo.kind === 'audioinput') {
      const option = document.createElement('option');
      option.value = deviceInfo.deviceId;
      option.text = deviceInfo.label || `mic ${audioSelect.length + 1}`;
      audioSelect.appendChild(option);
    }
  }
}

let localAudioStream = null;
let localAudioTrack = null;

function updateKrispState() {
  if (!krispCheck || !krispStateLabel) {
    return;
  }
  if (!krispConfig.enabled) {
    krispCheck.checked = false;
    krispCheck.disabled = true;
    krispStateLabel.textContent = 'Unavailable';
    krispCheck.title = 'Noise reduction disabled in configuration.';
    return;
  }
  krispCheck.disabled = false;
  krispCheck.title = '';
  krispStateLabel.textContent = krispCheck.checked ? 'Enabled' : 'Disabled';
}

function shouldUseKrisp() {
  return krispCheck && krispCheck.checked && krispConfig.enabled;
}

function buildKrispModels() {
  const models = Object.assign({}, krispConfig.models || {});
  if (krispConfig.preload) {
    if (typeof models.modelNC === 'string') {
      models.modelNC = { url: models.modelNC, preload: true };
    }
    if (typeof models.model8 === 'string') {
      models.model8 = { url: models.model8, preload: true };
    }
  }
  return models;
}

async function loadKrispUserMedia() {
  if (krispUserMedia) {
    return krispUserMedia;
  }
  if (krispLoadPromise) {
    return krispLoadPromise;
  }
  const modulePath = `${krispConfig.basePath}/dist/usermedia.mjs`;
  krispLoadPromise = (async () => {
    const module = await import(modulePath);
    const UserMedia = module.default || module.UserMedia || module;
    if (!UserMedia) {
      throw new Error('Krisp UserMedia module export not found.');
    }
    const userMedia = new UserMedia({ singleStream: true });
    await userMedia.initSDK({
      params: {
        useBVC: false,
        models: buildKrispModels(),
      },
    });
    krispUserMedia = userMedia;
    return userMedia;
  })().catch((err) => {
    krispLoadPromise = null;
    throw err;
  });
  return krispLoadPromise;
}

async function startBrowserMicrophone(constraints) {
  localAudioStream = await navigator.mediaDevices.getUserMedia(constraints);
  localAudioTrack = localAudioStream.getAudioTracks()[0];
  localAudioUsesKrisp = false;
}

async function startMicrophone() {
  if (!renderstreaming) {
    return;
  }

  const wantsKrisp = shouldUseKrisp();
  if (localAudioTrack && localAudioTrack.readyState === 'live' && localAudioUsesKrisp === wantsKrisp) {
    localAudioTrack.enabled = true;
    return;
  }

  const baseConstraints = {
    audio: {
      deviceId: audioSelect && audioSelect.value ? { exact: audioSelect.value } : undefined
    }
  };

  try {
    if (wantsKrisp) {
      const krispConstraints = {
        audio: {
          deviceId: baseConstraints.audio.deviceId,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };
      const userMedia = await loadKrispUserMedia();
      await userMedia.loadUserMedia(krispConstraints, { enableOnceReady: true });
      localAudioStream = userMedia.stream;
      localAudioTrack = localAudioStream ? localAudioStream.getAudioTracks()[0] : null;
      localAudioUsesKrisp = true;
    } else {
      await startBrowserMicrophone(baseConstraints);
    }
  } catch (err) {
    if (wantsKrisp) {
      console.warn('Krisp failed to initialize, falling back to raw microphone.', err);
      if (krispCheck) {
        krispCheck.checked = false;
        updateKrispState();
      }
      try {
        await startBrowserMicrophone(baseConstraints);
      } catch (fallbackErr) {
        setStatusMessage(`Microphone error: ${fallbackErr.message || fallbackErr}`);
        micCheck.checked = false;
        updateMicState();
        return;
      }
    } else {
      setStatusMessage(`Microphone error: ${err.message || err}`);
      micCheck.checked = false;
      updateMicState();
      return;
    }
  }

  if (!localAudioTrack) {
    return;
  }

  renderstreaming.addTransceiver(localAudioTrack, { direction: 'sendonly' });
}

function stopMicrophone() {
  if (localAudioTrack) {
    localAudioTrack.stop();
    localAudioTrack = null;
  }
  localAudioStream = null;
  localAudioUsesKrisp = false;
}

function updateMicState() {
  if (micStateLabel && micCheck) {
    micStateLabel.textContent = micCheck.checked ? 'Enabled' : 'Disabled';
  }
  if (audioSelect) {
    audioSelect.disabled = !micCheck.checked;
  }
}

if (micCheck) {
  micCheck.addEventListener('change', async () => {
    updateMicState();
    if (micCheck.checked) {
      await startMicrophone();
    } else if (localAudioTrack) {
      localAudioTrack.enabled = false;
    }
  });
}

if (krispCheck) {
  krispCheck.addEventListener('change', async () => {
    updateKrispState();
    if (micCheck && micCheck.checked) {
      stopMicrophone();
      await startMicrophone();
    }
  });
}

if (audioSelect) {
  audioSelect.addEventListener('change', async () => {
    if (micCheck && micCheck.checked) {
      stopMicrophone();
      await startMicrophone();
    }
  });
}

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', setupAudioInputSelect);
}

function createConnectionId(username) {
  const base = username || 'guest';
  if (window.crypto && window.crypto.randomUUID) {
    return `${base}_${window.crypto.randomUUID()}`;
  }
  const rand = Math.random().toString(36).slice(2);
  return `${base}_${rand}`;
}

function sanitizeUsername(value) {
  return (value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

function restoreUsername() {
  const saved = window.localStorage.getItem('lg_username') || '';
  if (saved) {
    usernameInput.value = sanitizeUsername(saved);
  }
  usernameInput.addEventListener('input', () => {
    usernameInput.value = sanitizeUsername(usernameInput.value);
  });
}

function saveUsername(value) {
  window.localStorage.setItem('lg_username', value);
}

/** @type {RTCStatsReport} */
let lastStats;
/** @type {number} */
let intervalId;

function showStatsMessage() {
  intervalId = setInterval(async () => {
    if (renderstreaming == null) {
      return;
    }

    const stats = await renderstreaming.getStats();
    if (stats == null) {
      return;
    }

    const array = createDisplayStringArray(stats, lastStats);
    if (array.length && statsDiv) {
      statsDiv.innerHTML = array.join('<br>');
    }
    lastStats = stats;
  }, 1000);
}

function clearStatsMessage() {
  if (intervalId) {
    clearInterval(intervalId);
  }
  lastStats = null;
  intervalId = null;
  if (statsDiv) {
    statsDiv.innerHTML = '';
  }
  if (statsPanel) {
    statsPanel.hidden = true;
  }
  if (statsToggle) {
    statsToggle.classList.remove('is-active');
    statsToggle.setAttribute('aria-expanded', 'false');
  }
}

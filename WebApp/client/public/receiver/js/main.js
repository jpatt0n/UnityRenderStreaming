import { getServerConfig, getRTCConfiguration, getRNNoiseConfiguration } from "../../js/config.js";
import { createDisplayStringArray } from "../../js/stats.js";
import { VideoPlayer } from "../../js/videoplayer.js";
import { RenderStreaming } from "../../module/renderstreaming.js";
import { Signaling, WebSocketSignaling } from "../../module/signaling.js";
import { createRnnoiseProcessor } from "./rnnoise.js";

/** @type {RenderStreaming} */
let renderstreaming;
/** @type {boolean} */
let useWebSocket;
/** @type {boolean} */
let isTearingDown = false;
/** @type {'cast'|'guest'|null} */
let admissionKind = null;
/** @type {string} */
let admissionKey = '';
/** @type {{username:string, profile:string, kind:string}|null} */
let admissionIdentity = null;
/** @type {string} */
let admissionToken = '';

const codecPreferences = document.getElementById('codecPreferences');
const supportsSetCodecPreferences = window.RTCRtpTransceiver &&
  'setCodecPreferences' in window.RTCRtpTransceiver.prototype;

const statusDiv = document.getElementById('statusMessage');
const statsDiv = document.getElementById('message');
const statsPanel = document.getElementById('statsPanel');
const statsToggle = document.getElementById('statsToggle');
const connectedTools = document.getElementById('connectedTools');
const inputSettingsToggle = document.getElementById('inputSettingsToggle');
const inputSettingsPanel = document.getElementById('inputSettingsPanel');
const mouseSensitivityRange = document.getElementById('mouseSensitivityRange');
const mouseSensitivityNumber = document.getElementById('mouseSensitivityNumber');
const settingsToggle = document.getElementById('settingsToggle');
const settingsMenu = document.getElementById('settingsMenu');
const settingsPanel = document.getElementById('settingsPanel');
const joinButton = document.getElementById('joinButton');
const disconnectButton = document.getElementById('disconnectButton');
const webcamModeControls = document.getElementById('webcamModeControls');
const webcamPrimaryMode = document.getElementById('webcamPrimaryMode');
const webcamSecondaryMode = document.getElementById('webcamSecondaryMode');
const micStateLabel = document.getElementById('micStateLabel');
const webcamCheck = document.getElementById('webcamCheck');
const webcamStateLabel = document.getElementById('webcamStateLabel');
const videoSelect = document.querySelector('select#videoSource');
const webcamPreview = document.getElementById('webcamPreview');
const webcamPreviewPlaceholder = document.getElementById('webcamPreviewPlaceholder');

const playerDiv = document.getElementById('player');
const lockMouseCheck = document.getElementById('lockMouseCheck');
const usernameInput = document.getElementById('usernameInput');
const micCheck = document.getElementById('micCheck');
const audioSelect = document.querySelector('select#audioSource');
const videoPlayer = new VideoPlayer();
const INPUT_CHANNEL_LABEL = "input";
const WEBCAM_CONTROL_CHANNEL_LABEL = "webcam-control";
const INPUT_CHANNEL_OPEN_TIMEOUT_MS = 10000;
const INPUT_CHANNEL_RECOVERY_DELAY_MS = 1500;
const MEDIA_START_TIMEOUT_MS = 10000;
const MEDIA_RECONNECT_DELAY_MS = 1000;
const MAX_MEDIA_RECONNECT_ATTEMPTS = 3;
const MICROPHONE_START_DELAY_MS = 500;
const MOUSE_SENSITIVITY_STORAGE_KEY = 'lawgiven.mouseSensitivity';
const MIN_MOUSE_SENSITIVITY = 0.1;
const MAX_MOUSE_SENSITIVITY = 4;
const DEFAULT_MOUSE_SENSITIVITY = 1;
let inputChannel = null;
let webcamControlChannel = null;
let webcamControlRecoveryTimer = null;
let webcamMode = 'tv-screen';
let webcamModePending = false;
let webcamSessionActive = false;
let inputChannelOpenTimer = null;
let inputChannelRecoveryTimer = null;
let inputChannelRecovering = false;
let mediaStartTimer = null;
let mediaReconnectAttempts = 0;
let microphoneStartTimer = null;
let micTransceiver = null;
let webcamTransceiver = null;
let localVideoStream = null;
let localVideoTrack = null;
let mouseSensitivity = readStoredMouseSensitivity();

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

if (webcamPrimaryMode) {
  webcamPrimaryMode.addEventListener('click', () => {
    const nextMode = webcamMode === 'tv-man' ? 'tv-screen' : 'tv-man';
    void requestWebcamMode(nextMode);
  });
}

if (webcamSecondaryMode) {
  webcamSecondaryMode.addEventListener('click', () => {
    const nextMode = webcamMode === 'full-control' ? 'tv-screen' : 'full-control';
    void requestWebcamMode(nextMode);
  });
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
    closeInputSettings();
    statsPanel.hidden = isOpen;
    statsToggle.setAttribute('aria-expanded', (!isOpen).toString());
    statsToggle.classList.toggle('is-active', !isOpen);
  });
}

if (inputSettingsToggle && inputSettingsPanel) {
  inputSettingsToggle.addEventListener('click', () => {
    const isOpen = !inputSettingsPanel.hidden;
    closeStatsPanel();
    inputSettingsPanel.hidden = isOpen;
    inputSettingsToggle.setAttribute('aria-expanded', (!isOpen).toString());
    inputSettingsToggle.classList.toggle('is-active', !isOpen);
  });
}

if (mouseSensitivityRange) {
  mouseSensitivityRange.addEventListener('input', () => {
    setMouseSensitivity(mouseSensitivityRange.value);
  });
}

if (mouseSensitivityNumber) {
  mouseSensitivityNumber.addEventListener('change', () => {
    setMouseSensitivity(mouseSensitivityNumber.value);
  });
  mouseSensitivityNumber.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      mouseSensitivityNumber.blur();
    }
  });
}

for (const control of [mouseSensitivityRange, mouseSensitivityNumber]) {
  control?.addEventListener('keydown', event => event.stopPropagation());
  control?.addEventListener('keyup', event => event.stopPropagation());
}

document.addEventListener('pointerdown', event => {
  if (!inputSettingsPanel || inputSettingsPanel.hidden) {
    return;
  }
  if (inputSettingsPanel.contains(event.target) || inputSettingsToggle?.contains(event.target)) {
    return;
  }
  closeInputSettings();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeInputSettings();
  }
});

if (webcamCheck) {
  webcamCheck.addEventListener('change', async () => {
    updateWebcamState();
    if (webcamCheck.checked) {
      await startWebcam();
    } else {
      stopWebcam();
    }
  });
}

if (videoSelect) {
  videoSelect.addEventListener('change', async () => {
    if (webcamCheck && webcamCheck.checked) {
      stopWebcam();
      await startWebcam();
    }
  });
}

async function setup() {
  setUiState('ready');
  const res = await getServerConfig();
  useWebSocket = res.useWebSocket;
  showWarningIfNeeded(res.startupMode);
  showCodecSelect();
  await setupAudioInputSelect();
  await setupVideoInputSelect();
  restoreUsername();
  await setupAdmission();
  updateMicState();
  updateWebcamState();
  syncMouseSensitivityControls();
  videoPlayer.setMouseSensitivity(mouseSensitivity);
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
  const showSettings = state === 'ready' || state === 'disconnected' || state === 'waiting';

  if (settingsPanel) {
    settingsPanel.style.display = showSettings ? 'block' : 'none';
  }

  if (connectedTools) {
    connectedTools.hidden = !isConnected;
  }

  if (disconnectButton) {
    disconnectButton.hidden = !isConnected;
  }

  updateWebcamModeControls();

  if (!isConnected) {
    closeStatsPanel();
    closeInputSettings();
  }
}

function normalizeMouseSensitivity(value) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const clamped = Math.min(MAX_MOUSE_SENSITIVITY, Math.max(MIN_MOUSE_SENSITIVITY, parsed));
  return Math.round(clamped * 10) / 10;
}

function readStoredMouseSensitivity() {
  try {
    return normalizeMouseSensitivity(localStorage.getItem(MOUSE_SENSITIVITY_STORAGE_KEY))
      ?? DEFAULT_MOUSE_SENSITIVITY;
  } catch {
    return DEFAULT_MOUSE_SENSITIVITY;
  }
}

function setMouseSensitivity(value) {
  const normalized = normalizeMouseSensitivity(value);
  if (normalized == null) {
    syncMouseSensitivityControls();
    return;
  }
  mouseSensitivity = normalized;
  syncMouseSensitivityControls();
  videoPlayer.setMouseSensitivity(mouseSensitivity);
  try {
    localStorage.setItem(MOUSE_SENSITIVITY_STORAGE_KEY, mouseSensitivity.toString());
  } catch {
    // Private browsing or storage policies can disable persistence.
  }
}

function syncMouseSensitivityControls() {
  if (mouseSensitivityRange) {
    mouseSensitivityRange.value = mouseSensitivity.toString();
  }
  if (mouseSensitivityNumber) {
    mouseSensitivityNumber.value = mouseSensitivity.toFixed(1);
  }
}

function closeStatsPanel() {
  if (!statsPanel || !statsToggle) {
    return;
  }
  statsPanel.hidden = true;
  statsToggle.classList.remove('is-active');
  statsToggle.setAttribute('aria-expanded', 'false');
}

function closeInputSettings() {
  if (!inputSettingsPanel || !inputSettingsToggle) {
    return;
  }
  inputSettingsPanel.hidden = true;
  inputSettingsToggle.classList.remove('is-active');
  inputSettingsToggle.setAttribute('aria-expanded', 'false');
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

async function onClickJoinButton() {
  const username = sanitizeUsername(usernameInput.value);
  if (admissionKind === 'cast' && !username) {
    setStatusMessage('Please enter a username to connect.');
    return;
  }
  if (admissionKind === 'cast') {
    usernameInput.value = username;
    saveUsername(username);
  }
  joinButton.disabled = true;
  mediaReconnectAttempts = 0;
  setStatusMessage('');

  preparePlayerForJoin();

  try {
    if (admissionKind === 'cast') {
      const result = await admissionFetch('/admission/cast', {
        method: 'POST',
        body: JSON.stringify({ key: admissionKey, username }),
      });
      admissionIdentity = result.identity;
      admissionToken = result.token;
    } else if (admissionKind === 'guest') {
      setStatusMessage('Entering the green room...');
      const result = await admissionFetch('/admission/guest', {
        method: 'POST',
        body: JSON.stringify({ key: admissionKey }),
      });
      admissionIdentity = result.identity;
      usernameInput.value = sanitizeUsername(result.identity.username);
      joinButton.textContent = '✓ In Green Room';
      setUiState('waiting');
      setStatusMessage('✓ Waiting in the green room for a cast member to let you in.');
      admissionToken = await waitForGuestApproval(result.id);
    } else {
      throw new Error('A valid cast or guest access link is required.');
    }

    setStatusMessage('Connecting...');
    setUiState('connecting');
    await setupRenderStreaming();
  } catch (error) {
    setUiState('ready');
    joinButton.disabled = false;
    if (admissionKind === 'guest') {
      joinButton.textContent = 'Enter Green Room';
    }
    setStatusMessage(error instanceof Error ? error.message : String(error));
  }
}

function preparePlayerForJoin() {
  if (settingsMenu) {
    settingsMenu.hidden = true;
    if (settingsToggle) {
      settingsToggle.setAttribute('aria-expanded', 'false');
    }
  }

  videoPlayer.createPlayer(playerDiv, lockMouseCheck);
  // Call play() while the Join click still carries browser user activation.
  // Waiting for loadedmetadata is too late for streams that include audio.
  videoPlayer.startPlayback();
  if (webcamCheck && webcamCheck.checked) {
    void startWebcam();
  }
}

async function onClickDisconnectButton() {
  await teardownConnection('Disconnected.');
}

async function setupRenderStreaming() {
  codecPreferences.disabled = true;

  if (!admissionToken || !admissionIdentity) {
    throw new Error('Admission was not completed.');
  }
  window.RENDER_STREAMING_CONFIG = window.RENDER_STREAMING_CONFIG || {};
  window.RENDER_STREAMING_CONFIG.sessionToken = admissionToken;

  const signaling = useWebSocket ? new WebSocketSignaling() : new Signaling();
  const config = getRTCConfiguration();
  renderstreaming = new RenderStreaming(signaling, config);
  renderstreaming.onConnect = onConnect;
  renderstreaming.onDisconnect = onDisconnect;
  renderstreaming.onTrackEvent = onRemoteTrack;
  renderstreaming.onGotOffer = setCodecPreferences;

  await renderstreaming.start();
  const connectionId = createConnectionId(admissionIdentity.username, admissionIdentity.profile);
  await renderstreaming.createConnection(connectionId);
  armMediaStartTimeout();
}

function onRemoteTrack(data) {
  videoPlayer.addTrack(data.track);
  if (data.track && data.track.kind === 'video') {
    clearMediaStartTimeout();
    mediaReconnectAttempts = 0;
    setStatusMessage('');
    scheduleMicrophoneStart();
  }
}

async function onConnect() {
  createInputChannel();
  createWebcamControlChannel();
  if (webcamCheck && webcamCheck.checked) {
    await startWebcam();
  }
  if (mediaReconnectAttempts === 0) {
    setStatusMessage('');
  }
  setUiState('connected');
  showStatsMessage();
}

async function onDisconnect(connectionId) {
  const display = typeof connectionId === 'string' ? connectionId : 'session';
  const message = display.startsWith('Receive disconnect message') ? 'Disconnected.' : `Disconnected from ${display}.`;
  await teardownConnection(message);
}

async function teardownConnection(message, showReady = true) {
  if (isTearingDown) {
    return;
  }
  isTearingDown = true;
  clearStatsMessage();
  clearMediaStartTimeout();
  clearMicrophoneStart();
  setStatusMessage(message || '');

  if (renderstreaming) {
    await renderstreaming.stop();
    renderstreaming = null;
  }

  resetInputChannelState();
  resetWebcamControlChannel();
  videoPlayer.deletePlayer();
  stopMicrophone();
  stopWebcam();
  micTransceiver = null;
  webcamTransceiver = null;
  if (supportsSetCodecPreferences) {
    codecPreferences.disabled = false;
  }
  if (showReady) {
    setUiState('ready');
    joinButton.disabled = admissionKind == null;
    if (admissionKind === 'guest') {
      joinButton.textContent = 'Enter Green Room';
    }
  }
  isTearingDown = false;
}

function armMediaStartTimeout() {
  clearMediaStartTimeout();
  mediaStartTimer = setTimeout(async () => {
    mediaStartTimer = null;
    if (!renderstreaming || isTearingDown) {
      return;
    }

    const video = document.getElementById('Video');
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      mediaReconnectAttempts = 0;
      return;
    }

    if (mediaReconnectAttempts >= MAX_MEDIA_RECONNECT_ATTEMPTS) {
      setStatusMessage('No video received. Restart Unity Play mode, then click Disconnect and Join.');
      return;
    }

    mediaReconnectAttempts++;
    await teardownConnection('', false);
    await new Promise(resolve => setTimeout(resolve, MEDIA_RECONNECT_DELAY_MS));
    setStatusMessage(`Waiting for Unity video. Reconnecting (${mediaReconnectAttempts}/${MAX_MEDIA_RECONNECT_ATTEMPTS})...`);
    setUiState('connecting');
    videoPlayer.createPlayer(playerDiv, lockMouseCheck);
    videoPlayer.startPlayback();
    await setupRenderStreaming();
  }, MEDIA_START_TIMEOUT_MS);
}

function clearMediaStartTimeout() {
  if (mediaStartTimer != null) {
    clearTimeout(mediaStartTimer);
    mediaStartTimer = null;
  }
}

function scheduleMicrophoneStart() {
  clearMicrophoneStart();
  if (!micCheck || !micCheck.checked) {
    return;
  }

  // Unity adds outbound media immediately after the initial data-channel
  // answer. Let that offer/answer settle before the browser adds its mic
  // transceiver, otherwise both impolite peers can reject each other's offer.
  microphoneStartTimer = setTimeout(() => {
    microphoneStartTimer = null;
    if (renderstreaming && !isTearingDown && micCheck.checked) {
      void startMicrophone();
    }
  }, MICROPHONE_START_DELAY_MS);
}

function clearMicrophoneStart() {
  if (microphoneStartTimer != null) {
    clearTimeout(microphoneStartTimer);
    microphoneStartTimer = null;
  }
}

function createInputChannel() {
  if (!renderstreaming) {
    return;
  }

  const channel = renderstreaming.createDataChannel(INPUT_CHANNEL_LABEL);

  if (!channel) {
    scheduleInputChannelRecovery();
    return;
  }

  inputChannel = channel;
  bindInputChannelLifecycle(channel);
  videoPlayer.setupInput(channel);
  armInputChannelOpenTimeout(channel);
}

function bindInputChannelLifecycle(channel) {
  const onOpen = () => {
    if (channel !== inputChannel) {
      return;
    }
    clearInputChannelOpenTimeout();
    clearInputChannelRecovery();
    if (inputChannelRecovering) {
      inputChannelRecovering = false;
      setStatusMessage('');
    }
  };

  const onInterrupted = () => {
    if (channel !== inputChannel) {
      return;
    }
    scheduleInputChannelRecovery();
  };

  if (channel.addEventListener) {
    channel.addEventListener('open', onOpen);
    channel.addEventListener('close', onInterrupted);
    channel.addEventListener('error', onInterrupted);
  } else {
    channel.onopen = onOpen;
    channel.onclose = onInterrupted;
    channel.onerror = onInterrupted;
  }
}

function armInputChannelOpenTimeout(channel) {
  clearInputChannelOpenTimeout();
  inputChannelOpenTimer = setTimeout(() => {
    if (!renderstreaming || isTearingDown) {
      return;
    }
    if (channel !== inputChannel) {
      return;
    }
    if (channel.readyState === 'open') {
      return;
    }
    scheduleInputChannelRecovery();
  }, INPUT_CHANNEL_OPEN_TIMEOUT_MS);
}

function clearInputChannelOpenTimeout() {
  if (inputChannelOpenTimer != null) {
    clearTimeout(inputChannelOpenTimer);
    inputChannelOpenTimer = null;
  }
}

function clearInputChannelRecovery() {
  if (inputChannelRecoveryTimer != null) {
    clearTimeout(inputChannelRecoveryTimer);
    inputChannelRecoveryTimer = null;
  }
}

function scheduleInputChannelRecovery() {
  if (!renderstreaming || isTearingDown) {
    return;
  }

  clearInputChannelOpenTimeout();
  if (inputChannelRecoveryTimer != null) {
    return;
  }

  inputChannelRecovering = true;
  setStatusMessage('Input controls interrupted. Reconnecting controls...');
  inputChannelRecoveryTimer = setTimeout(() => {
    inputChannelRecoveryTimer = null;
    if (!renderstreaming || isTearingDown) {
      return;
    }
    createInputChannel();
  }, INPUT_CHANNEL_RECOVERY_DELAY_MS);
}

function resetInputChannelState() {
  clearInputChannelOpenTimeout();
  clearInputChannelRecovery();
  inputChannelRecovering = false;
  inputChannel = null;
}

function createWebcamControlChannel() {
  if (!renderstreaming || !(webcamCheck && webcamCheck.checked)) {
    updateWebcamModeControls();
    return;
  }

  if (webcamControlChannel &&
      (webcamControlChannel.readyState === 'open' || webcamControlChannel.readyState === 'connecting')) {
    return;
  }

  const channel = renderstreaming.createDataChannel(WEBCAM_CONTROL_CHANNEL_LABEL);
  if (!channel) {
    scheduleWebcamControlRecovery();
    return;
  }

  webcamControlChannel = channel;
  const onOpen = () => {
    if (channel !== webcamControlChannel) {
      return;
    }
    clearWebcamControlRecovery();
    updateWebcamModeControls();
  };
  const onInterrupted = () => {
    if (channel !== webcamControlChannel) {
      return;
    }
    webcamControlChannel = null;
    webcamModePending = false;
    webcamSessionActive = false;
    updateWebcamModeControls();
    scheduleWebcamControlRecovery();
  };
  const onMessage = event => handleWebcamControlMessage(event.data);

  if (channel.addEventListener) {
    channel.addEventListener('open', onOpen);
    channel.addEventListener('close', onInterrupted);
    channel.addEventListener('error', onInterrupted);
    channel.addEventListener('message', onMessage);
  } else {
    channel.onopen = onOpen;
    channel.onclose = onInterrupted;
    channel.onerror = onInterrupted;
    channel.onmessage = onMessage;
  }
}

function scheduleWebcamControlRecovery() {
  if (!renderstreaming || isTearingDown || !(webcamCheck && webcamCheck.checked) || webcamControlRecoveryTimer != null) {
    return;
  }
  webcamControlRecoveryTimer = setTimeout(() => {
    webcamControlRecoveryTimer = null;
    createWebcamControlChannel();
  }, INPUT_CHANNEL_RECOVERY_DELAY_MS);
}

function clearWebcamControlRecovery() {
  if (webcamControlRecoveryTimer != null) {
    clearTimeout(webcamControlRecoveryTimer);
    webcamControlRecoveryTimer = null;
  }
}

function resetWebcamControlChannel() {
  clearWebcamControlRecovery();
  const channel = webcamControlChannel;
  webcamControlChannel = null;
  if (channel && channel.readyState !== 'closed') {
    channel.close();
  }
  webcamMode = 'tv-screen';
  webcamModePending = false;
  webcamSessionActive = false;
  updateWebcamModeControls();
}

function handleWebcamControlMessage(raw) {
  if (typeof raw !== 'string') {
    return;
  }

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type === 'state' && ['tv-screen', 'tv-man', 'full-control'].includes(message.mode)) {
    webcamMode = message.mode;
    webcamModePending = false;
    webcamSessionActive = message.active === true;
    if (webcamSessionActive) {
      setStatusMessage('');
    }
    updateWebcamModeControls();
  } else if (message.type === 'error') {
    webcamModePending = false;
    setStatusMessage(message.error || 'Webcam mode change failed.');
    updateWebcamModeControls();
  }
}

async function requestWebcamMode(mode) {
  if (!webcamControlChannel || webcamControlChannel.readyState !== 'open' || webcamModePending) {
    setStatusMessage('Webcam controls are still connecting.');
    return;
  }
  if (!webcamSessionActive) {
    setStatusMessage('Webcam stream is still connecting to Unity.');
    return;
  }

  if (mode === 'tv-man' && !window.confirm('Enter TV Man? You will control the TV Man with clicks or WASD while the rest of the client controls stay locked.')) {
    return;
  }
  if (mode === 'full-control' && !window.confirm('Enter Full Control? This enables the complete client interface and controls.')) {
    return;
  }

  webcamModePending = true;
  updateWebcamModeControls();
  webcamControlChannel.send(JSON.stringify({ type: 'set-mode', mode }));
}

function updateWebcamModeControls() {
  if (!webcamModeControls) {
    return;
  }

  const visible = document.body.dataset.state === 'connected' && !!(webcamCheck && webcamCheck.checked);
  webcamModeControls.hidden = !visible;
  if (!visible) {
    return;
  }

  if (webcamPrimaryMode) {
    webcamPrimaryMode.textContent = webcamMode === 'tv-man' ? 'Return to TV Screen' : 'Enter TV Man';
    webcamPrimaryMode.disabled = webcamModePending || !webcamSessionActive;
  }
  if (webcamSecondaryMode) {
    webcamSecondaryMode.textContent = webcamMode === 'full-control' ? 'Return to TV Screen' : 'Enter Full Control';
    webcamSecondaryMode.disabled = webcamModePending || !webcamSessionActive;
  }
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

async function setupVideoInputSelect() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return;
  }
  if (!videoSelect) {
    return;
  }

  const deviceInfos = await navigator.mediaDevices.enumerateDevices();
  videoSelect.innerHTML = '';

  for (let i = 0; i !== deviceInfos.length; ++i) {
    const deviceInfo = deviceInfos[i];
    if (deviceInfo.kind === 'videoinput') {
      const option = document.createElement('option');
      option.value = deviceInfo.deviceId;
      option.text = deviceInfo.label || `camera ${videoSelect.length + 1}`;
      videoSelect.appendChild(option);
    }
  }
}

function updateWebcamState() {
  if (webcamStateLabel && webcamCheck) {
    webcamStateLabel.textContent = webcamCheck.checked ? 'Enabled' : 'Disabled';
  }
  if (videoSelect) {
    videoSelect.disabled = !(webcamCheck && webcamCheck.checked);
  }
  if (webcamPreview && webcamPreviewPlaceholder) {
    const wrapper = webcamPreview.closest('.webcam-preview');
    if (wrapper) {
      wrapper.classList.toggle('is-active', !!(webcamCheck && webcamCheck.checked && localVideoTrack));
    }
  }
  updateWebcamModeControls();
}

let localAudioStream = null;
let localAudioRawStream = null;
let localAudioTrack = null;
let rnnoiseProcessor = null;

async function fallbackToRawMicrophoneTrack(reason) {
  if (!localAudioRawStream) {
    return;
  }

  const rawTrack = localAudioRawStream.getAudioTracks()[0];
  if (!rawTrack || rawTrack.readyState !== 'live') {
    return;
  }

  const activeProcessor = rnnoiseProcessor;
  rnnoiseProcessor = null;
  if (activeProcessor) {
    await activeProcessor.close({ stopInputTrack: false }).catch(() => {});
  }

  localAudioTrack = rawTrack;
  localAudioStream = localAudioRawStream;
  localAudioTrack.enabled = micCheck ? micCheck.checked : true;

  try {
    await ensureMicrophoneTrackAttached();
  } catch (err) {
    setStatusMessage(`Microphone send error: ${err.message || err}`);
    micCheck.checked = false;
    updateMicState();
    stopMicrophone();
    return;
  }

  console.warn('[RNNoise] Falling back to direct microphone track:', reason);
  setStatusMessage('RNNoise fallback active: using direct microphone audio.');
}

async function startMicrophone() {
  if (!renderstreaming) {
    return;
  }

  if (localAudioTrack && localAudioTrack.readyState === 'live') {
    localAudioTrack.enabled = true;
    if (rnnoiseProcessor) {
      rnnoiseProcessor.setEnabled(true);
    }
    await ensureMicrophoneTrackAttached();
    return;
  }

  const rnnoiseConfig = getRNNoiseConfiguration();
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
  const constraints = {
    audio: {
      deviceId: audioSelect && audioSelect.value ? { exact: audioSelect.value } : undefined,
      echoCancellation: supported.echoCancellation ? true : undefined,
      noiseSuppression: supported.noiseSuppression ? (rnnoiseConfig.enabled ? false : true) : undefined,
      autoGainControl: supported.autoGainControl ? false : undefined,
      channelCount: supported.channelCount ? 1 : undefined,
      sampleRate: supported.sampleRate ? 48000 : undefined,
      sampleSize: supported.sampleSize ? 16 : undefined
    }
  };

  try {
    localAudioRawStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    setStatusMessage(`Microphone error: ${err.message || err}`);
    micCheck.checked = false;
    updateMicState();
    return;
  }

  const rawTrack = localAudioRawStream.getAudioTracks()[0];
  if (!rawTrack) {
    stopMicrophone();
    return;
  }

  localAudioTrack = rawTrack;
  localAudioStream = localAudioRawStream;

  if (rnnoiseConfig.enabled) {
    try {
      rnnoiseProcessor = await createRnnoiseProcessor(localAudioRawStream, rnnoiseConfig);
      rnnoiseProcessor.setOnError((error) => {
        void fallbackToRawMicrophoneTrack(error);
      });
      localAudioTrack = rnnoiseProcessor.getTrack();
      localAudioStream = new MediaStream([localAudioTrack]);
    } catch (err) {
      await fallbackToRawMicrophoneTrack(err);
    }
  }

  if (!localAudioTrack) {
    stopMicrophone();
    return;
  }

  try {
    await ensureMicrophoneTrackAttached();
  } catch (err) {
    setStatusMessage(`Microphone send error: ${err.message || err}`);
    micCheck.checked = false;
    updateMicState();
    stopMicrophone();
  }
}

async function ensureMicrophoneTrackAttached() {
  if (!renderstreaming || !localAudioTrack) {
    return;
  }

  if (micTransceiver && micTransceiver.sender) {
    try {
      await micTransceiver.sender.replaceTrack(localAudioTrack);
      return;
    } catch (err) {
      // fall through to create a new transceiver
    }
  }

  micTransceiver = renderstreaming.addTransceiver(localAudioTrack, { direction: 'sendonly' });
}

function stopMicrophone() {
  if (micTransceiver && micTransceiver.sender) {
    micTransceiver.sender.replaceTrack(null).catch(() => {});
  }

  if (rnnoiseProcessor) {
    void rnnoiseProcessor.close();
    rnnoiseProcessor = null;
  }

  if (localAudioTrack) {
    localAudioTrack.stop();
    localAudioTrack = null;
  }

  if (localAudioRawStream) {
    localAudioRawStream.getTracks().forEach(track => track.stop());
    localAudioRawStream = null;
  }

  localAudioStream = null;
}

function updateMicState() {
  if (micStateLabel && micCheck) {
    micStateLabel.textContent = micCheck.checked ? 'Enabled' : 'Disabled';
  }
  if (audioSelect) {
    audioSelect.disabled = !micCheck.checked;
  }
}

async function startWebcam() {

  if (localVideoTrack && localVideoTrack.readyState === 'live') {
    localVideoTrack.enabled = true;
    updateWebcamState();
    await ensureWebcamTrackAttached();
    createWebcamControlChannel();
    return;
  }

  const constraints = {
    video: {
      deviceId: videoSelect && videoSelect.value ? { exact: videoSelect.value } : undefined
    }
  };

  try {
    localVideoStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    setStatusMessage(`Webcam error: ${err.message || err}`);
    if (webcamCheck) {
      webcamCheck.checked = false;
    }
    resetWebcamControlChannel();
    updateWebcamState();
    return;
  }

  localVideoTrack = localVideoStream.getVideoTracks()[0];
  if (!localVideoTrack) {
    resetWebcamControlChannel();
    return;
  }

  if (webcamPreview) {
    webcamPreview.srcObject = localVideoStream;
    webcamPreview.play?.().catch(() => {});
  }
  updateWebcamState();
  await ensureWebcamTrackAttached();
  createWebcamControlChannel();
}

async function ensureWebcamTrackAttached() {
  if (!renderstreaming || !localVideoTrack) {
    return;
  }

  if (webcamTransceiver && webcamTransceiver.sender) {
    try {
      await webcamTransceiver.sender.replaceTrack(localVideoTrack);
      return;
    } catch (err) {
      // fall through to create a new transceiver
    }
  }

  webcamTransceiver = renderstreaming.addTransceiver(localVideoTrack, { direction: 'sendonly' });
}

function stopWebcam() {
  if (localVideoTrack) {
    localVideoTrack.stop();
    localVideoTrack = null;
  }
  if (webcamTransceiver && webcamTransceiver.sender) {
    webcamTransceiver.sender.replaceTrack(null).catch(() => {});
  }
  localVideoStream = null;
  if (webcamPreview) {
    webcamPreview.srcObject = null;
  }
  resetWebcamControlChannel();
  updateWebcamState();
}

if (micCheck) {
  micCheck.addEventListener('change', async () => {
    updateMicState();
    if (micCheck.checked) {
      await startMicrophone();
    } else if (localAudioTrack) {
      localAudioTrack.enabled = false;
      if (rnnoiseProcessor) {
        rnnoiseProcessor.setEnabled(false);
      }
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
  navigator.mediaDevices.addEventListener('devicechange', () => {
    void setupAudioInputSelect();
    void setupVideoInputSelect();
  });
}

function createConnectionId(username, profile) {
  const base = username || 'guest';
  const identityProfile = profile || 'guest';
  if (window.crypto && window.crypto.randomUUID) {
    return `${base}~${identityProfile}~${window.crypto.randomUUID()}`;
  }
  const rand = Math.random().toString(36).slice(2);
  return `${base}~${identityProfile}~${rand}`;
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

async function setupAdmission() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (params.has('cast')) {
    admissionKind = 'cast';
    admissionKey = params.get('cast') || '';
    try {
      const result = await admissionFetch('/admission/cast', {
        method: 'POST',
        body: JSON.stringify({ key: admissionKey }),
      });
      admissionIdentity = result.identity;
      admissionToken = result.token;
      usernameInput.value = sanitizeUsername(result.identity.username);
      usernameInput.readOnly = false;
      joinButton.disabled = false;
      setStatusMessage('Cast pass recognized. You can change the username for testing.');
    } catch (error) {
      disableAdmission(error);
    }
  } else if (params.has('guest')) {
    admissionKind = 'guest';
    admissionKey = params.get('guest') || '';
    usernameInput.readOnly = true;
    joinButton.textContent = 'Enter Green Room';
    try {
      const result = await admissionFetch('/admission/guest/preview', {
        method: 'POST',
        body: JSON.stringify({ key: admissionKey }),
      });
      admissionIdentity = result.identity;
      usernameInput.value = sanitizeUsername(result.identity.username);
      joinButton.disabled = false;
      setStatusMessage('Check your microphone or webcam, then enter the green room.');
    } catch (error) {
      disableAdmission(error);
    }
  } else {
    disableAdmission(new Error('This page requires a private cast or guest access link.'));
  }

}

async function admissionFetch(path, init = {}) {
  const baseUrl = (window.RENDER_STREAMING_CONFIG?.signalingBaseUrl || window.location.origin).replace(/\/$/, '');
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Access could not be verified.');
  }
  return payload;
}

async function waitForGuestApproval(pendingId) {
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const result = await admissionFetch(`/admission/guest/${encodeURIComponent(pendingId)}`);
    if (result.status === 'approved' && result.token) {
      admissionIdentity = result.identity;
      usernameInput.value = sanitizeUsername(result.identity.username);
      return result.token;
    }
  }
}

function disableAdmission(error) {
  admissionKind = null;
  admissionKey = '';
  admissionToken = '';
  joinButton.disabled = true;
  setStatusMessage(error instanceof Error ? error.message : String(error));
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

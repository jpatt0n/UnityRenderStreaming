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
const greenRoomBanner = document.getElementById('greenRoomBanner');
const greenRoomTitle = document.getElementById('greenRoomTitle');
const greenRoomDetail = document.getElementById('greenRoomDetail');
const micToggleButton = document.getElementById('micToggleButton');
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
const GREEN_ROOM_CHANNEL_LABEL = "green-room";
const GREEN_ROOM_ADMITTED_BANNER_MS = 6000;
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
let greenRoomChannel = null;
let greenRoomRecoveryTimer = null;
let greenRoomBannerTimer = null;
/**
 * Whether this page is a guest's, and so subject to the green room at all. Cast members are never
 * held: their pass already says they belong in the room.
 */
let isGreenRoomGuest = false;
/** Whether the show has let this guest in. Unity is the only thing that sets it. */
let greenRoomAdmitted = false;
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
let webcamStartPromise = null;
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
  const showSettings = state === 'ready' || state === 'disconnected';

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
  updateGreenRoomBanner();

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
      // The green room is inside the show now: this session connects them straight away, and Unity
      // holds them off air rather than the signaling host holding them outside.
      setStatusMessage('Entering the green room...');
      const result = await admissionFetch('/admission/guest', {
        method: 'POST',
        body: JSON.stringify({ key: admissionKey }),
      });
      admissionIdentity = result.identity;
      admissionToken = result.token;
      usernameInput.value = sanitizeUsername(result.identity.username);
    } else {
      throw new Error('A valid cast or guest access link is required.');
    }

    setStatusMessage(isGreenRoomGuest ? 'Entering the green room...' : 'Connecting...');
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
  if (webcamCheck && webcamCheck.checked && mayGoLive()) {
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
  createGreenRoomChannel();
  createWebcamControlChannel();
  if (webcamCheck && webcamCheck.checked && mayGoLive()) {
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
  resetGreenRoomChannel();
  videoPlayer.deletePlayer();
  stopMicrophone();
  stopWebcam();
  micTransceiver = null;
  webcamTransceiver = null;
  if (supportsSetCodecPreferences) {
    codecPreferences.disabled = false;
  }
  // Admission does not survive the connection that carried it. A guest who reconnects arrives in
  // the green room again, which is also what Unity does with them.
  greenRoomAdmitted = false;
  updateGreenRoomBanner();
  updateMicState();
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

    // A guest is expected to arrive before the show does, now that entering the green room means
    // connecting to it. Giving up after three tries would strand anyone early, so they keep waiting
    // and are told they are waiting for the show rather than told to restart Unity.
    if (!isGreenRoomGuest && mediaReconnectAttempts >= MAX_MEDIA_RECONNECT_ATTEMPTS) {
      setStatusMessage('No video received. Restart Unity Play mode, then click Disconnect and Join.');
      return;
    }

    mediaReconnectAttempts++;
    await teardownConnection('', false);
    await new Promise(resolve => setTimeout(resolve, MEDIA_RECONNECT_DELAY_MS));
    setStatusMessage(isGreenRoomGuest
      ? 'Waiting for the show to come up. You will be connected to the green room automatically.'
      : `Waiting for Unity video. Reconnecting (${mediaReconnectAttempts}/${MAX_MEDIA_RECONNECT_ATTEMPTS})...`);
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
  if (!micCheck || !micCheck.checked || !mayGoLive()) {
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

/**
 * Opens the channel Unity uses to tell a guest whether they are still waiting or have been let in.
 * Guests only - a cast member has nothing to be told.
 */
function createGreenRoomChannel() {
  if (!renderstreaming || !isGreenRoomGuest) {
    return;
  }

  if (greenRoomChannel &&
      (greenRoomChannel.readyState === 'open' || greenRoomChannel.readyState === 'connecting')) {
    return;
  }

  const channel = renderstreaming.createDataChannel(GREEN_ROOM_CHANNEL_LABEL);
  if (!channel) {
    scheduleGreenRoomRecovery();
    return;
  }

  greenRoomChannel = channel;
  const onOpen = () => {
    if (channel !== greenRoomChannel) {
      return;
    }
    clearGreenRoomRecovery();
  };
  const onInterrupted = () => {
    if (channel !== greenRoomChannel) {
      return;
    }
    greenRoomChannel = null;
    scheduleGreenRoomRecovery();
  };
  const onMessage = event => handleGreenRoomMessage(event.data);

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

function scheduleGreenRoomRecovery() {
  if (!renderstreaming || isTearingDown || !isGreenRoomGuest || greenRoomRecoveryTimer != null) {
    return;
  }
  greenRoomRecoveryTimer = setTimeout(() => {
    greenRoomRecoveryTimer = null;
    createGreenRoomChannel();
  }, INPUT_CHANNEL_RECOVERY_DELAY_MS);
}

function clearGreenRoomRecovery() {
  if (greenRoomRecoveryTimer != null) {
    clearTimeout(greenRoomRecoveryTimer);
    greenRoomRecoveryTimer = null;
  }
}

function resetGreenRoomChannel() {
  clearGreenRoomRecovery();
  const channel = greenRoomChannel;
  greenRoomChannel = null;
  if (channel && channel.readyState !== 'closed') {
    channel.close();
  }
}

function handleGreenRoomMessage(raw) {
  if (typeof raw !== 'string') {
    return;
  }

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type === 'state') {
    void applyGreenRoomAdmission(message.admitted === true);
  }
}

/**
 * Moves the page between waiting and being on air. Everything the guest sends is downstream of this
 * one flag, so admission opens the microphone and camera in the same breath as it changes the words
 * on the banner.
 */
async function applyGreenRoomAdmission(admitted) {
  if (greenRoomAdmitted === admitted) {
    updateGreenRoomBanner();
    updateMicState();
    return;
  }

  greenRoomAdmitted = admitted;
  updateGreenRoomBanner();
  updateMicState();
  updateWebcamModeControls();

  if (!admitted) {
    return;
  }

  // Only now does anything of theirs reach the show. Both devices were left closed until this
  // point, so this is the first getUserMedia call the page makes. The microphone goes through
  // scheduleMicrophoneStart for its settle delay, in case a cast member is quick enough on the
  // button to land the new transceiver inside the initial negotiation.
  scheduleMicrophoneStart();
  if (webcamCheck && webcamCheck.checked) {
    await startWebcam();
  }
}

function updateGreenRoomBanner() {
  if (!greenRoomBanner) {
    return;
  }

  if (greenRoomBannerTimer != null) {
    clearTimeout(greenRoomBannerTimer);
    greenRoomBannerTimer = null;
  }

  const connected = document.body.dataset.state === 'connected';
  if (!isGreenRoomGuest || !connected) {
    greenRoomBanner.hidden = true;
    return;
  }

  greenRoomBanner.hidden = false;
  greenRoomBanner.classList.toggle('is-admitted', greenRoomAdmitted);

  if (!greenRoomAdmitted) {
    if (greenRoomTitle) {
      greenRoomTitle.textContent = 'You are in the green room';
    }
    if (greenRoomDetail) {
      greenRoomDetail.textContent =
        'You can see and hear the show, but nobody can see or hear you: your microphone is off and '
        + 'your camera is not being sent. A cast member will bring you in.';
    }
    return;
  }

  if (greenRoomTitle) {
    greenRoomTitle.textContent = 'You are in';
  }
  if (greenRoomDetail) {
    const micWanted = !!(micCheck && micCheck.checked);
    const camWanted = !!(webcamCheck && webcamCheck.checked);
    const live = [micWanted ? 'microphone' : null, camWanted ? 'camera' : null].filter(Boolean);
    greenRoomDetail.textContent = live.length
      ? `Your ${live.join(' and ')} ${live.length > 1 ? 'are' : 'is'} now live.`
      : 'Your microphone is still off - turn it on when you are ready.';
  }

  greenRoomBannerTimer = setTimeout(() => {
    greenRoomBannerTimer = null;
    greenRoomBanner.hidden = true;
  }, GREEN_ROOM_ADMITTED_BANNER_MS);
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
    const settings = localVideoTrack && localVideoTrack.readyState === 'live'
      ? localVideoTrack.getSettings?.()
      : null;
    const resolution = settings && settings.width && settings.height
      ? ` · ${settings.width}×${settings.height}`
      : '';
    webcamStateLabel.textContent = webcamCheck.checked ? `Enabled${resolution}` : 'Disabled';
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
  // The last gate before anything of the guest's reaches the wire. Every caller checks first; this
  // is here so that no future one has to be trusted to.
  if (!renderstreaming || !localAudioTrack || !mayGoLive()) {
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
  const wanted = !!(micCheck && micCheck.checked);
  const live = wanted && mayGoLive();

  if (micStateLabel && micCheck) {
    micStateLabel.textContent = wanted
      ? (live ? 'Enabled' : 'Enabled once you are brought in')
      : 'Disabled';
  }
  if (audioSelect) {
    audioSelect.disabled = !wanted;
  }

  if (micToggleButton) {
    // Muted is the loud state: a guest needs to be able to tell at a glance that the room cannot
    // hear them, and waiting in the green room is a kind of muted they did not choose - so it reads
    // as muted, in its own colour.
    micToggleButton.classList.toggle('is-muted', !live);
    micToggleButton.classList.toggle('is-held', wanted && !live);
    micToggleButton.setAttribute('aria-pressed', (!live).toString());

    // Still live while a guest waits: what it sets then is what happens the moment they are let in.
    const label = mayGoLive()
      ? (live ? 'Mute microphone' : 'Unmute microphone')
      : (wanted
        ? 'Your microphone will go live when a cast member brings you in - click to arrive muted'
        : 'You will arrive muted - click to go live when a cast member brings you in');
    micToggleButton.setAttribute('aria-label', label);
    micToggleButton.title = label;
  }
}

/**
 * Whether this page may put a microphone on the wire at all. False for the whole of a guest's stay
 * in the green room - not a mute, but a microphone that was never opened.
 */
function mayGoLive() {
  return !isGreenRoomGuest || greenRoomAdmitted;
}

/**
 * The one way the microphone changes, for both the settings toggle and the quick button in the
 * connected toolbar. They are two views of a single piece of state, so neither may set it alone.
 */
async function setMicEnabled(enabled) {
  if (!micCheck) {
    return;
  }

  micCheck.checked = enabled;
  updateMicState();

  if (!mayGoLive()) {
    return;
  }

  if (enabled) {
    await startMicrophone();
    return;
  }

  if (localAudioTrack) {
    localAudioTrack.enabled = false;
    if (rnnoiseProcessor) {
      rnnoiseProcessor.setEnabled(false);
    }
  }
}

async function startWebcam() {
  if (webcamStartPromise) {
    return webcamStartPromise;
  }

  webcamStartPromise = startWebcamInternal();
  try {
    await webcamStartPromise;
  } finally {
    webcamStartPromise = null;
  }
}

async function startWebcamInternal() {

  if (localVideoTrack && localVideoTrack.readyState === 'live') {
    localVideoTrack.enabled = true;
    updateWebcamState();
    await ensureWebcamTrackAttached();
    createWebcamControlChannel();
    return;
  }

  const constraints = {
    video: {
      deviceId: videoSelect && videoSelect.value ? { exact: videoSelect.value } : undefined,
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30 }
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

  await requestHighestWebcamResolution(localVideoTrack);
  localVideoTrack.contentHint = 'detail';

  if (webcamPreview) {
    webcamPreview.srcObject = localVideoStream;
    webcamPreview.play?.().catch(() => {});
  }
  updateWebcamState();
  await ensureWebcamTrackAttached();
  createWebcamControlChannel();
}

async function requestHighestWebcamResolution(track) {
  if (!track || typeof track.getCapabilities !== 'function' || typeof track.applyConstraints !== 'function') {
    return;
  }

  const capabilities = track.getCapabilities();
  const maxWidth = Number.isFinite(capabilities.width?.max) ? capabilities.width.max : 0;
  const maxHeight = Number.isFinite(capabilities.height?.max) ? capabilities.height.max : 0;
  if (!maxWidth || !maxHeight) {
    return;
  }

  const maxFrameRate = Number.isFinite(capabilities.frameRate?.max)
    ? Math.min(capabilities.frameRate.max, 30)
    : 30;
  const resolutions = [
    [maxWidth, maxHeight],
    [3840, 2160],
    [2560, 1440],
    [1920, 1080],
    [1600, 1200],
    [1280, 720]
  ]
    .filter(([width, height]) => width <= maxWidth && height <= maxHeight)
    .filter(([width, height], index, values) =>
      values.findIndex(candidate => candidate[0] === width && candidate[1] === height) === index)
    .sort((a, b) => (b[0] * b[1]) - (a[0] * a[1]));

  for (const [width, height] of resolutions) {
    try {
      await track.applyConstraints({
        width: { exact: width },
        height: { exact: height },
        frameRate: { ideal: maxFrameRate }
      });
      const settings = track.getSettings?.() || {};
      console.info(`Webcam negotiated at ${settings.width || width}×${settings.height || height}.`);
      return;
    } catch {
      // The device can advertise independent maxima that are not a supported pair.
      // Continue through common resolutions from highest to lowest.
    }
  }

  try {
    await track.applyConstraints({
      width: { ideal: maxWidth },
      height: { ideal: maxHeight },
      frameRate: { ideal: maxFrameRate }
    });
  } catch (error) {
    console.warn('Could not apply the webcam maximum-resolution preference.', error);
  }
}

async function configureWebcamSender(sender) {
  if (!sender || typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') {
    return;
  }

  const settings = localVideoTrack?.getSettings?.() || {};
  const pixels = (settings.width || 1920) * (settings.height || 1080);
  const maxBitrate = pixels >= 3840 * 2160 ? 20000000 : pixels >= 1920 * 1080 ? 8000000 : 4000000;
  const parameters = sender.getParameters();
  parameters.degradationPreference = 'maintain-resolution';
  for (const encoding of parameters.encodings || []) {
    encoding.maxBitrate = Math.max(encoding.maxBitrate || 0, maxBitrate);
    encoding.scaleResolutionDownBy = 1;
  }

  try {
    await sender.setParameters(parameters);
  } catch (error) {
    console.warn('Could not apply the webcam high-resolution sender preference.', error);
  }
}

async function ensureWebcamTrackAttached() {
  // A waiting guest may still open their camera to check themselves - the preview is local. What
  // they may not do is send it: their face would land on the set's TV mid-scene.
  if (!renderstreaming || !localVideoTrack || !mayGoLive()) {
    return;
  }

  if (webcamTransceiver && webcamTransceiver.sender) {
    try {
      await webcamTransceiver.sender.replaceTrack(localVideoTrack);
      await configureWebcamSender(webcamTransceiver.sender);
      return;
    } catch (err) {
      // fall through to create a new transceiver
    }
  }

  webcamTransceiver = renderstreaming.addTransceiver(localVideoTrack, { direction: 'sendonly' });
  await configureWebcamSender(webcamTransceiver?.sender);
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
    await setMicEnabled(micCheck.checked);
  });
}

if (micToggleButton) {
  micToggleButton.addEventListener('click', async () => {
    await setMicEnabled(!(micCheck && micCheck.checked));
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
    isGreenRoomGuest = true;
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
      setStatusMessage(
        'Check your microphone or webcam, then enter the green room. '
        + 'You will be able to see and hear the show while you wait, but your microphone stays off '
        + 'until a cast member brings you in.');
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

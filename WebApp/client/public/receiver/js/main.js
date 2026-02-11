import { getServerConfig, getRTCConfiguration } from "../../js/config.js";
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
let webcamTransceiver = null;
let micTransceiver = null;
let localVideoStream = null;
let localVideoTrack = null;
let microphonePipeline = null;

const DEFAULT_GTCRN_ASSETS_BASE_URL = new URL('../gtcrn/', import.meta.url).toString();
const globalConfig = window.RENDER_STREAMING_CONFIG || {};
let gtcrnRuntimePromise = null;
const loadedScriptPromises = new Map();

const gtcrnConfig = (() => {
  const gtcrn = globalConfig.gtcrn || {};
  const wasmBaseUrl = ensureTrailingSlash(
    typeof gtcrn.assetsBaseUrl === 'string' && gtcrn.assetsBaseUrl
      ? gtcrn.assetsBaseUrl
      : DEFAULT_GTCRN_ASSETS_BASE_URL
  );

  return {
    enabled: gtcrn.enabled !== false,
    debug: Number.isInteger(gtcrn.debug) ? gtcrn.debug : 0,
    numThreads: Number.isInteger(gtcrn.numThreads) && gtcrn.numThreads > 0 ? gtcrn.numThreads : 1,
    provider: typeof gtcrn.provider === 'string' && gtcrn.provider ? gtcrn.provider : 'cpu',
    modelPath: typeof gtcrn.modelPath === 'string' ? gtcrn.modelPath.trim() : '',
    wasmBaseUrl,
    wasmMainScriptUrl: typeof gtcrn.wasmMainScriptUrl === 'string' && gtcrn.wasmMainScriptUrl
      ? gtcrn.wasmMainScriptUrl
      : `${wasmBaseUrl}sherpa-onnx-wasm-main-speech-enhancement.js`,
    speechEnhancementScriptUrl: typeof gtcrn.speechEnhancementScriptUrl === 'string' && gtcrn.speechEnhancementScriptUrl
      ? gtcrn.speechEnhancementScriptUrl
      : `${wasmBaseUrl}sherpa-onnx-speech-enhancement.js`
  };
})();

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
  updateMicState();
  updateWebcamState();
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
  if (webcamCheck && webcamCheck.checked) {
    void startWebcam();
  }
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
  if (webcamCheck && webcamCheck.checked) {
    await startWebcam();
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
  stopWebcam();
  micTransceiver = null;
  webcamTransceiver = null;
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
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function ignoreError() {}

function loadScriptOnce(src) {
  if (loadedScriptPromises.has(src)) {
    return loadedScriptPromises.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
  loadedScriptPromises.set(src, promise);
  return promise;
}

async function getGtcrnRuntime() {
  if (gtcrnRuntimePromise) {
    return gtcrnRuntimePromise;
  }

  gtcrnRuntimePromise = (async () => {
    if (
      typeof window.createOfflineSpeechDenoiser === 'function' &&
      window.Module &&
      (window.Module.__gtcrnRuntimeReady === true || window.Module.calledRun === true)
    ) {
      return { Module: window.Module, createOfflineSpeechDenoiser: window.createOfflineSpeechDenoiser };
    }

    let readyTimeout = null;
    const module = window.Module || {};
    window.Module = module;
    module.locateFile = (path) => new URL(path, gtcrnConfig.wasmBaseUrl).toString();
    const runtimeReady = new Promise((resolve, reject) => {
      readyTimeout = window.setTimeout(() => {
        reject(new Error('Timed out waiting for GTCRN WebAssembly runtime initialization.'));
      }, 60000);
      module.onRuntimeInitialized = () => {
        if (readyTimeout) {
          clearTimeout(readyTimeout);
          readyTimeout = null;
        }
        module.__gtcrnRuntimeReady = true;
        resolve();
      };
      module.onAbort = (reason) => {
        if (readyTimeout) {
          clearTimeout(readyTimeout);
          readyTimeout = null;
        }
        reject(new Error(`GTCRN WebAssembly aborted: ${reason || 'unknown reason'}`));
      };
    });

    await loadScriptOnce(gtcrnConfig.speechEnhancementScriptUrl);
    await loadScriptOnce(gtcrnConfig.wasmMainScriptUrl);
    await runtimeReady;

    if (typeof window.createOfflineSpeechDenoiser !== 'function') {
      throw new Error('GTCRN runtime loaded, but createOfflineSpeechDenoiser is unavailable.');
    }

    return { Module: module, createOfflineSpeechDenoiser: window.createOfflineSpeechDenoiser };
  })().catch((err) => {
    gtcrnRuntimePromise = null;
    throw err;
  });

  return gtcrnRuntimePromise;
}

function appendFloat32(existing, chunk) {
  if (!chunk || chunk.length === 0) {
    return existing;
  }
  if (!existing || existing.length === 0) {
    return chunk;
  }
  const merged = new Float32Array(existing.length + chunk.length);
  merged.set(existing, 0);
  merged.set(chunk, existing.length);
  return merged;
}

function popFloat32(existing, count) {
  if (!existing || existing.length === 0 || count <= 0) {
    return [new Float32Array(0), existing || new Float32Array(0)];
  }

  if (existing.length <= count) {
    return [existing, new Float32Array(0)];
  }

  return [existing.subarray(0, count), existing.subarray(count)];
}

function resampleFloat32Linear(samples, fromRate, toRate) {
  if (!samples || samples.length === 0 || fromRate <= 0 || toRate <= 0 || fromRate === toRate) {
    return samples;
  }

  const ratio = toRate / fromRate;
  const outputLength = Math.max(1, Math.round(samples.length * ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourcePos = i / ratio;
    const leftIndex = Math.floor(sourcePos);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const frac = sourcePos - leftIndex;
    const left = samples[leftIndex];
    const right = samples[rightIndex];
    output[i] = left + (right - left) * frac;
  }

  return output;
}

function getPreferredInputSampleRate(inputStream) {
  const track = inputStream?.getAudioTracks?.()[0];
  const settings = track?.getSettings?.();
  const rate = settings?.sampleRate;
  if (Number.isFinite(rate) && rate >= 8000 && rate <= 192000) {
    return rate;
  }
  return null;
}

async function createGtcrnPipeline(inputStream) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('AudioContext not supported.');
  }

  const runtime = await getGtcrnRuntime();
  const denoiser = gtcrnConfig.modelPath
    ? runtime.createOfflineSpeechDenoiser(runtime.Module, {
      model: {
        gtcrn: {
          model: gtcrnConfig.modelPath
        },
        numThreads: gtcrnConfig.numThreads,
        provider: gtcrnConfig.provider,
        debug: gtcrnConfig.debug
      }
    })
    : runtime.createOfflineSpeechDenoiser(runtime.Module);
  if (!denoiser || typeof denoiser.run !== 'function') {
    throw new Error('Unable to create GTCRN denoiser.');
  }

  const preferredRate = getPreferredInputSampleRate(inputStream);
  let context = null;
  if (preferredRate) {
    try {
      context = new AudioContextCtor({ sampleRate: preferredRate, latencyHint: 'interactive' });
    } catch (err) {
      ignoreError(err);
      context = new AudioContextCtor();
    }
  } else {
    context = new AudioContextCtor();
  }
  const sourceNode = context.createMediaStreamSource(inputStream);
  const processorNode = context.createScriptProcessor(4096, 1, 1);
  const destinationNode = context.createMediaStreamDestination();
  let pendingOutput = new Float32Array(0);
  let disposed = false;

  processorNode.onaudioprocess = (event) => {
    if (disposed) {
      return;
    }

    try {
      const input = Float32Array.from(event.inputBuffer.getChannelData(0));
      const result = denoiser.run(input, context.sampleRate);
      const chunk = result && result.samples ? result.samples : input;
      const denoisedRate = result && Number.isFinite(result.sampleRate) ? result.sampleRate : context.sampleRate;
      const denoisedSamples = chunk instanceof Float32Array ? chunk : Float32Array.from(chunk);
      const samples = resampleFloat32Linear(denoisedSamples, denoisedRate, context.sampleRate);
      pendingOutput = appendFloat32(pendingOutput, samples);
    } catch (err) {
      const fallback = Float32Array.from(event.inputBuffer.getChannelData(0));
      pendingOutput = appendFloat32(pendingOutput, fallback);
      console.warn('GTCRN processing error; falling back to raw frame.', err);
    }

    const output = event.outputBuffer.getChannelData(0);
    output.fill(0);
    const [samples, rest] = popFloat32(pendingOutput, output.length);
    pendingOutput = rest;
    if (samples.length > 0) {
      output.set(samples, 0);
    }
  };

  sourceNode.connect(processorNode);
  processorNode.connect(destinationNode);
  await context.resume();

  const processedTrack = destinationNode.stream.getAudioTracks()[0];
  if (!processedTrack) {
    processorNode.disconnect();
    sourceNode.disconnect();
    denoiser.free?.();
    await context.close();
    throw new Error('GTCRN did not produce an output track.');
  }

  return {
    track: processedTrack,
    cleanup: async () => {
      disposed = true;
      processorNode.onaudioprocess = null;
      try {
        sourceNode.disconnect();
      } catch (err) {
        ignoreError(err);
      }
      try {
        processorNode.disconnect();
      } catch (err) {
        ignoreError(err);
      }
      try {
        destinationNode.disconnect();
      } catch (err) {
        ignoreError(err);
      }
      try {
        denoiser.free?.();
      } catch (err) {
        ignoreError(err);
      }
      try {
        await context.close();
      } catch (err) {
        ignoreError(err);
      }
    }
  };
}

let localAudioStream = null;
let localAudioTrack = null;

async function startMicrophone() {
  if (!renderstreaming) {
    return;
  }

  if (localAudioTrack && localAudioTrack.readyState === 'live') {
    localAudioTrack.enabled = true;
    if (microphonePipeline && microphonePipeline.sourceTrack) {
      microphonePipeline.sourceTrack.enabled = true;
    }
    return;
  }

  const supported = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
  const constraints = {
    audio: {
      deviceId: audioSelect && audioSelect.value ? { exact: audioSelect.value } : undefined,
      echoCancellation: supported.echoCancellation ? true : undefined,
      noiseSuppression: supported.noiseSuppression ? true : undefined,
      autoGainControl: supported.autoGainControl ? true : undefined
    }
  };

  try {
    localAudioStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    setStatusMessage(`Microphone error: ${err.message || err}`);
    micCheck.checked = false;
    updateMicState();
    return;
  }

  localAudioTrack = localAudioStream.getAudioTracks()[0];
  if (!localAudioTrack) {
    return;
  }

  const sourceTrack = localAudioTrack;
  let cleanup = null;

  if (gtcrnConfig.enabled) {
    try {
      const pipeline = await createGtcrnPipeline(localAudioStream);
      localAudioTrack = pipeline.track;
      cleanup = pipeline.cleanup;
      console.info('GTCRN enabled for microphone.');
    } catch (err) {
      console.warn('GTCRN setup failed; using browser microphone track.', err);
    }
  }

  microphonePipeline = {
    sourceTrack,
    cleanup
  };

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

  if (microphonePipeline && typeof microphonePipeline.cleanup === 'function') {
    Promise.resolve(microphonePipeline.cleanup()).catch(() => {});
  }
  microphonePipeline = null;

  if (localAudioTrack) {
    localAudioTrack.enabled = false;
    localAudioTrack.stop();
    localAudioTrack = null;
  }
  if (localAudioStream) {
    localAudioStream.getTracks().forEach((track) => {
      if (track.readyState === 'live') {
        track.stop();
      }
    });
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
    updateWebcamState();
    return;
  }

  localVideoTrack = localVideoStream.getVideoTracks()[0];
  if (!localVideoTrack) {
    return;
  }

  if (webcamPreview) {
    webcamPreview.srcObject = localVideoStream;
    webcamPreview.play?.().catch(() => {});
  }
  updateWebcamState();
  await ensureWebcamTrackAttached();
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
  updateWebcamState();
}

if (micCheck) {
  micCheck.addEventListener('change', async () => {
    updateMicState();
    if (micCheck.checked) {
      await startMicrophone();
    } else if (localAudioTrack) {
      localAudioTrack.enabled = false;
      if (microphonePipeline && microphonePipeline.sourceTrack) {
        microphonePipeline.sourceTrack.enabled = false;
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

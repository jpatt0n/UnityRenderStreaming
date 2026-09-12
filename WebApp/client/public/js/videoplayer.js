import { Observer, Sender } from "../module/sender.js";
import { InputRemoting } from "../module/inputremoting.js";

const INPUT_HEALTH_PROBE = 'URS_INPUT_HEALTH';
const INPUT_READY = 'URS_INPUT_READY';
const INPUT_NEEDS_BOOTSTRAP = 'URS_INPUT_NEEDS_BOOTSTRAP';
const INPUT_HEALTH_INTERVAL_MS = 1000;

function getBasePath() {
  const globalConfig = window.RENDER_STREAMING_CONFIG || {};
  return globalConfig.basePath || (window.location.pathname.startsWith('/rs') ? '/rs' : '');
}

export class VideoPlayer {
  constructor() {
    this.playerElement = null;
    this.lockMouseCheck = null;
    this.videoElement = null;
    this.audioElement = null;
    this.fullScreenButtonElement = null;
    this.soundButtonElement = null;
    this._playbackRequest = 0;
    this.inputRemoting = null;
    this.sender = null;
    this.inputObserver = null;
    this.inputSenderChannel = null;
    this.inputHealthTimer = null;
    this.inputReady = false;
    this.mouseSensitivity = 1;
    this._onMouseMoveHandler = this._mouseMove.bind(this);
    this._onMouseClickFullScreenHandler = this._mouseClickFullScreen.bind(this);
    this._onFullscreenChangeHandler = this._onFullscreenChange.bind(this);
    this._onOpenInputSenderChannelHandler = this._onOpenInputSenderChannel.bind(this);
    this._onCloseInputSenderChannelHandler = this._onCloseInputSenderChannel.bind(this);
    this._onInputSenderChannelMessageHandler = this._onInputSenderChannelMessage.bind(this);
    this._onWindowKeyDownHandler = this._onWindowKeyDown.bind(this);
    this._onWindowBlurHandler = this._onWindowBlur.bind(this);
    this._onPageHideHandler = this._onPageHide.bind(this);
    this._onVisibilityChangeHandler = this._onVisibilityChange.bind(this);
    this._onPointerLockChangeHandler = this._onPointerLockChange.bind(this);
    this._keyboardLockRequest = null;
  }

  /**
 * @param {Element} playerElement parent element for create video player
 * @param {HTMLInputElement} lockMouseCheck use checked propety for lock mouse 
 */
  createPlayer(playerElement, lockMouseCheck) {
    this.playerElement = playerElement;
    this.lockMouseCheck = lockMouseCheck;

    this.videoElement = document.createElement('video');
    this.videoElement.id = 'Video';
    this.videoElement.style.touchAction = 'none';
    this.videoElement.tabIndex = 0;
    this.videoElement.playsInline = true;
    this.videoElement.autoplay = true;
    // Video readiness must never gate the incoming show audio. In particular,
    // a video MediaStream can wait for its first decoded frame indefinitely.
    this.videoElement.defaultMuted = true;
    this.videoElement.muted = true;
    this.videoElement.srcObject = new MediaStream();
    this.videoElement.addEventListener('loadedmetadata', this._onLoadedVideo.bind(this), true);
    this.playerElement.appendChild(this.videoElement);

    this.audioElement = document.createElement('audio');
    this.audioElement.id = 'Audio';
    this.audioElement.autoplay = true;
    this.audioElement.srcObject = new MediaStream();
    this.audioElement.addEventListener('loadedmetadata', () => this._startAudioPlayback());
    this.playerElement.appendChild(this.audioElement);

    this.soundButtonElement = document.createElement('button');
    this.soundButtonElement.id = 'enableSoundButton';
    this.soundButtonElement.type = 'button';
    this.soundButtonElement.textContent = 'Enable sound';
    this.soundButtonElement.hidden = true;
    this.soundButtonElement.addEventListener('click', () => this._enableSound());
    this.playerElement.appendChild(this.soundButtonElement);
    for (const event of ['playing', 'pause', 'volumechange']) {
      this.audioElement.addEventListener(event, () => this._updateSoundButton());
    }

    // add fullscreen button
    this.fullScreenButtonElement = document.createElement('img');
    this.fullScreenButtonElement.id = 'fullscreenButton';
    const basePath = getBasePath();
    this.fullScreenButtonElement.src = `${basePath}/images/FullScreen.png`;
    this.fullScreenButtonElement.addEventListener("click", this._onClickFullscreenButton.bind(this));
    this.playerElement.appendChild(this.fullScreenButtonElement);

    document.addEventListener('webkitfullscreenchange', this._onFullscreenChangeHandler);
    document.addEventListener('fullscreenchange', this._onFullscreenChangeHandler);
    document.addEventListener('mozfullscreenchange', this._onFullscreenChangeHandler);
    this.videoElement.addEventListener("click", this._mouseClick.bind(this), false);
    this.videoElement.addEventListener("click", () => this.videoElement.focus(), false);
    document.addEventListener('keydown', this._onWindowKeyDownHandler, true);
    window.addEventListener('blur', this._onWindowBlurHandler, false);
    window.addEventListener('pagehide', this._onPageHideHandler, false);
    document.addEventListener('visibilitychange', this._onVisibilityChangeHandler, false);
    document.addEventListener('pointerlockchange', this._onPointerLockChangeHandler, false);
    document.addEventListener('mozpointerlockchange', this._onPointerLockChangeHandler, false);
    document.addEventListener('webkitpointerlockchange', this._onPointerLockChangeHandler, false);
  }

  setMouseSensitivity(value) {
    const next = Number(value);
    this.mouseSensitivity = Number.isFinite(next) && next > 0 ? next : 1;
    if (this.sender && typeof this.sender.setMouseSensitivity === 'function') {
      this.sender.setMouseSensitivity(this.mouseSensitivity);
    }
  }

  _onLoadedVideo() {
    this._startVideoPlayback();
    this.resizeVideo();
    if (this.sender && this.sender._onResizeEvent) {
      this.sender._onResizeEvent();
    }
  }

  startPlayback() {
    // Both calls run synchronously under the Join gesture; neither awaits the
    // other stream, signaling, device permission, or the first video frame.
    return Promise.all([this._startVideoPlayback(), this._startAudioPlayback()]);
  }

  _startVideoPlayback() {
    const video = this.videoElement;
    if (!video) return Promise.resolve();
    return video.play().catch(error => {
      if (this.videoElement === video && error?.name !== 'AbortError') {
        console.warn('Video playback did not start.', error);
      }
    });
  }

  _startAudioPlayback() {
    const audio = this.audioElement;
    if (!audio || audio.muted) return Promise.resolve();
    const request = ++this._playbackRequest;
    return audio.play().then(() => {
      if (this.audioElement === audio && request === this._playbackRequest) {
        this._updateSoundButton();
      }
    }).catch(error => {
      if (this.audioElement !== audio || request !== this._playbackRequest || error?.name === 'AbortError') {
        return;
      }
      if (error?.name === 'NotAllowedError') {
        // An explicit gesture is required. Keep the video playing and expose
        // the existing sound action instead of silently retrying muted audio.
        audio.muted = true;
      } else {
        console.warn('Audio playback did not start.', error);
      }
      this._updateSoundButton();
    });
  }

  _enableSound() {
    if (!this.audioElement) return;
    this.audioElement.muted = false;
    return this.startPlayback();
  }

  _updateSoundButton() {
    if (this.soundButtonElement && this.audioElement) {
      const hasAudio = this.audioElement.srcObject?.getAudioTracks().length > 0;
      this.soundButtonElement.hidden = !hasAudio || (!this.audioElement.muted && !this.audioElement.paused);
    }
  }

  _onClickFullscreenButton() {
    this._enableSound();
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fullscreenElement) {
      if (this.playerElement.requestFullscreen) {
        this.playerElement.requestFullscreen();
      }
      else if (this.playerElement.webkitRequestFullscreen) {
        this.playerElement.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
      } else {
        this.playerElement.classList.toggle('is-fullscreen');
      }
      return;
    }

    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }

  _onFullscreenChange() {
    const fullscreenElement = document.webkitFullscreenElement || document.fullscreenElement || document.mozFullScreenElement;
    const isFullscreen = !!fullscreenElement;
    this.playerElement.classList.toggle('is-fullscreen', isFullscreen);
    this.fullScreenButtonElement.style.display = isFullscreen ? 'none' : 'block';
    this.resizeVideo();
    if (isFullscreen) {
      this._lockKeyboardMovementKeys();
    } else {
      this._unlockKeyboardMovementKeys();
    }
    if (this.sender && typeof this.sender.setAltAsControlFallback === 'function') {
      this.sender.setAltAsControlFallback(!isFullscreen);
    }

    if (isFullscreen) {
      if (this.lockMouseCheck.checked && fullscreenElement && fullscreenElement.requestPointerLock) {
        fullscreenElement.requestPointerLock();
      }

      // Subscribe to events
      document.addEventListener('mousemove', this._onMouseMoveHandler, false);
      document.addEventListener('click', this._onMouseClickFullScreenHandler, false);
    }
    else {
      document.removeEventListener('mousemove', this._onMouseMoveHandler, false);
      document.removeEventListener('click', this._onMouseClickFullScreenHandler, false);
    }
  }

  _mouseMove(event) {
    // Forward mouseMove event of fullscreen player directly to sender
    // This is required, as the regular mousemove event doesn't fire when in fullscreen mode
    this.sender._onMouseEvent(event);
  }

  _mouseClick() {
    if (this.audioElement.muted || this.audioElement.paused || this.videoElement.paused) {
      this._enableSound();
    }

    // Restores pointer lock when we unfocus the player and click on it again
    if (this.lockMouseCheck.checked) {
      if (this.videoElement.requestPointerLock) {
        this.videoElement.requestPointerLock().catch(function () { });
      }
    }
  }

  _mouseClickFullScreen() {
    // Restores pointer lock when we unfocus the fullscreen player and click on it again
    if (this.lockMouseCheck.checked) {
      if (document.webkitFullscreenElement.requestPointerLock) {
        document.webkitFullscreenElement.requestPointerLock();
      } else if (document.fullscreenElement.requestPointerLock) {
        document.fullscreenElement.requestPointerLock();
      } else if (document.mozFullScreenElement.requestPointerLock) {
        document.mozFullScreenElement.requestPointerLock();
      }
    }
  }

  _onWindowKeyDown(event) {
    if (!this._shouldCaptureKeyboardInput()) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  _onWindowBlur() {
    this._releaseCapturedInputs();
  }

  _onPageHide() {
    this._releaseCapturedInputs();
  }

  _onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this._releaseCapturedInputs();
    }
  }

  _onPointerLockChange() {
    const pointerLockElement = document.pointerLockElement
      || document.webkitPointerLockElement
      || document.mozPointerLockElement;
    if (!pointerLockElement) {
      this._releaseCapturedInputs();
    }
  }

  _shouldCaptureKeyboardInput() {
    if (!this.videoElement || !this.playerElement) {
      return false;
    }
    const pointerLockElement = document.pointerLockElement
      || document.webkitPointerLockElement
      || document.mozPointerLockElement;
    if (pointerLockElement === this.videoElement
      || pointerLockElement === this.playerElement
      || (pointerLockElement != null && this.playerElement.contains(pointerLockElement))) {
      return true;
    }
    const activeElement = document.activeElement;
    if (activeElement === this.videoElement || activeElement === this.playerElement) {
      return true;
    }
    const fullscreenElement = document.fullscreenElement
      || document.webkitFullscreenElement
      || document.mozFullScreenElement;
    if (fullscreenElement === this.playerElement
      || (fullscreenElement != null && this.playerElement.contains(fullscreenElement))) {
      return true;
    }
    return false;
  }

  _releaseCapturedInputs() {
    if (!this.sender || typeof this.sender.releaseAllInputs !== 'function') {
      return;
    }
    this.sender.releaseAllInputs();
  }

  _lockKeyboardMovementKeys() {
    if (!navigator.keyboard || typeof navigator.keyboard.lock !== 'function') {
      return;
    }
    this._keyboardLockRequest = navigator.keyboard.lock([
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ControlLeft', 'ControlRight',
      'ShiftLeft', 'ShiftRight', 'Space',
      // The application's quickcam keys: F1-F5, and the same five as Ctrl + digit. Cancelling the
      // keydown already handles Chrome, but locking them is what stops the browser acting on them
      // at all - the only thing that works in browsers which reserve tab switching.
      // Alt is deliberately not locked: capturing it in fullscreen would also swallow Alt+Tab.
      'F1', 'F2', 'F3', 'F4', 'F5',
      'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
      'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5'
    ]);
    this._keyboardLockRequest.catch(() => { });
  }

  _unlockKeyboardMovementKeys() {
    if (navigator.keyboard && typeof navigator.keyboard.unlock === 'function') {
      navigator.keyboard.unlock();
    }
    this._keyboardLockRequest = null;
  }

  /**
   * @param {MediaStreamTrack} track 
   */
  addTrack(track) {
    const element = track.kind === 'audio' ? this.audioElement : this.videoElement;
    if (!element?.srcObject) return;
    const stream = element.srcObject;
    if (stream.getTracks().includes(track)) return;
    // Renegotiation/replacement must not leave an old, silent first audio track
    // selected by the media element. The peer owns the tracks; do not stop them.
    // Assign a populated stream so the audio element actually loads its source.
    // Mutating the initially empty stream can leave <audio> at HAVE_NOTHING.
    element.srcObject = new MediaStream([track]);
    if (track.kind === 'audio') {
      this._updateSoundButton();
      this._startAudioPlayback();
    } else {
      this._startVideoPlayback();
    }
  }

  resizeVideo() {
    if (!this.videoElement) {
      return;
    }

    const clientRect = this.videoElement.getBoundingClientRect();
    const videoRatio = this.videoWidth / this.videoHeight;
    const clientRatio = clientRect.width / clientRect.height;

    this._videoScale = videoRatio > clientRatio ? clientRect.width / this.videoWidth : clientRect.height / this.videoHeight;
    const videoOffsetX = videoRatio > clientRatio ? 0 : (clientRect.width - this.videoWidth * this._videoScale) * 0.5;
    const videoOffsetY = videoRatio > clientRatio ? (clientRect.height - this.videoHeight * this._videoScale) * 0.5 : 0;
    this._videoOriginX = clientRect.left + videoOffsetX;
    this._videoOriginY = clientRect.top + videoOffsetY;
  }

  get videoWidth() {
    return this.videoElement.videoWidth;
  }

  get videoHeight() {
    return this.videoElement.videoHeight;
  }

  get videoOriginX() {
    return this._videoOriginX;
  }

  get videoOriginY() {
    return this._videoOriginY;
  }

  get videoScale() {
    return this._videoScale;
  }

  deletePlayer() {
    this._playbackRequest++;
    for (const element of [this.audioElement, this.videoElement]) {
      if (!element) continue;
      element.pause();
      element.srcObject = null;
    }
    if (this.audioElement) {
      this.audioElement.remove();
      this.audioElement = null;
    }
    if (this.soundButtonElement) {
      this.soundButtonElement.remove();
      this.soundButtonElement = null;
    }
    this._releaseCapturedInputs();
    this._unlockKeyboardMovementKeys();
    this._setInputSenderChannel(null);
    if (this.inputRemoting) {
      this.inputRemoting.stopSending();
    }
    if (this.sender && typeof this.sender.dispose === 'function') {
      this.sender.dispose();
    }
    this.inputRemoting = null;
    this.sender = null;
    if (this.inputObserver) {
      this.inputObserver.setChannel(null);
    }
    this.inputObserver = null;
    this.inputSenderChannel = null;

    if (this.videoElement && this.videoElement.parentNode) {
      this.videoElement.parentNode.removeChild(this.videoElement);
    }
    if (this.fullScreenButtonElement && this.fullScreenButtonElement.parentNode) {
      this.fullScreenButtonElement.parentNode.removeChild(this.fullScreenButtonElement);
    }
    document.removeEventListener('webkitfullscreenchange', this._onFullscreenChangeHandler);
    document.removeEventListener('fullscreenchange', this._onFullscreenChangeHandler);
    document.removeEventListener('mozfullscreenchange', this._onFullscreenChangeHandler);
    document.removeEventListener('keydown', this._onWindowKeyDownHandler, true);
    window.removeEventListener('blur', this._onWindowBlurHandler, false);
    window.removeEventListener('pagehide', this._onPageHideHandler, false);
    document.removeEventListener('visibilitychange', this._onVisibilityChangeHandler, false);
    document.removeEventListener('pointerlockchange', this._onPointerLockChangeHandler, false);
    document.removeEventListener('mozpointerlockchange', this._onPointerLockChangeHandler, false);
    document.removeEventListener('webkitpointerlockchange', this._onPointerLockChangeHandler, false);

    this.playerElement = null;
    this.lockMouseCheck = null;
    this.videoElement = null;
    this.fullScreenButtonElement = null;
  }

  _isTouchDevice() {
    return (('ontouchstart' in window) ||
      (navigator.maxTouchPoints > 0) ||
      (navigator.msMaxTouchPoints > 0));
  }

  /**
   * setup datachannel for player input (muouse/keyboard/touch/gamepad)
   * @param {RTCDataChannel} channel 
   */
  setupInput(channel) {
    if (!channel) {
      return;
    }

    if (!this.sender) {
      this.sender = new Sender(this.videoElement);
      this.sender.addMouse();
      this.sender.addKeyboard();
      this.sender.setAltAsControlFallback(true);
      this.sender.setMouseSensitivity(this.mouseSensitivity);
      if (this._isTouchDevice()) {
        this.sender.addTouchscreen();
      }
      this.sender.addGamepad();
      this.inputRemoting = new InputRemoting(this.sender);
      this.inputObserver = new Observer(channel);
      this.inputRemoting.subscribe(this.inputObserver);
    } else if (this.inputObserver) {
      if (typeof this.inputObserver.setChannel === 'function') {
        this.inputObserver.setChannel(channel);
      } else if ('channel' in this.inputObserver) {
        this.inputObserver.channel = channel;
      } else {
        this.inputObserver = new Observer(channel);
        this.inputRemoting.subscribe(this.inputObserver);
      }
    } else {
      this.inputObserver = new Observer(channel);
      this.inputRemoting.subscribe(this.inputObserver);
    }

    this._setInputSenderChannel(channel);
    if (this.inputSenderChannel.readyState === 'open') {
      this._onOpenInputSenderChannel();
    }
  }

  setApplicationPointerLock(active) {
    if (this.sender) {
      this.sender.setApplicationPointerLock(active);
    }
  }

  _setInputSenderChannel(channel) {
    if (this.inputSenderChannel === channel) {
      return;
    }
    if (this.inputSenderChannel) {
      this._stopInputHealthChecks();
      if (this.inputSenderChannel.removeEventListener) {
        this.inputSenderChannel.removeEventListener('open', this._onOpenInputSenderChannelHandler);
        this.inputSenderChannel.removeEventListener('close', this._onCloseInputSenderChannelHandler);
        this.inputSenderChannel.removeEventListener('message', this._onInputSenderChannelMessageHandler);
      } else {
        if (this.inputSenderChannel.onopen === this._onOpenInputSenderChannelHandler) {
          this.inputSenderChannel.onopen = null;
        }
        if (this.inputSenderChannel.onclose === this._onCloseInputSenderChannelHandler) {
          this.inputSenderChannel.onclose = null;
        }
        if (this.inputSenderChannel.onmessage === this._onInputSenderChannelMessageHandler) {
          this.inputSenderChannel.onmessage = null;
        }
      }
    }

    this.inputSenderChannel = channel;
    this.inputReady = false;
    if (!this.inputSenderChannel) {
      return;
    }

    this.inputSenderChannel.binaryType = 'arraybuffer';
    if (this.inputSenderChannel.addEventListener) {
      this.inputSenderChannel.addEventListener('open', this._onOpenInputSenderChannelHandler);
      this.inputSenderChannel.addEventListener('close', this._onCloseInputSenderChannelHandler);
      this.inputSenderChannel.addEventListener('message', this._onInputSenderChannelMessageHandler);
    } else {
      this.inputSenderChannel.onopen = this._onOpenInputSenderChannelHandler;
      this.inputSenderChannel.onclose = this._onCloseInputSenderChannelHandler;
      this.inputSenderChannel.onmessage = this._onInputSenderChannelMessageHandler;
    }
  }

  async _onOpenInputSenderChannel() {
    const channel = this.inputSenderChannel;
    if (!this.inputRemoting || !channel) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    if (channel !== this.inputSenderChannel || channel.readyState !== 'open') {
      return;
    }
    this.inputRemoting.startSending();
    this._startInputHealthChecks(channel);
  }

  _onCloseInputSenderChannel() {
    this._stopInputHealthChecks();
    this.inputReady = false;
    if (!this.inputRemoting) {
      return;
    }
    this.inputRemoting.stopSending();
  }

  _onInputSenderChannelMessage(event) {
    if (event.data === INPUT_READY) {
      this.inputReady = true;
      return;
    }
    if (event.data === INPUT_NEEDS_BOOTSTRAP) {
      this.inputReady = false;
      this.inputRemoting?.resendDevices();
    }
  }

  _startInputHealthChecks(channel) {
    this._stopInputHealthChecks();
    const sendProbe = () => {
      if (channel !== this.inputSenderChannel || channel.readyState !== 'open') {
        this._stopInputHealthChecks();
        return;
      }
      channel.send(INPUT_HEALTH_PROBE);
    };
    sendProbe();
    this.inputHealthTimer = setInterval(sendProbe, INPUT_HEALTH_INTERVAL_MS);
  }

  _stopInputHealthChecks() {
    if (this.inputHealthTimer != null) {
      clearInterval(this.inputHealthTimer);
      this.inputHealthTimer = null;
    }
  }
}

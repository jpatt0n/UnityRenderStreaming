import {
  Mouse,
  Keyboard,
  Gamepad,
  Touchscreen,
  StateEvent,
  TextEvent
} from "./inputdevice.js";

import { LocalInputManager } from "./inputremoting.js";
import { GamepadHandler } from "./gamepadhandler.js";
import { PointerCorrector } from "./pointercorrect.js";

/**
 * The streamed application's quickcam keys, taken from the browser so they reach the game.
 *
 * F1-F4 are the primary form and are claimed on their own. Chrome puts help on F1 and find on F3,
 * but neither is reserved, so cancelling the keydown is enough.
 */
const APP_CLAIMED_KEYS = new Set(['F1', 'F2', 'F3', 'F4']);

/**
 * The fallback form: the same four as Ctrl + digit.
 *
 * Chrome maps Ctrl+1..8 to "switch to tab N", but unlike Ctrl+T or Ctrl+W those are not reserved
 * either. Firefox and Safari do reserve theirs, so there the chord only lands while the player is
 * fullscreen and the Keyboard Lock API (see videoplayer.js) is holding these codes.
 */
const APP_CLAIMED_MODIFIER_DIGITS = new Set([
  'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'
]);

export class Sender extends LocalInputManager {
  constructor(elem) {
    super();
    this._devices = [];
    this._elem = elem;
    this._loggedMouseEvent = false;
    this._loggedKeyEvent = false;
    this._pressedKeys = new Set();
    this._altAsControlFallback = false;
    this._mouseSensitivity = 1;
    this._handheldMirror = false;
    this._handheldOwnedPointerLock = false;
    this._corrector = new PointerCorrector(
      this._elem.videoWidth,
      this._elem.videoHeight,
      this._elem
      );

    this._onResizeEventHandler = this._onResizeEvent.bind(this);
    this._onMouseEventHandler = this._onMouseEvent.bind(this);
    this._onWheelEventHandler = this._onWheelEvent.bind(this);
    this._onKeyEventHandler = this._onKeyEvent.bind(this);
    this._onGamepadEventHandler = this._onGamepadEvent.bind(this);
    this._onTouchEventHandler = this._onTouchEvent.bind(this);
    this._onWindowBlurHandler = this._onWindowBlur.bind(this);
    this._onPageHideHandler = this._onPageHide.bind(this);
    this._onVisibilityChangeHandler = this._onVisibilityChange.bind(this);
    this._onPointerLockChangeHandler = this._onPointerLockChange.bind(this);
    document.addEventListener('pointerlockchange', this._onPointerLockChangeHandler, false);

    //since line 27 cannot complete resize initialization but can only monitor div dimension changes, line 26 needs to be reserved
    this._elem.addEventListener('resize', this._onResizeEventHandler, false);
    this._resizeObserver = new ResizeObserver(this._onResizeEventHandler);
    this._resizeObserver.observe(this._elem);
  }

  addMouse() {
    const descriptionMouse = {
      m_InterfaceName: "RawInput",
      m_DeviceClass: "Mouse",
      m_Manufacturer: "",
      m_Product: "",
      m_Serial: "",
      m_Version: "",
      m_Capabilities: ""
    };
    this.mouse = new Mouse("Mouse", "Mouse", 1, null, descriptionMouse);
    this._devices.push(this.mouse);

    this._elem.addEventListener('click', this._onMouseEventHandler, false);
    this._elem.addEventListener('mousedown', this._onMouseEventHandler, false);
    this._elem.addEventListener('mouseup', this._onMouseEventHandler, false);
    this._elem.addEventListener('mousemove', this._onMouseEventHandler, false);
    this._elem.addEventListener('wheel', this._onWheelEventHandler, false);
  }

  addKeyboard() {
    const descriptionKeyboard = {
      m_InterfaceName: "RawInput",
      m_DeviceClass: "Keyboard",
      m_Manufacturer: "",
      m_Product: "",
      m_Serial: "",
      m_Version: "",
      m_Capabilities: ""
    };
    this.keyboard = new Keyboard("Keyboard", "Keyboard", 2, null, descriptionKeyboard);
    this._devices.push(this.keyboard);

    document.addEventListener('keyup', this._onKeyEventHandler, false);
    document.addEventListener('keydown', this._onKeyEventHandler, false);
    window.addEventListener('blur', this._onWindowBlurHandler, false);
    window.addEventListener('pagehide', this._onPageHideHandler, false);
    document.addEventListener('visibilitychange', this._onVisibilityChangeHandler, false);
  }

  setAltAsControlFallback(enabled) {
    const next = !!enabled;
    if (this._altAsControlFallback === next) {
      return;
    }
    this.releaseAllInputs();
    this._altAsControlFallback = next;
  }

  setMouseSensitivity(value) {
    const next = Number(value);
    this._mouseSensitivity = Number.isFinite(next) && next > 0 ? next : 1;
  }

  addGamepad() {
    const descriptionGamepad = {
      m_InterfaceName: "RawInput",
      m_DeviceClass: "Gamepad",
      m_Manufacturer: "",
      m_Product: "",
      m_Serial: "",
      m_Version: "",
      m_Capabilities: ""
    };
    this.gamepad = new Gamepad("Gamepad", "Gamepad", 3, null, descriptionGamepad);
    this._devices.push(this.gamepad);

    window.addEventListener("gamepadconnected", this._onGamepadEventHandler, false);
    window.addEventListener("gamepaddisconnected", this._onGamepadEventHandler, false);
    this._gamepadHandler = new GamepadHandler();
    this._gamepadHandler.addEventListener("gamepadupdated", this._onGamepadEventHandler, false);
  }

  addTouchscreen() {
    const descriptionTouch = {
      m_InterfaceName: "RawInput",
      m_DeviceClass: "Touch",
      m_Manufacturer: "",
      m_Product: "",
      m_Serial: "",
      m_Version: "",
      m_Capabilities: ""
    };
    this.touchscreen = new Touchscreen("Touchscreen", "Touchscreen", 4, null, descriptionTouch);
    this._devices.push(this.touchscreen);

    this._elem.addEventListener('touchend', this._onTouchEventHandler, false);
    this._elem.addEventListener('touchstart', this._onTouchEventHandler, false);
    this._elem.addEventListener('touchcancel', this._onTouchEventHandler, false);
    this._elem.addEventListener('touchmove', this._onTouchEventHandler, false);
    this._elem.addEventListener('click', this._onTouchEventHandler, false);
  }

  /**
   * @returns {InputDevice[]}
   */
  get devices() {
    return this._devices;
  }

  _onResizeEvent() {
    this._corrector.reset(
      this._elem.videoWidth,
      this._elem.videoHeight,
      this._elem
    );
  }
  _onMouseEvent(event) {
    if (!this._corrector.isReady) {
      return;
    }
    if ((event.type === 'mousedown' || event.type === 'mouseup') &&
      (event.button === 3 || event.button === 4)) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this._loggedMouseEvent) {
      this._loggedMouseEvent = true;
    }
    this.mouse.queueEvent(event);
    // Every mouse delta is scaled, not just right-drag ones. Delta is only ever read as camera
    // movement, and the application now has camera modes - the handheld camera above all - that pan
    // without a button held; those have to answer the same speed setting as a right-drag does.
    if (event.type === 'mousemove') {
      this.mouse.currentState.delta = this.mouse.currentState.delta.map(
        value => value * this._mouseSensitivity
      );
    }
    this.mouse.currentState.position = this._corrector.map(this.mouse.currentState.position);
    this._queueStateEvent(this.mouse.currentState, this.mouse);
  }
  _onWheelEvent(event) {
    this.mouse.queueEvent(event);
    this._queueStateEvent(this.mouse.currentState, this.mouse);
  }
  _onKeyEvent(event) {
    const code = this._resolveKeyCode(event);
    if (!code) {
      return;
    }
    const isAppClaimedChord = this._isAppClaimedChord(event);
    if (isAppClaimedChord) {
      // Held back from the browser so the key reaches the application rather than opening help or
      // switching tabs.
      event.preventDefault();
    }
    if(event.type == 'keydown') {
      if(!event.repeat) { // StateEvent
        this._pressedKeys.add(code);
        this.keyboard.queueEvent({ type: 'keydown', code: code });
        this._queueStateEvent(this.keyboard.currentState, this.keyboard);
        this._updateHandheldMirror(event);
        if (!this._loggedKeyEvent) {
          this._loggedKeyEvent = true;
        }
      }
      // TextEvent
      if (!isAppClaimedChord && this._isTextInputKey(event)) {
        this._queueTextEvent(this.keyboard, event);
      }
    }
    else if(event.type == 'keyup') {
      this._pressedKeys.delete(code);
      this.keyboard.queueEvent({ type: 'keyup', code: code });
      this._queueStateEvent(this.keyboard.currentState, this.keyboard);
    }
  }

  /**
   * True for a key the application owns: one of its bare function keys, or the modifier + digit
   * fallback for the same four.
   *
   * Alt counts alongside Ctrl on the digits because outside fullscreen the sender already stands
   * Alt in for Control (see `setAltAsControlFallback`), so Alt+1 is how a windowed player types
   * Ctrl+1. AltGr - which Windows reports as Ctrl+Alt - is left alone: on many layouts it produces
   * a real character, and swallowing it would break typing.
   */
  _isAppClaimedChord(event) {
    if (!event || !event.code) {
      return false;
    }
    if (APP_CLAIMED_KEYS.has(event.code)) {
      return true;
    }
    if (!APP_CLAIMED_MODIFIER_DIGITS.has(event.code)) {
      return false;
    }
    if (event.ctrlKey && event.altKey) {
      return false;
    }
    return event.ctrlKey || event.metaKey || (this._altAsControlFallback && event.altKey);
  }

  /**
   * The application's handheld camera (F4 / Ctrl+4, Esc to exit) pans on bare mouse movement, so
   * while it is up the OS cursor must not exist to run into a window edge and stall the pan. Only
   * the page can reach the Pointer Lock API, so the handheld's own keys are mirrored here and the
   * lock follows them. The mirror can drift if the application drops the handheld on its own (a
   * cut from another client, a mode change); Esc or F4 puts both sides right.
   */
  _updateHandheldMirror(event) {
    if (this._isHandheldToggleChord(event)) {
      if (this._handheldMirror) {
        this._releaseHandheldPointerLock();
      } else {
        this._captureHandheldPointerLock();
      }
      return;
    }
    if (event.code === 'Escape' && this._handheldMirror) {
      this._releaseHandheldPointerLock();
    }
  }

  _isHandheldToggleChord(event) {
    if (event.code === 'F4') {
      return true;
    }
    return (event.code === 'Digit4' || event.code === 'Numpad4') && this._isAppClaimedChord(event);
  }

  _captureHandheldPointerLock() {
    this._handheldMirror = true;
    if (document.pointerLockElement) {
      // Someone else's lock (the fullscreen lock-mouse option) is already holding the cursor.
      // Riding it rather than owning it means lowering the handheld will not tear it down.
      this._handheldOwnedPointerLock = false;
      return;
    }
    if (!this._elem.requestPointerLock) {
      return;
    }
    this._handheldOwnedPointerLock = true;
    const request = this._elem.requestPointerLock();
    if (request && request.catch) {
      request.catch(() => { this._handheldOwnedPointerLock = false; });
    }
  }

  _releaseHandheldPointerLock() {
    this._handheldMirror = false;
    if (this._handheldOwnedPointerLock &&
        document.pointerLockElement === this._elem &&
        document.exitPointerLock) {
      document.exitPointerLock();
    }
    this._handheldOwnedPointerLock = false;
  }

  _onPointerLockChange() {
    if (!this._handheldMirror || document.pointerLockElement) {
      return;
    }
    // The lock fell away without any exit key being seen: the browser swallows the Esc that ends a
    // pointer lock, and Alt+Tab never reaches the page at all. The application still has the
    // handheld up, so the Esc it never received is forwarded by hand - one press lowers the
    // camera in both worlds.
    this._handheldMirror = false;
    this._handheldOwnedPointerLock = false;
    this._sendKeyTap('Escape');
  }

  _sendKeyTap(code) {
    if (!this.keyboard) {
      return;
    }
    this.keyboard.queueEvent({ type: 'keydown', code: code });
    this._queueStateEvent(this.keyboard.currentState, this.keyboard);
    this.keyboard.queueEvent({ type: 'keyup', code: code });
    this._queueStateEvent(this.keyboard.currentState, this.keyboard);
  }

  _resolveKeyCode(event) {
    if (!event || !event.code) {
      return null;
    }
    if (!this._altAsControlFallback) {
      return event.code;
    }
    if (event.code === 'AltLeft') {
      return 'ControlLeft';
    }
    if (event.code === 'AltRight') {
      return 'ControlRight';
    }
    return event.code;
  }
  _isTextInputKey(event) {
    if (!event || !event.key) {
      return false;
    }
    if (event.key.length === 1) {
      return true;
    }
    return event.key === 'Enter'
      || event.key === 'Backspace'
      || event.key === 'Tab'
      || event.key === 'Delete';
  }
  _onTouchEvent(event) {
    if (!this._corrector.isReady) {
      return;
    }
    this.touchscreen.queueEvent(event, this.timeSinceStartup);
    for(let touch of this.touchscreen.currentState.touchData) {
      let clone = touch.copy();
      clone.position = this._corrector.map(clone.position);
      this._queueStateEvent(clone, this.touchscreen);
    }
  }
  _onGamepadEvent(event) {
    switch(event.type) {
      case 'gamepadconnected': {
        this._gamepadHandler.addGamepad(event.gamepad);
        break;
      }
      case 'gamepaddisconnected': {
        this._gamepadHandler.removeGamepad(event.gamepad);
        break;
      }
      case 'gamepadupdated': {
        this.gamepad.queueEvent(event);
        this._queueStateEvent(this.gamepad.currentState, this.gamepad);
        break;
      }
    }
  }

  _onWindowBlur() {
    this.releaseAllInputs();
  }

  _onPageHide() {
    this.releaseAllInputs();
  }

  _onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.releaseAllInputs();
    }
  }

  _releaseAllKeys() {
    if (!this.keyboard || this._pressedKeys.size === 0) {
      return;
    }
    const keysToRelease = Array.from(this._pressedKeys);
    this._pressedKeys.clear();
    for (const code of keysToRelease) {
      this.keyboard.queueEvent({ type: 'keyup', code: code });
      this._queueStateEvent(this.keyboard.currentState, this.keyboard);
    }
  }

  _releaseMouseButtons() {
    if (!this.mouse) {
      return;
    }
    const hasButtonsDown =
      this.mouse.currentState != null
      && this.mouse.currentState.buttons != null
      && new Uint16Array(this.mouse.currentState.buttons)[0] !== 0;
    if (!hasButtonsDown) {
      return;
    }
    const state = this.mouse.currentState;
    const event = {
      type: 'mouseup',
      button: 0,
      buttons: 0,
      clientX: state.position[0],
      clientY: state.position[1],
      movementX: 0,
      movementY: 0,
    };
    this.mouse.queueEvent(event);
    this._queueStateEvent(this.mouse.currentState, this.mouse);
  }

  releaseAllInputs() {
    this._releaseAllKeys();
    this._releaseMouseButtons();
  }

  dispose() {
    this.releaseAllInputs();
    this._releaseHandheldPointerLock();
    document.removeEventListener('pointerlockchange', this._onPointerLockChangeHandler, false);
    this._elem.removeEventListener('resize', this._onResizeEventHandler, false);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._elem.removeEventListener('click', this._onMouseEventHandler, false);
    this._elem.removeEventListener('mousedown', this._onMouseEventHandler, false);
    this._elem.removeEventListener('mouseup', this._onMouseEventHandler, false);
    this._elem.removeEventListener('mousemove', this._onMouseEventHandler, false);
    this._elem.removeEventListener('wheel', this._onWheelEventHandler, false);
    this._elem.removeEventListener('touchend', this._onTouchEventHandler, false);
    this._elem.removeEventListener('touchstart', this._onTouchEventHandler, false);
    this._elem.removeEventListener('touchcancel', this._onTouchEventHandler, false);
    this._elem.removeEventListener('touchmove', this._onTouchEventHandler, false);
    this._elem.removeEventListener('click', this._onTouchEventHandler, false);
    document.removeEventListener('keyup', this._onKeyEventHandler, false);
    document.removeEventListener('keydown', this._onKeyEventHandler, false);
    document.removeEventListener('visibilitychange', this._onVisibilityChangeHandler, false);
    window.removeEventListener('blur', this._onWindowBlurHandler, false);
    window.removeEventListener('pagehide', this._onPageHideHandler, false);
    window.removeEventListener("gamepadconnected", this._onGamepadEventHandler, false);
    window.removeEventListener("gamepaddisconnected", this._onGamepadEventHandler, false);
    if (this._gamepadHandler) {
      this._gamepadHandler.removeEventListener("gamepadupdated", this._onGamepadEventHandler, false);
      this._gamepadHandler = null;
    }
  }

  _queueStateEvent(state, device) {
    const stateEvent =
      StateEvent.fromState(state, device.deviceId, this.timeSinceStartup);
    const e = new CustomEvent(
      'event', {detail: { event: stateEvent, device: device}});
    super.onEvent.dispatchEvent(e);
  }
  _queueTextEvent(device, event) {
    const textEvent = TextEvent.create(device.deviceId, event, this.timeSinceStartup);
    const e = new CustomEvent(
      'event', {detail: { event: textEvent, device: device}});
    super.onEvent.dispatchEvent(e);
  }
  _queueDeviceChange(device, usage) {
    const e = new CustomEvent(
      'changedeviceusage', {detail: { device: device, usage: usage }});
    super.onEvent.dispatchEvent(e);
  }
}

export class Observer {
  /**
   *
   * @param {RTCDataChannel} channel
   */
  constructor(channel, maxBufferedAmount = 256 * 1024) {
    this.channel = channel;
    this.maxBufferedAmount = maxBufferedAmount;
  }

  /**
   *
   * @param {RTCDataChannel} channel
   */
  setChannel(channel) {
    this.channel = channel;
  }
  /**
   *
   * @param {Message} message
   */
  onNext(message) {
    if(this.channel == null || this.channel.readyState != 'open') {
      return;
    }
    if (typeof this.channel.bufferedAmount === 'number'
      && this.channel.bufferedAmount > this.maxBufferedAmount) {
      return;
    }
    this.channel.send(message.buffer);
  }
}

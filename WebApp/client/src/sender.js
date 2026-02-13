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

export class Sender extends LocalInputManager {
  constructor(elem) {
    super();
    this._devices = [];
    this._elem = elem;
    this._loggedMouseEvent = false;
    this._loggedKeyEvent = false;
    this._pressedKeys = new Set();
    this._altAsControlFallback = false;
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
    if(event.type == 'keydown') {
      if(!event.repeat) { // StateEvent
        this._pressedKeys.add(code);
        this.keyboard.queueEvent({ type: 'keydown', code: code });
        this._queueStateEvent(this.keyboard.currentState, this.keyboard);
        if (!this._loggedKeyEvent) {
          this._loggedKeyEvent = true;
        }
      }
      // TextEvent
      if (this._isTextInputKey(event)) {
        this._queueTextEvent(this.keyboard, event);
      }
    }
    else if(event.type == 'keyup') {
      this._pressedKeys.delete(code);
      this.keyboard.queueEvent({ type: 'keyup', code: code });
      this._queueStateEvent(this.keyboard.currentState, this.keyboard);
    }
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

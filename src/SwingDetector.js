import RollingArray from "./rollingArray";

const RESET_DELAY = 500;
// How many frames to wait before confirming an apogee
const DEBOUNCE_COUNT = 3;

/** Handles connection with detector server and interprets the values */
export default class SwingDetector {
  constructor(onValue) {
    this._camera = 0;
    this.valueHistory = new RollingArray(10);
    this.speedHistory = new RollingArray(3);
    this.apogeeSpeedTreshold = 0.1;
    this.inertRange = 0.15;
    this.resetRange = 0.1;
    this.prevValue = null;
    this.prevTime = null;
    this.prevDirection = 0;
    this.currentDirection = 1;
    this.active = true;
    this.resetStart;
    this.swap = true;
    this.offset = 0;

    this.onValue = onValue;
    
    this.ws = new WebSocket('ws://localhost:9000');
    this.ws.onmessage = (evt) => {
      const { type, value } = JSON.parse(evt.data);
      if (type === 'detectorValue') this.handleValue(value);
      if (type === 'detectorDisplay') this.handleDisplay(value);
      else if (type === 'config') console.log('new config: ', value);
    }
  }

  waitConnection() {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    else return new Promise(resolve => this.ws.onopen = resolve);
  }

  send(data) {
    data.payload = data.payload || {}
    this.ws.send(JSON.stringify(data));
  }

  handleDisplay(display) {
    document.querySelector('img.view').src = `data:image/jpeg;base64,${display}`;
  }

  handleValue(value) {
    if (!this.active) return;
    if (this.swap) value = -value;
    
    value = value - this.offset;

    const now = performance.now();
    const deltaTime = now - this.prevTime;
    this.prevTime = now;

    this.valueHistory.append(value);

    const speed = (this.prevValue - value) / deltaTime;
    const direction = Math.sign(speed);
    const absValue = Math.abs(value);
    const side = Math.sign(value);
    const sideLabel = side === -1 ? 'front' : 'back';
    const smoothedValue = this.valueHistory.average;
    
    this.speedHistory.append(speed);
    const smoothedSpeed = this.speedHistory.average;

    const output = {
      value,
      absValue,
      deltaTime,
      speed,
      apogee: null,
      prevApogee: null,
      side: sideLabel,
      smoothedValue,
      smoothedSpeed,
    };
    
    // Detect apogees
    // Ignore anything inside the inert range
    const isApogeeRange = absValue > this.inertRange && this.prevApogee != side;
    const isApogeeSpeed = Math.abs(speed) > this.apogeeSpeedTreshold && direction === side;
    if (isApogeeRange && isApogeeSpeed) {
      this.prevApogee = side;
      this.prevApogeeValue = value;
      output.apogee = sideLabel;
    }
    
    // Reset when sitting in the inert range for a while
    if (absValue < this.resetRange) {
      if (!this.resetStart) this.resetStart = now;
      if (now - this.resetStart > RESET_DELAY) {
        this.prevApogee = null;
        this.prevApogeeValue = null;
      }
    } else {
      this.resetStart = null;
    }
    
    output.prevApogeeValue = this.prevApogeeValue;
    
    this.onValue(output);

    this.prevDirection = direction;
    this.prevValue = smoothedValue;
  }

  updateConfig(data) {
    this.send({ 'action': 'updateConfig', 'payload': data });
  }

  get camera() {
    return this._camera;
  }
  set camera(value) {
    value = parseInt(value);
    this._camera = value;
    this.updateConfig({ 'camera': value });
  }
  get display() {
    return this._display || false;
  }
  set display(value) {
    this._display = value;
    document.querySelector('img.view').style.display = value ? '' : 'none';
    this.updateConfig({ 'display': value });
  }

  async getCameraList() {
    const list = await navigator.mediaDevices.enumerateDevices()
    return list.filter(device => device.kind === 'videoinput').map(device => device.label);
  }
}
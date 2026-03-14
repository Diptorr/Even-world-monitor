/**
 * Even Realities R1 Ring BLE Communication
 *
 * The R1 ring acts as an input controller for the G2 glasses ecosystem.
 * It provides gesture-based navigation: tap, double-tap, swipe, and rotate.
 * Uses Web Bluetooth for browser-based connectivity.
 */

export type R1Gesture = 'tap' | 'double_tap' | 'swipe_up' | 'swipe_down' | 'swipe_left' | 'swipe_right' | 'rotate_cw' | 'rotate_ccw';

export type R1ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// R1 Ring BLE identifiers (inferred from Even Realities ecosystem)
const R1_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const R1_NOTIFY_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

let r1Status: R1ConnectionStatus = 'disconnected';
let r1Device: BluetoothDevice | null = null;

const gestureListeners: Array<(gesture: R1Gesture) => void> = [];
const r1StatusListeners: Array<(status: R1ConnectionStatus) => void> = [];

export function onR1Gesture(cb: (gesture: R1Gesture) => void): () => void {
  gestureListeners.push(cb);
  return () => {
    const i = gestureListeners.indexOf(cb);
    if (i >= 0) gestureListeners.splice(i, 1);
  };
}

export function onR1StatusChange(cb: (status: R1ConnectionStatus) => void): () => void {
  r1StatusListeners.push(cb);
  return () => {
    const i = r1StatusListeners.indexOf(cb);
    if (i >= 0) r1StatusListeners.splice(i, 1);
  };
}

function setR1Status(s: R1ConnectionStatus) {
  r1Status = s;
  r1StatusListeners.forEach((cb) => cb(s));
}

export function getR1Status(): R1ConnectionStatus {
  return r1Status;
}

/** Connect to R1 ring via Web Bluetooth */
export async function connectR1(): Promise<boolean> {
  if (!('bluetooth' in navigator)) {
    setR1Status('error');
    return false;
  }

  setR1Status('connecting');

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Even' },
        { namePrefix: 'R1' },
        { namePrefix: 'EVEN' },
      ],
      optionalServices: [R1_SERVICE_UUID],
    });

    if (!device.gatt) {
      setR1Status('error');
      return false;
    }

    device.addEventListener('gattserverdisconnected', () => {
      setR1Status('disconnected');
      r1Device = null;
    });

    const server = await device.gatt.connect();
    r1Device = device;

    const service = await server.getPrimaryService(R1_SERVICE_UUID);
    const notifyChar = await service.getCharacteristic(R1_NOTIFY_UUID);
    await notifyChar.startNotifications();
    notifyChar.addEventListener('characteristicvaluechanged', handleR1Data);

    setR1Status('connected');
    return true;
  } catch (err) {
    console.error('R1 connection failed:', err);
    setR1Status('error');
    return false;
  }
}

/** Disconnect R1 ring */
export function disconnectR1(): void {
  if (r1Device?.gatt?.connected) {
    r1Device.gatt.disconnect();
  }
  r1Device = null;
  setR1Status('disconnected');
}

/** Parse incoming R1 data into gestures */
function handleR1Data(event: Event): void {
  const char = event.target as BluetoothRemoteGATTCharacteristic;
  const value = char.value;
  if (!value || value.byteLength < 2) return;

  const cmd = value.getUint8(0);
  const sub = value.getUint8(1);

  // Gesture command mapping (based on touch event protocol)
  if (cmd === 0xf5 || cmd === 0xa1) {
    let gesture: R1Gesture | null = null;
    switch (sub) {
      case 0x01: gesture = 'tap'; break;
      case 0x00: gesture = 'double_tap'; break;
      case 0x02: gesture = 'swipe_right'; break;  // forward
      case 0x03: gesture = 'swipe_left'; break;   // backward
      case 0x10: gesture = 'swipe_up'; break;
      case 0x11: gesture = 'swipe_down'; break;
      case 0x20: gesture = 'rotate_cw'; break;
      case 0x21: gesture = 'rotate_ccw'; break;
    }
    if (gesture) {
      gestureListeners.forEach((cb) => cb(gesture!));
    }
  }
}

/**
 * Keyboard fallback: map keyboard events to R1 gestures
 * for testing without the physical ring.
 */
export function enableKeyboardFallback(): () => void {
  function handler(e: KeyboardEvent) {
    let gesture: R1Gesture | null = null;
    switch (e.key) {
      case 'ArrowRight': case 'l': gesture = 'swipe_right'; break;
      case 'ArrowLeft': case 'h': gesture = 'swipe_left'; break;
      case 'ArrowUp': case 'k': gesture = 'swipe_up'; break;
      case 'ArrowDown': case 'j': gesture = 'swipe_down'; break;
      case 'Enter': case ' ': gesture = 'tap'; break;
      case 'Escape': gesture = 'double_tap'; break;
      case ']': gesture = 'rotate_cw'; break;
      case '[': gesture = 'rotate_ccw'; break;
    }
    if (gesture) {
      e.preventDefault();
      gestureListeners.forEach((cb) => cb(gesture!));
    }
  }

  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

/**
 * Even Realities G2 Glasses BLE Communication
 *
 * Protocol based on EvenDemoApp and even-g2-protocol reverse engineering.
 * Uses Web Bluetooth API for browser-based connectivity.
 *
 * G2 Display: 576x136 pixels, 1-bit BMP, 5 lines max text
 * Commands: 0x4E (text), 0x15 (image), 0xF5 (control)
 */

import { G2_DISPLAY, SignalEvent, CATEGORY_ICONS, SEVERITY_COLORS } from './types.js';

// BLE Service and Characteristic UUIDs for G2
// Based on even-g2-protocol documentation
const G2_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'; // Nordic UART Service
const G2_TX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';     // Write to glasses
const G2_RX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';     // Receive from glasses

// G2-specific content service (from reverse engineering)
const G2_CONTENT_SERVICE = '0000fe01-0000-1000-8000-00805f9b34fb';
const G2_CONTENT_WRITE = '0000fe02-0000-1000-8000-00805f9b34fb';
const G2_CONTENT_NOTIFY = '0000fe03-0000-1000-8000-00805f9b34fb';

export type G2ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface G2Connection {
  device: BluetoothDevice | null;
  server: BluetoothRemoteGATTServer | null;
  txChar: BluetoothRemoteGATTCharacteristic | null;
  rxChar: BluetoothRemoteGATTCharacteristic | null;
  status: G2ConnectionStatus;
}

let connection: G2Connection = {
  device: null,
  server: null,
  txChar: null,
  rxChar: null,
  status: 'disconnected',
};

const statusListeners: Array<(status: G2ConnectionStatus) => void> = [];
const touchListeners: Array<(event: 'tap' | 'double_tap' | 'triple_tap' | 'swipe_fwd' | 'swipe_back') => void> = [];

export function onStatusChange(cb: (status: G2ConnectionStatus) => void): () => void {
  statusListeners.push(cb);
  return () => {
    const i = statusListeners.indexOf(cb);
    if (i >= 0) statusListeners.splice(i, 1);
  };
}

export function onTouchEvent(cb: (event: 'tap' | 'double_tap' | 'triple_tap' | 'swipe_fwd' | 'swipe_back') => void): () => void {
  touchListeners.push(cb);
  return () => {
    const i = touchListeners.indexOf(cb);
    if (i >= 0) touchListeners.splice(i, 1);
  };
}

function setStatus(s: G2ConnectionStatus) {
  connection.status = s;
  statusListeners.forEach((cb) => cb(s));
}

export function getStatus(): G2ConnectionStatus {
  return connection.status;
}

/** Check if Web Bluetooth is available */
export function isBLESupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/** Connect to G2 glasses via Web Bluetooth */
export async function connectG2(): Promise<boolean> {
  if (!isBLESupported()) {
    console.warn('Web Bluetooth not supported in this browser');
    setStatus('error');
    return false;
  }

  setStatus('connecting');

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Even' },
        { namePrefix: 'G2' },
        { namePrefix: 'EVEN' },
      ],
      optionalServices: [G2_SERVICE_UUID, G2_CONTENT_SERVICE],
    });

    if (!device.gatt) {
      setStatus('error');
      return false;
    }

    device.addEventListener('gattserverdisconnected', () => {
      setStatus('disconnected');
      connection.server = null;
      connection.txChar = null;
      connection.rxChar = null;
    });

    const server = await device.gatt.connect();
    connection.device = device;
    connection.server = server;

    // Try G2-specific content service first, fall back to Nordic UART
    try {
      const service = await server.getPrimaryService(G2_CONTENT_SERVICE);
      connection.txChar = await service.getCharacteristic(G2_CONTENT_WRITE);
      try {
        connection.rxChar = await service.getCharacteristic(G2_CONTENT_NOTIFY);
        await connection.rxChar.startNotifications();
        connection.rxChar.addEventListener('characteristicvaluechanged', handleRxData);
      } catch { /* notify not available */ }
    } catch {
      // Fall back to Nordic UART
      const service = await server.getPrimaryService(G2_SERVICE_UUID);
      connection.txChar = await service.getCharacteristic(G2_TX_UUID);
      try {
        connection.rxChar = await service.getCharacteristic(G2_RX_UUID);
        await connection.rxChar.startNotifications();
        connection.rxChar.addEventListener('characteristicvaluechanged', handleRxData);
      } catch { /* notify not available */ }
    }

    setStatus('connected');
    return true;
  } catch (err) {
    console.error('G2 connection failed:', err);
    setStatus('error');
    return false;
  }
}

/** Disconnect from G2 */
export function disconnectG2(): void {
  if (connection.server?.connected) {
    connection.server.disconnect();
  }
  connection.device = null;
  connection.server = null;
  connection.txChar = null;
  connection.rxChar = null;
  setStatus('disconnected');
}

/** Handle incoming data from glasses (touch events, etc.) */
function handleRxData(event: Event): void {
  const char = event.target as BluetoothRemoteGATTCharacteristic;
  const value = char.value;
  if (!value) return;

  const cmd = value.getUint8(0);
  if (cmd === 0xf5) {
    const sub = value.getUint8(1);
    switch (sub) {
      case 0x01: touchListeners.forEach((cb) => cb('tap')); break;
      case 0x00: touchListeners.forEach((cb) => cb('double_tap')); break;
      case 0x02: touchListeners.forEach((cb) => cb('swipe_fwd')); break;
      case 0x03: touchListeners.forEach((cb) => cb('swipe_back')); break;
      case 0x04: touchListeners.forEach((cb) => cb('triple_tap')); break;
    }
  }
}

/** Send raw bytes to G2 in chunks of 194 bytes max */
async function sendBytes(data: Uint8Array): Promise<void> {
  if (!connection.txChar) return;

  const CHUNK = 194;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    await connection.txChar.writeValueWithoutResponse(chunk);
    // Small delay between chunks for BLE stability
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Build a text command packet (0x4E) for the G2 display.
 * Based on EvenDemoApp protocol documentation.
 */
function buildTextPacket(text: string, seq: number, total: number, current: number, isLast: boolean): Uint8Array {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);

  // Command 0x4E: AI result / text display
  // [cmd, seq, total_packages, current_package, screen_status, char_pos, page_hi, page_lo, ...text]
  const screenStatus = isLast ? 0x40 : 0x30; // 0x40 = complete, 0x30 = displaying
  const header = new Uint8Array([
    0x4e,
    seq & 0xff,
    total & 0xff,
    current & 0xff,
    screenStatus | 0x01, // 0x01 = new content in lower nibble
    0x00, // char position
    0x00, 0x01, // page number
  ]);

  const packet = new Uint8Array(header.length + textBytes.length);
  packet.set(header);
  packet.set(textBytes, header.length);
  return packet;
}

/** Split text into lines that fit the G2 display */
function splitTextForDisplay(text: string, maxCharsPerLine: number = 28): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxCharsPerLine) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine) : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/** Send text to G2 glasses display */
export async function sendTextToG2(text: string): Promise<void> {
  if (connection.status !== 'connected' || !connection.txChar) return;

  const lines = splitTextForDisplay(text, 28);
  // Group into pages of 5 lines
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += G2_DISPLAY.MAX_LINES) {
    const pageLines = lines.slice(i, i + G2_DISPLAY.MAX_LINES);
    pages.push(pageLines.join('\n'));
  }

  for (let i = 0; i < pages.length; i++) {
    const packet = buildTextPacket(pages[i], i, pages.length, i, i === pages.length - 1);
    await sendBytes(packet);
    if (i < pages.length - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** Format a signal event for the G2 display (compact 5-line format) */
export function formatEventForG2(event: SignalEvent, index: number, total: number): string {
  const icon = CATEGORY_ICONS[event.category] ?? '';
  const sev = event.severity.toUpperCase().slice(0, 4);
  const time = formatRelativeTime(event.timestamp);
  const header = `${icon} [${sev}] ${event.category.toUpperCase()}`;
  const counter = `${index + 1}/${total}`;

  return [
    `${header}  ${counter}`,
    event.title.slice(0, 56),
    event.country ? `${event.region} > ${event.country}` : event.region,
    `${time} | ${event.source}`,
    event.summary.slice(0, 56),
  ].join('\n');
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Send a signal event to the G2 glasses */
export async function sendEventToG2(event: SignalEvent, index: number, total: number): Promise<void> {
  const formatted = formatEventForG2(event, index, total);
  await sendTextToG2(formatted);
}

/**
 * Even Realities G2 Glasses BLE Communication
 *
 * Protocol based on i-soxi/even-g2-protocol reverse engineering.
 * Uses Web Bluetooth API for browser-based connectivity.
 *
 * G2 uses a custom binary protocol with:
 * - Sync bytes: 0xAA 0x21
 * - CRC-16/CCITT on payload
 * - 7-packet auth handshake
 * - Teleprompter service (0x06-0x20) for text display
 * - Write characteristic: 0x5401
 * - Notify characteristic: 0x5402
 *
 * Reference: https://github.com/i-soxi/even-g2-protocol
 */

import { SignalEvent, CATEGORY_ICONS } from './types.js';

// ── BLE UUIDs ────────────────────────────────────────────────────────
// G2 base UUID pattern: 00002760-08c2-11e1-9073-0e8ac72e{xxxx}

function g2UUID(suffix: number): string {
  return `00002760-08c2-11e1-9073-0e8ac72e${suffix.toString(16).padStart(4, '0')}`;
}

const CHAR_WRITE = g2UUID(0x5401);   // Phone → Glasses (write without response)
const CHAR_NOTIFY = g2UUID(0x5402);  // Glasses → Phone (notifications)

// We need to discover the service that contains these characteristics.
// The G2 exposes a primary service containing 0x5401 and 0x5402.
// We'll request by characteristic filters and discover dynamically.

export type G2ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error';

interface G2State {
  device: BluetoothDevice | null;
  server: BluetoothRemoteGATTServer | null;
  writeChar: BluetoothRemoteGATTCharacteristic | null;
  notifyChar: BluetoothRemoteGATTCharacteristic | null;
  status: G2ConnectionStatus;
  seq: number;    // Packet sequence counter
  msgId: number;  // Message ID counter for teleprompter protocol
  authenticated: boolean;
}

let state: G2State = {
  device: null,
  server: null,
  writeChar: null,
  notifyChar: null,
  status: 'disconnected',
  seq: 0,
  msgId: 0,
  authenticated: false,
};

const statusListeners: Array<(status: G2ConnectionStatus) => void> = [];
const touchListeners: Array<(event: 'tap' | 'double_tap' | 'triple_tap' | 'swipe_fwd' | 'swipe_back') => void> = [];

export function onStatusChange(cb: (status: G2ConnectionStatus) => void): () => void {
  statusListeners.push(cb);
  return () => { const i = statusListeners.indexOf(cb); if (i >= 0) statusListeners.splice(i, 1); };
}

export function onTouchEvent(cb: (event: 'tap' | 'double_tap' | 'triple_tap' | 'swipe_fwd' | 'swipe_back') => void): () => void {
  touchListeners.push(cb);
  return () => { const i = touchListeners.indexOf(cb); if (i >= 0) touchListeners.splice(i, 1); };
}

function setStatus(s: G2ConnectionStatus) {
  state.status = s;
  statusListeners.forEach((cb) => cb(s));
}

export function getStatus(): G2ConnectionStatus {
  return state.status;
}

export function isBLESupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

// ── CRC-16/CCITT ─────────────────────────────────────────────────────

function crc16ccitt(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc;
}

// ── Varint encoding (protobuf-style) ─────────────────────────────────

function encodeVarint(value: number): Uint8Array {
  const result: number[] = [];
  while (value > 0x7f) {
    result.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  result.push(value & 0x7f);
  return new Uint8Array(result);
}

// ── Packet builder ───────────────────────────────────────────────────

/** Build a G2 protocol packet: [AA 21 seq len 01 01 svc_hi svc_lo payload... crc_lo crc_hi] */
function buildPacket(seq: number, serviceHi: number, serviceLo: number, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array([
    0xaa, 0x21, seq & 0xff, payload.length + 2, 0x01, 0x01, serviceHi, serviceLo,
  ]);
  const full = new Uint8Array(header.length + payload.length);
  full.set(header);
  full.set(payload, header.length);

  // CRC is computed on payload bytes only (skip 8-byte header)
  const crc = crc16ccitt(full.slice(8));
  const withCrc = new Uint8Array(full.length + 2);
  withCrc.set(full);
  withCrc[full.length] = crc & 0xff;       // CRC low
  withCrc[full.length + 1] = (crc >> 8) & 0xff; // CRC high
  return withCrc;
}

/** Add CRC to a pre-built packet (for auth packets built with full header) */
function addCrc(packet: Uint8Array): Uint8Array {
  const payload = packet.slice(8);
  const crc = crc16ccitt(payload);
  const withCrc = new Uint8Array(packet.length + 2);
  withCrc.set(packet);
  withCrc[packet.length] = crc & 0xff;
  withCrc[packet.length + 1] = (crc >> 8) & 0xff;
  return withCrc;
}

function nextSeq(): number {
  state.seq = (state.seq + 1) & 0xff;
  return state.seq;
}

function nextMsgId(): number {
  return ++state.msgId;
}

// ── Send to glasses ──────────────────────────────────────────────────

async function sendPacket(packet: Uint8Array): Promise<void> {
  if (!state.writeChar) return;
  await state.writeChar.writeValueWithoutResponse(packet as unknown as BufferSource);
  // Small delay for BLE stability
  await delay(30);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Authentication (7-packet handshake) ──────────────────────────────

function buildAuthPackets(): Uint8Array[] {
  const timestamp = Math.floor(Date.now() / 1000);
  const tsVarint = encodeVarint(timestamp);
  const txid = new Uint8Array([0xe8, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
  const packets: Uint8Array[] = [];

  // Auth 1
  packets.push(addCrc(new Uint8Array([
    0xaa, 0x21, 0x01, 0x0c, 0x01, 0x01, 0x80, 0x00,
    0x08, 0x04, 0x10, 0x0c, 0x1a, 0x04, 0x08, 0x01, 0x10, 0x04,
  ])));

  // Auth 2
  packets.push(addCrc(new Uint8Array([
    0xaa, 0x21, 0x02, 0x0a, 0x01, 0x01, 0x80, 0x20,
    0x08, 0x05, 0x10, 0x0e, 0x22, 0x02, 0x08, 0x02,
  ])));

  // Auth 3 (includes timestamp)
  const auth3Payload = concatBytes(
    new Uint8Array([0x08, 0x80, 0x01, 0x10, 0x0f, 0x82, 0x08, 0x11, 0x08]),
    tsVarint,
    new Uint8Array([0x10]),
    txid,
  );
  const auth3Header = new Uint8Array([
    0xaa, 0x21, 0x03, auth3Payload.length + 2, 0x01, 0x01, 0x80, 0x20,
  ]);
  packets.push(addCrc(concatBytes(auth3Header, auth3Payload)));

  // Auth 4
  packets.push(addCrc(new Uint8Array([
    0xaa, 0x21, 0x04, 0x0c, 0x01, 0x01, 0x80, 0x00,
    0x08, 0x04, 0x10, 0x10, 0x1a, 0x04, 0x08, 0x01, 0x10, 0x04,
  ])));

  // Auth 5
  packets.push(addCrc(new Uint8Array([
    0xaa, 0x21, 0x05, 0x0c, 0x01, 0x01, 0x80, 0x00,
    0x08, 0x04, 0x10, 0x11, 0x1a, 0x04, 0x08, 0x01, 0x10, 0x04,
  ])));

  // Auth 6
  packets.push(addCrc(new Uint8Array([
    0xaa, 0x21, 0x06, 0x0a, 0x01, 0x01, 0x80, 0x20,
    0x08, 0x05, 0x10, 0x12, 0x22, 0x02, 0x08, 0x01,
  ])));

  // Auth 7 (includes timestamp)
  const auth7Payload = concatBytes(
    new Uint8Array([0x08, 0x80, 0x01, 0x10, 0x13, 0x82, 0x08, 0x11, 0x08]),
    tsVarint,
    new Uint8Array([0x10]),
    txid,
  );
  const auth7Header = new Uint8Array([
    0xaa, 0x21, 0x07, auth7Payload.length + 2, 0x01, 0x01, 0x80, 0x20,
  ]);
  packets.push(addCrc(concatBytes(auth7Header, auth7Payload)));

  return packets;
}

async function authenticate(): Promise<boolean> {
  try {
    const authPackets = buildAuthPackets();
    for (const pkt of authPackets) {
      await sendPacket(pkt);
      await delay(50);
    }
    state.seq = 7; // Auth used sequences 1-7
    state.authenticated = true;
    return true;
  } catch (err) {
    console.error('G2 auth failed:', err);
    return false;
  }
}

// ── Display Config (0x0E-0x20, type=2) ───────────────────────────────

function buildDisplayConfig(): Uint8Array {
  const msgId = nextMsgId();
  // Pre-baked display config from reference implementation
  const config = hexToBytes(
    '0801121308021090' + '4E1D00E094442500' + '000000280030001213' +
    '0803100D0F1D0040' + '8D44250000000028' + '0030001212080410' +
    '001D0000884225' + '00000000280030' + '001212080510001D' +
    '00009242250000' + 'A242280030001212' + '080610001D0000C6' +
    '42250000C4422800' + '30001800'
  );
  const payload = concatBytes(
    new Uint8Array([0x08, 0x02, 0x10]),
    encodeVarint(msgId),
    new Uint8Array([0x22, config.length]),
    config,
  );
  return buildPacket(nextSeq(), 0x0e, 0x20, payload);
}

// ── Teleprompter Init (0x06-0x20, type=1) ────────────────────────────

function buildTeleprompterInit(totalLines: number, manualMode: boolean = true): Uint8Array {
  const msgId = nextMsgId();
  const mode = manualMode ? 0x00 : 0x01;
  const contentHeight = Math.max(1, Math.floor((totalLines * 2665) / 140));

  const display = concatBytes(
    new Uint8Array([0x08, 0x01, 0x10, 0x00, 0x18, 0x00, 0x20, 0x8b, 0x02]),
    new Uint8Array([0x28]),
    encodeVarint(contentHeight),
    new Uint8Array([0x30, 0xe6, 0x01]),
    new Uint8Array([0x38, 0x8e, 0x0a]),
    new Uint8Array([0x40, 0x05, 0x48, mode]),
  );

  const settings = concatBytes(
    new Uint8Array([0x08, 0x01, 0x12, display.length]),
    display,
  );

  const payload = concatBytes(
    new Uint8Array([0x08, 0x01, 0x10]),
    encodeVarint(msgId),
    new Uint8Array([0x1a, settings.length]),
    settings,
  );

  return buildPacket(nextSeq(), 0x06, 0x20, payload);
}

// ── Content Page (0x06-0x20, type=3) ─────────────────────────────────

function buildContentPage(pageNum: number, text: string): Uint8Array {
  const msgId = nextMsgId();
  const encoder = new TextEncoder();
  const textBytes = encoder.encode('\n' + text);

  const inner = concatBytes(
    new Uint8Array([0x08]),
    encodeVarint(pageNum),
    new Uint8Array([0x10, 0x0a]),  // line count = 10
    new Uint8Array([0x1a]),
    encodeVarint(textBytes.length),
    textBytes,
  );

  const content = concatBytes(
    new Uint8Array([0x2a]),
    encodeVarint(inner.length),
    inner,
  );

  const payload = concatBytes(
    new Uint8Array([0x08, 0x03, 0x10]),
    encodeVarint(msgId),
    content,
  );

  return buildPacket(nextSeq(), 0x06, 0x20, payload);
}

// ── Mid-stream Marker (type=255) ─────────────────────────────────────

function buildMarker(): Uint8Array {
  const msgId = nextMsgId();
  const payload = concatBytes(
    new Uint8Array([0x08, 0xff, 0x01, 0x10]),
    encodeVarint(msgId),
    new Uint8Array([0x6a, 0x04, 0x08, 0x00, 0x10, 0x06]),
  );
  return buildPacket(nextSeq(), 0x06, 0x20, payload);
}

// ── Sync Trigger (0x80-0x00, type=14) ────────────────────────────────

function buildSync(): Uint8Array {
  const msgId = nextMsgId();
  const payload = concatBytes(
    new Uint8Array([0x08, 0x0e, 0x10]),
    encodeVarint(msgId),
    new Uint8Array([0x6a, 0x00]),
  );
  return buildPacket(nextSeq(), 0x80, 0x00, payload);
}

// ── Content Complete (type=4) ────────────────────────────────────────

function buildContentComplete(totalPages: number, totalLines: number): Uint8Array {
  const msgId = nextMsgId();
  const payload = concatBytes(
    new Uint8Array([0x08, 0x04, 0x10]),
    encodeVarint(msgId),
    new Uint8Array([0x32]),
    encodeVarint(6), // inner length (approximate)
    new Uint8Array([0x08, 0x00]),
    new Uint8Array([0x10]),
    encodeVarint(totalPages),
    new Uint8Array([0x18]),
    encodeVarint(totalLines),
  );
  return buildPacket(nextSeq(), 0x06, 0x20, payload);
}

// ── Helpers ──────────────────────────────────────────────────────────

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Split text into pages of ~10 lines, ~25 chars per line */
function textToPages(text: string): string[] {
  const CHARS_PER_LINE = 25;
  const LINES_PER_PAGE = 10;

  // Word-wrap into lines
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= CHARS_PER_LINE) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word.length > CHARS_PER_LINE ? word.slice(0, CHARS_PER_LINE) : word;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Group into pages
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE).join('\n'));
  }

  return pages.length > 0 ? pages : [''];
}

// ── Connection ───────────────────────────────────────────────────────

/** Connect to G2 glasses via Web Bluetooth */
export async function connectG2(): Promise<boolean> {
  if (!isBLESupported()) {
    console.warn('Web Bluetooth not supported');
    setStatus('error');
    return false;
  }

  setStatus('connecting');

  try {
    // Request device with name filter; use acceptAllServices to discover
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Even' },
        { namePrefix: 'G2' },
        { namePrefix: 'EVEN' },
      ],
      optionalServices: ['generic_access', 'generic_attribute'],
      // We'll discover services after connecting
    });

    if (!device.gatt) {
      setStatus('error');
      return false;
    }

    device.addEventListener('gattserverdisconnected', () => {
      setStatus('disconnected');
      state.server = null;
      state.writeChar = null;
      state.notifyChar = null;
      state.authenticated = false;
    });

    const server = await device.gatt.connect();
    state.device = device;
    state.server = server;

    // Discover all services and find our characteristics
    const services = await server.getPrimaryServices();
    let foundWrite = false;

    for (const service of services) {
      try {
        const chars = await service.getCharacteristics();
        for (const char of chars) {
          if (char.uuid === CHAR_WRITE) {
            state.writeChar = char;
            foundWrite = true;
            console.log('Found G2 write characteristic on service:', service.uuid);
          }
          if (char.uuid === CHAR_NOTIFY) {
            state.notifyChar = char;
            try {
              await char.startNotifications();
              char.addEventListener('characteristicvaluechanged', handleRxData);
              console.log('Subscribed to G2 notifications');
            } catch (e) {
              console.warn('Could not subscribe to notifications:', e);
            }
          }
        }
      } catch {
        // Some services may not be readable, skip
      }
    }

    if (!foundWrite) {
      console.error('G2 write characteristic (0x5401) not found');
      setStatus('error');
      server.disconnect();
      return false;
    }

    setStatus('connected');

    // Run authentication handshake
    const authed = await authenticate();
    if (authed) {
      setStatus('authenticated');
      console.log('G2 authenticated successfully');
    } else {
      console.warn('G2 auth may have failed, text sending might not work');
    }

    return true;
  } catch (err) {
    console.error('G2 connection failed:', err);
    setStatus('error');
    return false;
  }
}

/** Disconnect from G2 */
export function disconnectG2(): void {
  if (state.server?.connected) {
    state.server.disconnect();
  }
  state.device = null;
  state.server = null;
  state.writeChar = null;
  state.notifyChar = null;
  state.authenticated = false;
  state.seq = 0;
  state.msgId = 0;
  setStatus('disconnected');
}

/** Handle incoming data from glasses */
function handleRxData(event: Event): void {
  const char = event.target as BluetoothRemoteGATTCharacteristic;
  const value = char.value;
  if (!value || value.byteLength < 2) return;

  // Log raw responses for debugging
  const bytes = new Uint8Array(value.buffer);
  console.log('G2 RX:', Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' '));

  // Check for touch events — G2 touch events come through the notification channel
  // Format: [AA 21 seq len 01 01 svc_hi svc_lo payload...]
  if (bytes.length >= 10 && bytes[0] === 0xaa && bytes[1] === 0x21) {
    const svcHi = bytes[6];
    const svcLo = bytes[7];
    // Touch events typically come on service 0x80-0x00
    if (svcHi === 0x80 && svcLo === 0x00 && bytes.length >= 10) {
      const type = bytes[8];
      if (type === 0xf5 || type === 0x01) {
        const sub = bytes[9];
        switch (sub) {
          case 0x01: touchListeners.forEach((cb) => cb('tap')); break;
          case 0x00: touchListeners.forEach((cb) => cb('double_tap')); break;
          case 0x02: touchListeners.forEach((cb) => cb('swipe_fwd')); break;
          case 0x03: touchListeners.forEach((cb) => cb('swipe_back')); break;
          case 0x04: touchListeners.forEach((cb) => cb('triple_tap')); break;
        }
      }
    }
  }
}

// ── Public API: Send Text ────────────────────────────────────────────

/**
 * Send text to G2 glasses using the teleprompter protocol.
 *
 * Full sequence:
 * 1. Display config (0x0E-0x20)
 * 2. Teleprompter init (0x06-0x20, type=1)
 * 3. Content pages 0-9 (type=3)
 * 4. Mid-stream marker (type=255) after page 9
 * 5. Content pages 10-11 (type=3)
 * 6. Sync trigger (0x80-0x00, type=14)
 * 7. Remaining content pages (type=3)
 * 8. Content complete (type=4)
 */
export async function sendTextToG2(text: string): Promise<void> {
  if (!state.writeChar) return;
  if (!state.authenticated) {
    console.warn('G2 not authenticated, attempting auth...');
    await authenticate();
  }

  const pages = textToPages(text);
  const totalLines = text.split('\n').length;

  // 1. Display config
  await sendPacket(buildDisplayConfig());
  await delay(50);

  // 2. Teleprompter init
  await sendPacket(buildTeleprompterInit(totalLines, true));
  await delay(50);

  // 3. Send content pages
  for (let i = 0; i < pages.length; i++) {
    await sendPacket(buildContentPage(i, pages[i]));
    await delay(30);

    // Insert mid-stream marker after page 9
    if (i === 9 && pages.length > 10) {
      await sendPacket(buildMarker());
      await delay(30);
    }

    // Insert sync trigger after page 11 (or after last page if < 12)
    if (i === 11 || (i === pages.length - 1 && pages.length <= 12)) {
      await sendPacket(buildSync());
      await delay(30);
    }
  }

  // 4. Content complete
  await sendPacket(buildContentComplete(pages.length, totalLines));
}

/** Format a signal event for the G2 display */
export function formatEventForG2(event: SignalEvent, index: number, total: number): string {
  const icon = CATEGORY_ICONS[event.category] ?? '';
  const sev = event.severity.toUpperCase().slice(0, 4);
  const time = formatRelativeTime(event.timestamp);
  const counter = `${index + 1}/${total}`;

  return [
    `${icon} [${sev}] ${event.category.toUpperCase()}  ${counter}`,
    '',
    event.title,
    '',
    `${event.region}${event.country ? ' > ' + event.country : ''}`,
    `${time} | ${event.source}`,
    '',
    event.summary,
  ].join('\n');
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Send a signal event to the G2 glasses */
export async function sendEventToG2(event: SignalEvent, index: number, total: number): Promise<void> {
  const formatted = formatEventForG2(event, index, total);
  await sendTextToG2(formatted);
}

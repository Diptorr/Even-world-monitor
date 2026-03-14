/**
 * Even World Monitor — Main Application
 *
 * On launch:
 * 1. Loads latest signals from World Monitor
 * 2. Requests notification permission
 * 3. Fires phone notifications for top critical events
 *    → Even app forwards these to G2 glasses automatically
 * 4. Auto-refreshes every 60s and notifies on new urgent events
 *
 * The G2 glasses display phone notifications natively through the
 * Even Realities app — no BLE pairing from the browser needed.
 */

import { fetchAllSignals, generateDemoSignals } from './api.js';
import { connectG2, disconnectG2, onStatusChange, getStatus, sendEventToG2, onTouchEvent, isBLESupported } from './ble-g2.js';
import { connectR1, disconnectR1, onR1Gesture, onR1StatusChange, getR1Status, enableKeyboardFallback } from './ble-r1.js';
import { DashboardState, createInitialState, filterEvents, renderDashboard } from './dashboard.js';
import { SignalCategory, SIGNAL_CATEGORIES, REGIONS } from './types.js';
import { showQROverlay } from './qr-overlay.js';
import {
  requestNotificationPermission, isNotificationEnabled,
  notifyTopEvents, notifyNewEvents, notifyEvent,
} from './notifications.js';

// ── State ────────────────────────────────────────────────────────────

let state: DashboardState = createInitialState();
let previousEvents = state.events;
const app = document.getElementById('app')!;

// ── Render ───────────────────────────────────────────────────────────

function render() {
  state.filteredEvents = filterEvents(state);
  if (state.currentIndex >= state.filteredEvents.length) {
    state.currentIndex = Math.max(0, state.filteredEvents.length - 1);
  }
  app.innerHTML = renderDashboard(state);
  bindEvents();
  updateDeviceStatus();
  updateNotificationStatus();
}

function updateDeviceStatus() {
  const g2Dot = document.getElementById('g2-dot');
  const r1Dot = document.getElementById('r1-dot');
  if (g2Dot) {
    const g2s = getStatus();
    g2Dot.className = `status-dot ${g2s === 'authenticated' ? 'connected' : g2s}`;
  }
  if (r1Dot) {
    r1Dot.className = `status-dot ${getR1Status()}`;
  }
}

function updateNotificationStatus() {
  const dot = document.getElementById('notif-dot');
  if (dot) {
    dot.className = `status-dot ${isNotificationEnabled() ? 'connected' : 'disconnected'}`;
  }
}

// ── Event Binding ────────────────────────────────────────────────────

function bindEvents() {
  // Region select
  const regionSelect = document.getElementById('region-select') as HTMLSelectElement | null;
  regionSelect?.addEventListener('change', () => {
    state.selectedRegion = regionSelect.value;
    state.selectedCountry = '';
    state.currentIndex = 0;
    render();
  });

  // Country select
  const countrySelect = document.getElementById('country-select') as HTMLSelectElement | null;
  countrySelect?.addEventListener('change', () => {
    state.selectedCountry = countrySelect.value;
    state.currentIndex = 0;
    render();
  });

  // Search
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
  searchInput?.addEventListener('input', () => {
    state.searchQuery = searchInput.value;
    state.currentIndex = 0;
    render();
    const newInput = document.getElementById('search-input') as HTMLInputElement | null;
    newInput?.focus();
    if (newInput) newInput.selectionStart = newInput.selectionEnd = newInput.value.length;
  });

  // Category filters
  document.getElementById('btn-cat-all')?.addEventListener('click', () => {
    if (state.selectedCategories.size === SIGNAL_CATEGORIES.length) {
      state.selectedCategories = new Set();
    } else {
      state.selectedCategories = new Set(SIGNAL_CATEGORIES);
    }
    state.currentIndex = 0;
    render();
  });

  document.querySelectorAll('.cat-btn[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = (btn as HTMLElement).dataset.category as SignalCategory;
      if (state.selectedCategories.has(cat)) {
        state.selectedCategories.delete(cat);
      } else {
        state.selectedCategories.add(cat);
      }
      state.currentIndex = 0;
      render();
    });
  });

  // Event cards - click to select AND send notification to G2
  document.querySelectorAll('.event-card[data-index]').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt((card as HTMLElement).dataset.index ?? '0');
      state.currentIndex = idx;
      render();

      // Send to G2 via notification
      const event = state.filteredEvents[idx];
      if (event) {
        notifyEvent(event);
        sendCurrentToG2();
      }
    });
  });

  // G2 controls
  document.getElementById('btn-g2-prev')?.addEventListener('click', () => navigateEvent(-1));
  document.getElementById('btn-g2-next')?.addEventListener('click', () => navigateEvent(1));
  document.getElementById('btn-g2-send')?.addEventListener('click', () => {
    sendCurrentToG2();
    // Also send as notification
    const event = state.filteredEvents[state.currentIndex];
    if (event) notifyEvent(event);
  });

  // Device connect buttons
  document.getElementById('btn-connect-g2')?.addEventListener('click', toggleG2);
  document.getElementById('btn-connect-r1')?.addEventListener('click', toggleR1);

  // Notification enable button
  document.getElementById('btn-enable-notif')?.addEventListener('click', async () => {
    await requestNotificationPermission();
    updateNotificationStatus();
    // If just enabled, send top events right away
    if (isNotificationEnabled() && state.filteredEvents.length > 0) {
      notifyTopEvents(state.filteredEvents, 3);
    }
  });

  // QR code overlay button
  document.getElementById('btn-show-qr')?.addEventListener('click', () => showQROverlay());
}

// ── Navigation ───────────────────────────────────────────────────────

function navigateEvent(delta: number) {
  const max = state.filteredEvents.length;
  if (max === 0) return;
  state.currentIndex = (state.currentIndex + delta + max) % max;
  render();
  sendCurrentToG2();

  // Also push notification for the new current event
  const event = state.filteredEvents[state.currentIndex];
  if (event) notifyEvent(event);

  const selected = document.querySelector('.event-card.selected');
  selected?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function sendCurrentToG2() {
  const s = getStatus();
  if (s !== 'connected' && s !== 'authenticated') return;
  const event = state.filteredEvents[state.currentIndex];
  if (event) {
    await sendEventToG2(event, state.currentIndex, state.filteredEvents.length);
  }
}

// ── Device Management ────────────────────────────────────────────────

async function toggleG2() {
  const s = getStatus();
  if (s === 'connected' || s === 'authenticated') {
    disconnectG2();
  } else {
    await connectG2();
    const after = getStatus();
    if (after === 'connected' || after === 'authenticated') {
      sendCurrentToG2();
    }
  }
  updateDeviceStatus();
}

async function toggleR1() {
  if (getR1Status() === 'connected') {
    disconnectR1();
  } else {
    await connectR1();
  }
  updateDeviceStatus();
}

// ── Data Loading ─────────────────────────────────────────────────────

async function loadSignals() {
  state.isLoading = true;
  render();

  try {
    const events = await fetchAllSignals();
    if (events.length > 0) {
      state.events = events;
    } else {
      console.info('API returned no events, using demo signals');
      state.events = generateDemoSignals();
    }
  } catch (err) {
    console.warn('Failed to fetch signals, using demo data:', err);
    state.events = generateDemoSignals();
  }

  state.isLoading = false;
  state.currentIndex = 0;
  render();

  // ─── AUTO-NOTIFY: On first load, push top events to G2 via notifications ───
  if (isNotificationEnabled()) {
    notifyTopEvents(state.events, 3);
  }
}

/** Auto-refresh signals and notify about new urgent events */
function startAutoRefresh(intervalMs: number = 60000) {
  setInterval(async () => {
    if (!state.isLiveMode) return;
    try {
      const events = await fetchAllSignals();
      if (events.length > 0) {
        previousEvents = state.events;
        state.events = events;
        render();

        // Notify about new critical/high events → appears on G2 glasses
        if (isNotificationEnabled()) {
          notifyNewEvents(previousEvents, state.events);
        }
      }
    } catch { /* ignore refresh errors */ }
  }, intervalMs);
}

// ── Initialization ───────────────────────────────────────────────────

async function init() {
  // Request notification permission immediately (needed for G2 glasses)
  // On mobile this may need a user gesture, so we also have the enable button
  await requestNotificationPermission();

  // Register BLE status listeners
  onStatusChange((status) => {
    updateDeviceStatus();
    if (status === 'connected' || status === 'authenticated') {
      sendCurrentToG2();
    }
  });

  onR1StatusChange(() => updateDeviceStatus());

  // R1 ring gesture mapping
  onR1Gesture((gesture) => {
    switch (gesture) {
      case 'swipe_right': navigateEvent(1); break;
      case 'swipe_left': navigateEvent(-1); break;
      case 'tap': sendCurrentToG2(); break;
      case 'double_tap':
        const regions = Object.keys(REGIONS ?? {});
        const idx = regions.indexOf(state.selectedRegion);
        state.selectedRegion = regions[(idx + 1) % regions.length];
        state.selectedCountry = '';
        state.currentIndex = 0;
        render();
        break;
      case 'swipe_up': navigateEvent(-5); break;
      case 'swipe_down': navigateEvent(5); break;
    }
  });

  // G2 touchbar gesture mapping
  onTouchEvent((event) => {
    switch (event) {
      case 'tap': navigateEvent(1); break;
      case 'double_tap': navigateEvent(-1); break;
      case 'swipe_fwd': navigateEvent(1); break;
      case 'swipe_back': navigateEvent(-1); break;
    }
  });

  // Keyboard navigation (also serves as R1 fallback)
  enableKeyboardFallback();

  // Load data — this triggers auto-notify on completion
  loadSignals();
  startAutoRefresh(60000);

  // Show QR codes on launch
  showQROverlay();

  if (!isBLESupported()) {
    console.info('Web Bluetooth not supported. BLE direct connection unavailable.');
  }
}

init();

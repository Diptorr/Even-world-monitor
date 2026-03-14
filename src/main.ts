/**
 * Even World Monitor — Main Application
 *
 * Connects World Monitor signals API with:
 * - Web dashboard (filterable event feed)
 * - Even Realities G2 glasses (BLE text display)
 * - Even Realities R1 ring (BLE gesture navigation)
 */

import { fetchAllSignals, generateDemoSignals } from './api.js';
import { connectG2, disconnectG2, onStatusChange, getStatus, sendEventToG2, onTouchEvent, isBLESupported } from './ble-g2.js';
import { connectR1, disconnectR1, onR1Gesture, onR1StatusChange, getR1Status, enableKeyboardFallback } from './ble-r1.js';
import { DashboardState, createInitialState, filterEvents, renderDashboard } from './dashboard.js';
import { SignalCategory, SIGNAL_CATEGORIES, REGIONS } from './types.js';
import { showQROverlay } from './qr-overlay.js';

// ── State ────────────────────────────────────────────────────────────

let state: DashboardState = createInitialState();
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
}

function updateDeviceStatus() {
  const g2Dot = document.getElementById('g2-dot');
  const r1Dot = document.getElementById('r1-dot');
  if (g2Dot) {
    g2Dot.className = `status-dot ${getStatus()}`;
  }
  if (r1Dot) {
    r1Dot.className = `status-dot ${getR1Status()}`;
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
    // Refocus the input after re-render
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

  // Event cards - click to select
  document.querySelectorAll('.event-card[data-index]').forEach((card) => {
    card.addEventListener('click', () => {
      state.currentIndex = parseInt((card as HTMLElement).dataset.index ?? '0');
      render();
      sendCurrentToG2();
    });
  });

  // G2 controls
  document.getElementById('btn-g2-prev')?.addEventListener('click', () => navigateEvent(-1));
  document.getElementById('btn-g2-next')?.addEventListener('click', () => navigateEvent(1));
  document.getElementById('btn-g2-send')?.addEventListener('click', sendCurrentToG2);

  // Device connect buttons
  document.getElementById('btn-connect-g2')?.addEventListener('click', toggleG2);
  document.getElementById('btn-connect-r1')?.addEventListener('click', toggleR1);

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

  // Scroll selected card into view
  const selected = document.querySelector('.event-card.selected');
  selected?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function sendCurrentToG2() {
  if (getStatus() !== 'connected') return;
  const event = state.filteredEvents[state.currentIndex];
  if (event) {
    await sendEventToG2(event, state.currentIndex, state.filteredEvents.length);
  }
}

// ── Device Management ────────────────────────────────────────────────

async function toggleG2() {
  if (getStatus() === 'connected') {
    disconnectG2();
  } else {
    await connectG2();
    if (getStatus() === 'connected') {
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
      // Fall back to demo data if API is not reachable
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
}

/** Auto-refresh signals on interval */
function startAutoRefresh(intervalMs: number = 60000) {
  setInterval(async () => {
    if (!state.isLiveMode) return;
    try {
      const events = await fetchAllSignals();
      if (events.length > 0) {
        state.events = events;
        render();
      }
    } catch { /* ignore refresh errors */ }
  }, intervalMs);
}

// ── Initialization ───────────────────────────────────────────────────

function init() {
  // Register BLE status listeners
  onStatusChange((status) => {
    updateDeviceStatus();
    if (status === 'connected') {
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
        // Cycle region filter
        const regions = Object.keys(REGIONS ?? {});
        const idx = regions.indexOf(state.selectedRegion);
        state.selectedRegion = regions[(idx + 1) % regions.length];
        state.selectedCountry = '';
        state.currentIndex = 0;
        render();
        break;
      case 'swipe_up':
        // Cycle severity filter (not implemented as separate filter, navigate up)
        navigateEvent(-5);
        break;
      case 'swipe_down':
        navigateEvent(5);
        break;
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

  // Load data
  loadSignals();
  startAutoRefresh(60000);

  // Show QR codes on launch so other devices can connect
  showQROverlay();

  // Show BLE support warning
  if (!isBLESupported()) {
    console.info('Web Bluetooth not supported. G2/R1 connection requires Chrome/Edge with BLE.');
  }
}

init();

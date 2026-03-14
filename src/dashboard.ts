/**
 * Dashboard UI for World Monitor Signals
 *
 * Renders a filterable event feed with region/country selectors,
 * category filters, and severity indicators. Designed to work both
 * as a standalone web dashboard and as a companion for G2 glasses.
 */

import {
  SignalEvent, SignalCategory, SIGNAL_CATEGORIES, CATEGORY_LABELS,
  CATEGORY_ICONS, SEVERITY_COLORS, REGIONS,
} from './types.js';

export interface DashboardState {
  events: SignalEvent[];
  filteredEvents: SignalEvent[];
  selectedRegion: string;
  selectedCountry: string;
  selectedCategories: Set<SignalCategory>;
  currentIndex: number;
  isLoading: boolean;
  isLiveMode: boolean;
  searchQuery: string;
}

export function createInitialState(): DashboardState {
  return {
    events: [],
    filteredEvents: [],
    selectedRegion: 'Global',
    selectedCountry: '',
    selectedCategories: new Set(SIGNAL_CATEGORIES),
    currentIndex: 0,
    isLoading: true,
    isLiveMode: true,
    searchQuery: '',
  };
}

export function filterEvents(state: DashboardState): SignalEvent[] {
  let filtered = state.events;

  // Filter by region
  if (state.selectedRegion !== 'Global') {
    const regionCountries = REGIONS[state.selectedRegion] ?? [];
    filtered = filtered.filter((e) =>
      e.region === state.selectedRegion ||
      regionCountries.includes(e.country)
    );
  }

  // Filter by country
  if (state.selectedCountry) {
    filtered = filtered.filter((e) => e.country === state.selectedCountry);
  }

  // Filter by categories
  if (state.selectedCategories.size < SIGNAL_CATEGORIES.length) {
    filtered = filtered.filter((e) => state.selectedCategories.has(e.category));
  }

  // Filter by search query
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter((e) =>
      e.title.toLowerCase().includes(q) ||
      e.summary.toLowerCase().includes(q) ||
      e.country.toLowerCase().includes(q) ||
      e.source.toLowerCase().includes(q)
    );
  }

  return filtered;
}

/** Render the complete dashboard HTML */
export function renderDashboard(state: DashboardState): string {
  const regionOptions = Object.keys(REGIONS)
    .map((r) => `<option value="${r}" ${r === state.selectedRegion ? 'selected' : ''}>${r}</option>`)
    .join('');

  const countryOptions = getCountriesForRegion(state.selectedRegion, state.events)
    .map((c) => `<option value="${c}" ${c === state.selectedCountry ? 'selected' : ''}>${c}</option>`)
    .join('');

  const categoryFilters = SIGNAL_CATEGORIES.map((cat) => {
    const active = state.selectedCategories.has(cat);
    return `<button class="cat-btn ${active ? 'active' : ''}" data-category="${cat}" title="${CATEGORY_LABELS[cat]}">
      <span class="cat-icon">${CATEGORY_ICONS[cat]}</span>
      <span class="cat-label">${CATEGORY_LABELS[cat]}</span>
    </button>`;
  }).join('');

  const eventCards = state.filteredEvents.length > 0
    ? state.filteredEvents.slice(0, 50).map((e, i) => renderEventCard(e, i, state.currentIndex)).join('')
    : '<div class="empty-state">No signals match your filters</div>';

  const sevCounts = countBySeverity(state.filteredEvents);

  return `
    <header class="dash-header">
      <div class="header-left">
        <h1 class="logo">
          <span class="logo-icon">\ud83c\udf10</span>
          <span>World Monitor</span>
          <span class="logo-sub">for Even Realities</span>
        </h1>
      </div>
      <div class="header-right">
        <div class="device-status" id="device-status">
          <button class="btn-device" id="btn-connect-g2" title="Connect G2 Glasses">
            <span class="device-icon">\ud83d\udc53</span>
            <span class="device-label">G2</span>
            <span class="status-dot disconnected" id="g2-dot"></span>
          </button>
          <button class="btn-device" id="btn-connect-r1" title="Connect R1 Ring">
            <span class="device-icon">\ud83d\udc8d</span>
            <span class="device-label">R1</span>
            <span class="status-dot disconnected" id="r1-dot"></span>
          </button>
        </div>
        <div class="live-indicator ${state.isLiveMode ? 'active' : ''}">
          <span class="live-dot"></span>
          <span>LIVE</span>
        </div>
      </div>
    </header>

    <div class="dash-toolbar">
      <div class="filter-row">
        <div class="filter-group">
          <label>Region</label>
          <select id="region-select" class="filter-select">
            ${regionOptions}
          </select>
        </div>
        <div class="filter-group">
          <label>Country</label>
          <select id="country-select" class="filter-select">
            <option value="">All Countries</option>
            ${countryOptions}
          </select>
        </div>
        <div class="filter-group search-group">
          <label>Search</label>
          <input type="text" id="search-input" class="filter-input" placeholder="Search signals..." value="${state.searchQuery}" />
        </div>
      </div>
      <div class="category-filters" id="category-filters">
        <button class="cat-btn-all active" id="btn-cat-all">All</button>
        ${categoryFilters}
      </div>
    </div>

    <div class="severity-bar">
      <div class="sev-item critical"><span class="sev-count">${sevCounts.critical}</span> Critical</div>
      <div class="sev-item high"><span class="sev-count">${sevCounts.high}</span> High</div>
      <div class="sev-item medium"><span class="sev-count">${sevCounts.medium}</span> Medium</div>
      <div class="sev-item low"><span class="sev-count">${sevCounts.low}</span> Low</div>
      <div class="sev-item info"><span class="sev-count">${sevCounts.info}</span> Info</div>
      <div class="sev-total">${state.filteredEvents.length} signals</div>
    </div>

    <div class="event-feed" id="event-feed">
      ${state.isLoading ? renderLoadingState() : eventCards}
    </div>

    <div class="g2-preview" id="g2-preview">
      <div class="g2-frame">
        <div class="g2-screen" id="g2-screen">
          <div class="g2-content">${state.filteredEvents.length > 0 ? formatG2Preview(state.filteredEvents[state.currentIndex], state.currentIndex, state.filteredEvents.length) : 'No signals'}</div>
        </div>
        <div class="g2-label">G2 Display Preview (576\u00d7136)</div>
      </div>
      <div class="g2-controls">
        <button class="g2-btn" id="btn-g2-prev" title="Previous (\u2190)">\u25c0</button>
        <button class="g2-btn" id="btn-g2-send" title="Send to G2">Send to G2</button>
        <button class="g2-btn" id="btn-g2-next" title="Next (\u2192)">\u25b6</button>
      </div>
    </div>

    <footer class="dash-footer">
      <span>Powered by <a href="https://github.com/koala73/worldmonitor" target="_blank">World Monitor</a></span>
      <span>|</span>
      <span>Built for <a href="https://www.evenrealities.com" target="_blank">Even Realities</a> G2 & R1</span>
      <span>|</span>
      <span>Keys: \u2190\u2192 navigate, Enter select, Esc back</span>
    </footer>
  `;
}

function renderEventCard(event: SignalEvent, index: number, selectedIndex: number): string {
  const icon = CATEGORY_ICONS[event.category] ?? '\ud83d\udccc';
  const sevColor = SEVERITY_COLORS[event.severity] ?? '#666';
  const time = formatTime(event.timestamp);
  const selected = index === selectedIndex ? 'selected' : '';

  return `
    <div class="event-card ${selected} severity-${event.severity}" data-index="${index}" style="--sev-color: ${sevColor}">
      <div class="event-sev-bar"></div>
      <div class="event-body">
        <div class="event-top">
          <span class="event-cat">${icon} ${CATEGORY_LABELS[event.category]}</span>
          <span class="event-sev badge-${event.severity}">${event.severity.toUpperCase()}</span>
          <span class="event-time">${time}</span>
        </div>
        <h3 class="event-title">${escapeHtml(event.title)}</h3>
        <p class="event-summary">${escapeHtml(event.summary)}</p>
        <div class="event-meta">
          <span class="event-location">\ud83d\udccd ${escapeHtml(event.region)}${event.country ? ' \u203a ' + escapeHtml(event.country) : ''}</span>
          <span class="event-source">${escapeHtml(event.source)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderLoadingState(): string {
  return `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Fetching signals from World Monitor...</p>
      <p class="loading-sub">Scanning conflict, climate, cyber, economic, and 16 more domains</p>
    </div>
  `;
}

function formatG2Preview(event: SignalEvent | undefined, index: number, total: number): string {
  if (!event) return 'No signals loaded';
  const icon = CATEGORY_ICONS[event.category] ?? '';
  const sev = event.severity.toUpperCase().slice(0, 4);
  const time = formatRelative(event.timestamp);
  return [
    `${icon} [${sev}] ${event.category.toUpperCase()}  ${index + 1}/${total}`,
    event.title.slice(0, 56),
    `${event.region}${event.country ? ' > ' + event.country : ''}`,
    `${time} | ${event.source}`,
    event.summary.slice(0, 56),
  ].map(escapeHtml).join('<br>');
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return 'Unknown';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

function formatRelative(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '?';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function getCountriesForRegion(region: string, events: SignalEvent[]): string[] {
  if (region === 'Global') {
    const countries = new Set(events.map((e) => e.country).filter(Boolean));
    return Array.from(countries).sort();
  }
  const predefined = REGIONS[region] ?? [];
  const fromEvents = events
    .filter((e) => e.region === region)
    .map((e) => e.country)
    .filter(Boolean);
  return Array.from(new Set([...predefined, ...fromEvents])).sort();
}

function countBySeverity(events: SignalEvent[]): Record<string, number> {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const e of events) {
    counts[e.severity] = (counts[e.severity] ?? 0) + 1;
  }
  return counts;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

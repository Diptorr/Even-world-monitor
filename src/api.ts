import { SignalEvent, SignalCategory, SIGNAL_CATEGORIES } from './types.js';

const API_BASE = '/api';

/** Domains that return event-like data from worldmonitor */
const EVENT_DOMAINS: SignalCategory[] = [
  'conflict', 'climate', 'cyber', 'displacement', 'economic',
  'infrastructure', 'military', 'natural', 'news', 'seismology',
  'unrest', 'wildfire', 'positive-events', 'aviation', 'maritime',
];

let eventIdCounter = 0;
function nextId(): string {
  return `evt-${++eventIdCounter}-${Date.now()}`;
}

/** Normalize a raw API response item into a SignalEvent */
function normalizeEvent(raw: Record<string, unknown>, category: SignalCategory): SignalEvent {
  const title = (raw.title ?? raw.headline ?? raw.name ?? raw.event ?? 'Unknown Event') as string;
  const summary = (raw.summary ?? raw.description ?? raw.body ?? raw.text ?? title) as string;
  const country = (raw.country ?? raw.location?.toString() ?? raw.region ?? 'Unknown') as string;
  const region = (raw.region ?? raw.area ?? raw.continent ?? inferRegion(country)) as string;
  const countryCode = (raw.country_code ?? raw.countryCode ?? raw.iso ?? '') as string;

  let severity: SignalEvent['severity'] = 'info';
  if (raw.severity) {
    const s = (raw.severity as string).toLowerCase();
    if (['critical', 'high', 'medium', 'low', 'info'].includes(s)) {
      severity = s as SignalEvent['severity'];
    }
  } else if (raw.magnitude && Number(raw.magnitude) > 6) {
    severity = 'critical';
  } else if (raw.magnitude && Number(raw.magnitude) > 4) {
    severity = 'high';
  }

  return {
    id: (raw.id as string) ?? nextId(),
    title: truncate(title, 120),
    summary: truncate(summary, 300),
    category,
    region,
    country,
    countryCode,
    severity,
    timestamp: (raw.timestamp ?? raw.date ?? raw.created_at ?? raw.published ?? new Date().toISOString()) as string,
    source: (raw.source ?? raw.publisher ?? raw.feed ?? 'World Monitor') as string,
    url: raw.url as string | undefined,
    lat: raw.lat != null ? Number(raw.lat) : undefined,
    lng: raw.lng != null ? Number(raw.lng) : undefined,
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function inferRegion(country: string): string {
  const map: Record<string, string> = {
    'United States': 'North America', 'Canada': 'North America', 'Mexico': 'North America',
    'Brazil': 'South America', 'Argentina': 'South America', 'Colombia': 'South America',
    'United Kingdom': 'Europe', 'France': 'Europe', 'Germany': 'Europe', 'Italy': 'Europe',
    'Spain': 'Europe', 'Ukraine': 'Europe', 'Poland': 'Europe', 'Romania': 'Europe',
    'Israel': 'Middle East', 'Iran': 'Middle East', 'Iraq': 'Middle East', 'Syria': 'Middle East',
    'Saudi Arabia': 'Middle East', 'Turkey': 'Middle East', 'Yemen': 'Middle East',
    'China': 'East Asia', 'Japan': 'East Asia', 'South Korea': 'East Asia', 'Taiwan': 'East Asia',
    'India': 'South Asia', 'Pakistan': 'South Asia', 'Bangladesh': 'South Asia',
    'Nigeria': 'Africa', 'South Africa': 'Africa', 'Egypt': 'Africa', 'Kenya': 'Africa',
    'Australia': 'Oceania', 'New Zealand': 'Oceania',
    'Indonesia': 'Southeast Asia', 'Philippines': 'Southeast Asia', 'Vietnam': 'Southeast Asia',
  };
  return map[country] ?? 'Global';
}

/** Fetch signals from a specific domain */
async function fetchDomain(category: SignalCategory): Promise<SignalEvent[]> {
  try {
    const res = await fetch(`${API_BASE}/${category}/v1/latest`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      // Try alternate endpoint pattern
      const res2 = await fetch(`${API_BASE}/${category}/v1/events`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      if (!res2.ok) return [];
      const data = await res2.json();
      return normalizeArray(data, category);
    }
    const data = await res.json();
    return normalizeArray(data, category);
  } catch {
    return [];
  }
}

function normalizeArray(data: unknown, category: SignalCategory): SignalEvent[] {
  if (Array.isArray(data)) {
    return data.slice(0, 25).map((item) => normalizeEvent(item as Record<string, unknown>, category));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    // Try common wrapper keys
    for (const key of ['events', 'items', 'data', 'results', 'signals', 'articles', 'stories', 'entries']) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as Record<string, unknown>[]).slice(0, 25).map((item) => normalizeEvent(item, category));
      }
    }
    // Single object response
    return [normalizeEvent(obj, category)];
  }
  return [];
}

/** Fetch news/signals from the RSS proxy (most reliable endpoint) */
async function fetchNews(): Promise<SignalEvent[]> {
  try {
    const res = await fetch(`${API_BASE}/news/v1/latest`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return normalizeArray(data, 'news');
  } catch {
    return [];
  }
}

/** Fetch seismology data (usually reliable) */
async function fetchSeismology(): Promise<SignalEvent[]> {
  try {
    const res = await fetch(`${API_BASE}/seismology/v1/latest`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return normalizeArray(data, 'seismology');
  } catch {
    return [];
  }
}

/** Fetch risk scores by country */
export async function fetchRiskScores(): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${API_BASE}/risk-scores`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/** Fetch all signals across all domains */
export async function fetchAllSignals(): Promise<SignalEvent[]> {
  const results = await Promise.allSettled(
    EVENT_DOMAINS.map((domain) => fetchDomain(domain))
  );

  const events: SignalEvent[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      events.push(...result.value);
    }
  }

  // Sort by timestamp descending (most recent first)
  events.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime() || 0;
    const tb = new Date(b.timestamp).getTime() || 0;
    return tb - ta;
  });

  return events;
}

/** Fetch signals for specific categories */
export async function fetchSignalsByCategory(categories: SignalCategory[]): Promise<SignalEvent[]> {
  const results = await Promise.allSettled(
    categories.map((cat) => fetchDomain(cat))
  );

  const events: SignalEvent[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      events.push(...result.value);
    }
  }

  events.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime() || 0;
    const tb = new Date(b.timestamp).getTime() || 0;
    return tb - ta;
  });

  return events;
}

/** Generate demo/fallback signals when API is unavailable */
export function generateDemoSignals(): SignalEvent[] {
  const now = new Date();
  const demos: Partial<SignalEvent>[] = [
    { title: 'Escalation in Eastern Ukraine', summary: 'Multiple reports of increased artillery exchanges along the front line near Donetsk.', category: 'conflict', region: 'Europe', country: 'Ukraine', severity: 'critical', source: 'OSINT Aggregator' },
    { title: '6.2 Magnitude Earthquake - Indonesia', summary: 'Shallow earthquake detected 80km southwest of Jakarta. Tsunami advisory issued.', category: 'seismology', region: 'Southeast Asia', country: 'Indonesia', severity: 'high', source: 'USGS' },
    { title: 'Cyberattack on European Banking Infrastructure', summary: 'Coordinated DDoS campaign targeting SWIFT gateway nodes in Frankfurt.', category: 'cyber', region: 'Europe', country: 'Germany', severity: 'high', source: 'CERT-EU' },
    { title: 'Mass Displacement in Sudan', summary: 'UNHCR reports 50,000 new internally displaced persons fleeing Darfur clashes.', category: 'displacement', region: 'Africa', country: 'Sudan', severity: 'critical', source: 'UNHCR' },
    { title: 'Oil Price Surge After Strait of Hormuz Incident', summary: 'Brent crude jumps 8% following reported maritime confrontation near Hormuz.', category: 'economic', region: 'Middle East', country: 'Iran', severity: 'high', source: 'Reuters' },
    { title: 'Power Grid Failure in South Africa', summary: 'Stage 6 load shedding implemented across Gauteng province. Eskom reports generator failures.', category: 'infrastructure', region: 'Africa', country: 'South Africa', severity: 'medium', source: 'Eskom' },
    { title: 'Chinese Military Exercises Near Taiwan Strait', summary: 'PLA Navy conducting live-fire drills within 50nm of Taiwanese territorial waters.', category: 'military', region: 'East Asia', country: 'Taiwan', severity: 'critical', source: 'INDOPACOM' },
    { title: 'Category 4 Hurricane Approaching Florida', summary: 'Hurricane Maria upgraded to Cat 4, expected landfall in 48 hours near Tampa Bay.', category: 'natural', region: 'North America', country: 'United States', severity: 'critical', source: 'NOAA' },
    { title: 'Protests Escalate in Iran', summary: 'Large-scale demonstrations reported in Tehran, Isfahan, and Shiraz over economic conditions.', category: 'unrest', region: 'Middle East', country: 'Iran', severity: 'high', source: 'OSINT' },
    { title: 'Wildfire Spreads in Northern California', summary: 'Mendocino Complex fire has burned 12,000 acres. Evacuations ordered for 3 communities.', category: 'wildfire', region: 'North America', country: 'United States', severity: 'high', source: 'CAL FIRE' },
    { title: 'Peace Agreement Signed in Colombia', summary: 'Government and ELN rebels sign historic ceasefire agreement in Bogota.', category: 'positive-events', region: 'South America', country: 'Colombia', severity: 'info', source: 'AP News' },
    { title: 'Supply Chain Disruption at Suez Canal', summary: 'Container ship grounding blocks southbound traffic. 15+ vessels queued.', category: 'supply-chain', region: 'Middle East', country: 'Egypt', severity: 'high', source: 'Lloyd\'s List' },
    { title: 'Unusual Military Aviation Activity Over Baltic', summary: 'NATO AWACS and multiple fighter jets detected in patrol patterns over Latvia and Estonia.', category: 'aviation', region: 'Europe', country: 'Latvia', severity: 'medium', source: 'ADS-B Exchange' },
    { title: 'Ship Tracking Anomaly in South China Sea', summary: 'AIS signals lost for 12 cargo vessels in contested waters near Spratly Islands.', category: 'maritime', region: 'Southeast Asia', country: 'Philippines', severity: 'medium', source: 'MarineTraffic' },
    { title: 'Market Crash: Nikkei Down 5%', summary: 'Tokyo Stock Exchange sees worst single-day drop since 2020 amid global uncertainty.', category: 'market', region: 'East Asia', country: 'Japan', severity: 'high', source: 'Bloomberg' },
    { title: 'India-Pakistan Border Tensions Rise', summary: 'Reports of troop mobilization along Line of Control in Kashmir sector.', category: 'intelligence', region: 'South Asia', country: 'India', severity: 'high', source: 'Jane\'s Defence' },
    { title: 'EU-China Trade Dispute Escalates', summary: 'Brussels announces 25% tariffs on Chinese EV imports effective next month.', category: 'trade', region: 'Europe', country: 'Germany', severity: 'medium', source: 'Financial Times' },
    { title: 'Climate Emergency in Bangladesh', summary: 'Monsoon flooding displaces 2 million. Water levels at record highs in Sylhet district.', category: 'climate', region: 'South Asia', country: 'Bangladesh', severity: 'critical', source: 'WMO' },
    { title: 'Prediction Market: 70% Chance of Fed Rate Cut', summary: 'Polymarket and Kalshi both showing strong consensus for 50bp cut at next FOMC meeting.', category: 'prediction', region: 'North America', country: 'United States', severity: 'info', source: 'Polymarket' },
    { title: 'Volcanic Activity Increases in Iceland', summary: 'Grindavik eruption enters new phase. Aviation color code raised to red for Keflavik.', category: 'seismology', region: 'Europe', country: 'Iceland', severity: 'high', source: 'IMO' },
  ];

  return demos.map((d, i) => ({
    id: `demo-${i + 1}`,
    title: d.title!,
    summary: d.summary!,
    category: d.category!,
    region: d.region!,
    country: d.country!,
    countryCode: '',
    severity: d.severity!,
    timestamp: new Date(now.getTime() - i * 300000).toISOString(), // 5 min apart
    source: d.source!,
  }));
}

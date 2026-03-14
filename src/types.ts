/** A signal event from World Monitor */
export interface SignalEvent {
  id: string;
  title: string;
  summary: string;
  category: SignalCategory;
  region: string;
  country: string;
  countryCode: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  timestamp: string;
  source: string;
  url?: string;
  lat?: number;
  lng?: number;
}

export type SignalCategory =
  | 'conflict'
  | 'climate'
  | 'cyber'
  | 'displacement'
  | 'economic'
  | 'infrastructure'
  | 'intelligence'
  | 'maritime'
  | 'market'
  | 'military'
  | 'natural'
  | 'news'
  | 'seismology'
  | 'supply-chain'
  | 'unrest'
  | 'wildfire'
  | 'positive-events'
  | 'aviation'
  | 'trade'
  | 'prediction';

export const SIGNAL_CATEGORIES: SignalCategory[] = [
  'conflict', 'climate', 'cyber', 'displacement', 'economic',
  'infrastructure', 'intelligence', 'maritime', 'market', 'military',
  'natural', 'news', 'seismology', 'supply-chain', 'unrest',
  'wildfire', 'positive-events', 'aviation', 'trade', 'prediction',
];

export const CATEGORY_LABELS: Record<SignalCategory, string> = {
  'conflict': 'Conflict',
  'climate': 'Climate',
  'cyber': 'Cyber',
  'displacement': 'Displacement',
  'economic': 'Economic',
  'infrastructure': 'Infrastructure',
  'intelligence': 'Intelligence',
  'maritime': 'Maritime',
  'market': 'Market',
  'military': 'Military',
  'natural': 'Natural Disaster',
  'news': 'News',
  'seismology': 'Seismology',
  'supply-chain': 'Supply Chain',
  'unrest': 'Civil Unrest',
  'wildfire': 'Wildfire',
  'positive-events': 'Positive',
  'aviation': 'Aviation',
  'trade': 'Trade',
  'prediction': 'Prediction',
};

export const CATEGORY_ICONS: Record<SignalCategory, string> = {
  'conflict': '\u2694',
  'climate': '\ud83c\udf21',
  'cyber': '\ud83d\udda5',
  'displacement': '\ud83d\udeb6',
  'economic': '\ud83d\udcb0',
  'infrastructure': '\ud83c\udfed',
  'intelligence': '\ud83d\udd0d',
  'maritime': '\ud83d\udea2',
  'market': '\ud83d\udcc8',
  'military': '\ud83c\udf96',
  'natural': '\ud83c\udf0a',
  'news': '\ud83d\udcf0',
  'seismology': '\ud83c\udf0b',
  'supply-chain': '\ud83d\ude9a',
  'unrest': '\u270a',
  'wildfire': '\ud83d\udd25',
  'positive-events': '\u2728',
  'aviation': '\u2708',
  'trade': '\ud83d\udce6',
  'prediction': '\ud83d\udd2e',
};

export const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff1744',
  high: '#ff6d00',
  medium: '#ffc400',
  low: '#00e676',
  info: '#448aff',
};

/** Regions and their countries for filtering */
export const REGIONS: Record<string, string[]> = {
  'Global': [],
  'North America': ['United States', 'Canada', 'Mexico'],
  'South America': ['Brazil', 'Argentina', 'Colombia', 'Chile', 'Peru', 'Venezuela', 'Ecuador', 'Bolivia', 'Paraguay', 'Uruguay'],
  'Europe': ['United Kingdom', 'France', 'Germany', 'Italy', 'Spain', 'Ukraine', 'Poland', 'Netherlands', 'Belgium', 'Sweden', 'Norway', 'Finland', 'Denmark', 'Switzerland', 'Austria', 'Romania', 'Greece', 'Portugal', 'Czech Republic', 'Hungary'],
  'Middle East': ['Israel', 'Iran', 'Iraq', 'Syria', 'Saudi Arabia', 'Turkey', 'Yemen', 'Jordan', 'Lebanon', 'UAE', 'Qatar', 'Kuwait', 'Oman', 'Bahrain'],
  'Africa': ['Nigeria', 'South Africa', 'Egypt', 'Kenya', 'Ethiopia', 'Ghana', 'Tanzania', 'DR Congo', 'Sudan', 'Somalia', 'Libya', 'Morocco', 'Algeria', 'Tunisia'],
  'East Asia': ['China', 'Japan', 'South Korea', 'North Korea', 'Taiwan', 'Mongolia'],
  'South Asia': ['India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal', 'Afghanistan'],
  'Southeast Asia': ['Indonesia', 'Philippines', 'Vietnam', 'Thailand', 'Myanmar', 'Malaysia', 'Singapore', 'Cambodia', 'Laos'],
  'Central Asia': ['Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan'],
  'Oceania': ['Australia', 'New Zealand', 'Papua New Guinea', 'Fiji'],
};

/** G2 glasses display constants */
export const G2_DISPLAY = {
  WIDTH: 576,
  HEIGHT: 136,
  MAX_TEXT_WIDTH: 488,
  MAX_LINES: 5,
  FONT_SIZE: 21,
} as const;

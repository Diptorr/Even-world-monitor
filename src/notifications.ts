/**
 * Notifications Module for Even Realities G2 Glasses
 *
 * The G2 glasses display phone notifications automatically through the Even app.
 * Instead of fighting Web Bluetooth, we use the Web Notifications API:
 * - On app launch → fire notification with top event → appears on G2
 * - On refresh → notify about new critical/high events → appears on G2
 * - User taps a card → fires notification → appears on G2
 *
 * The Even app forwards all phone notifications to the G2 display.
 * This is the most reliable path to get content on the glasses.
 */

import { SignalEvent, CATEGORY_LABELS, SEVERITY_COLORS } from './types.js';

let permissionGranted = false;
let sentIds = new Set<string>(); // Track which events we already notified

/** Request notification permission (call early, needs user gesture on mobile) */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('Notifications API not supported');
    return false;
  }

  if (Notification.permission === 'granted') {
    permissionGranted = true;
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  const result = await Notification.requestPermission();
  permissionGranted = result === 'granted';
  return permissionGranted;
}

export function isNotificationEnabled(): boolean {
  return permissionGranted || Notification.permission === 'granted';
}

/** Send a single event as a phone notification (→ forwarded to G2 by Even app) */
export function notifyEvent(event: SignalEvent): void {
  if (!isNotificationEnabled()) return;
  if (sentIds.has(event.id)) return; // Don't spam same event
  sentIds.add(event.id);

  const sev = event.severity.toUpperCase();
  const cat = CATEGORY_LABELS[event.category] ?? event.category;
  const location = event.country
    ? `${event.region} › ${event.country}`
    : event.region;

  const title = `[${sev}] ${cat}: ${event.title}`;
  const body = `${location}\n${event.summary}`;

  try {
    const n = new Notification(title, {
      body,
      tag: `wm-${event.id}`, // Replace previous notification with same tag
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      silent: false,
      requireInteraction: false,
    });

    // Auto-close after 8 seconds
    setTimeout(() => n.close(), 8000);
  } catch {
    // Fallback for environments where Notification constructor isn't allowed
    // (some mobile browsers require service worker registration)
    navigator.serviceWorker?.ready?.then((reg) => {
      reg.showNotification(title, {
        body,
        tag: `wm-${event.id}`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        silent: false,
      });
    }).catch(() => {});
  }
}

/** Fire notifications for the top N most critical events */
export function notifyTopEvents(events: SignalEvent[], count: number = 3): void {
  if (!isNotificationEnabled()) return;

  // Sort: critical first, then high, then by recency
  const prioritized = [...events].sort((a, b) => {
    const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const sa = sevOrder[a.severity] ?? 4;
    const sb = sevOrder[b.severity] ?? 4;
    if (sa !== sb) return sa - sb;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  // Send top N as notifications, staggered so they don't pile up
  const toSend = prioritized.slice(0, count);
  toSend.forEach((event, i) => {
    setTimeout(() => notifyEvent(event), i * 2000); // 2s apart
  });
}

/**
 * Check for new events since last refresh and notify about critical/high ones.
 * Returns the IDs of newly notified events.
 */
export function notifyNewEvents(
  previousEvents: SignalEvent[],
  currentEvents: SignalEvent[],
): string[] {
  if (!isNotificationEnabled()) return [];

  const prevIds = new Set(previousEvents.map((e) => e.id));
  const newEvents = currentEvents.filter((e) => !prevIds.has(e.id));

  // Only auto-notify for critical and high severity new events
  const urgent = newEvents.filter((e) => e.severity === 'critical' || e.severity === 'high');

  const notified: string[] = [];
  urgent.slice(0, 5).forEach((event, i) => {
    setTimeout(() => notifyEvent(event), i * 1500);
    notified.push(event.id);
  });

  return notified;
}

/** Clear the sent ID cache (for testing) */
export function resetNotificationCache(): void {
  sentIds.clear();
}

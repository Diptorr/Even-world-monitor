/**
 * QR Code Overlay
 *
 * On app launch, detects the local network URL and generates QR codes
 * so other devices (phone, tablet, G2 companion) can connect instantly.
 */

import QRCode from 'qrcode';

declare const __LOCAL_IP__: string;

const PORT = 5173;

export interface NetworkURL {
  label: string;
  url: string;
  qrDataUrl?: string;
}

/** Get all the URLs the app is accessible at */
export function getNetworkURLs(): NetworkURL[] {
  const urls: NetworkURL[] = [
    { label: 'Local', url: `http://localhost:${PORT}` },
  ];

  const ip = typeof __LOCAL_IP__ !== 'undefined' ? __LOCAL_IP__ : null;
  if (ip && ip !== 'localhost') {
    urls.push({ label: 'Network', url: `http://${ip}:${PORT}` });
  }

  return urls;
}

/** Generate QR code data URLs for all network addresses */
export async function generateQRCodes(urls: NetworkURL[]): Promise<NetworkURL[]> {
  const results: NetworkURL[] = [];
  for (const entry of urls) {
    try {
      const qrDataUrl = await QRCode.toDataURL(entry.url, {
        width: 200,
        margin: 2,
        color: {
          dark: '#e2e8f0',
          light: '#0a0e17',
        },
        errorCorrectionLevel: 'M',
      });
      results.push({ ...entry, qrDataUrl });
    } catch {
      results.push(entry);
    }
  }
  return results;
}

/** Render the QR overlay HTML */
export function renderQROverlay(urls: NetworkURL[]): string {
  const cards = urls.map((u) => `
    <div class="qr-card">
      ${u.qrDataUrl ? `<img class="qr-img" src="${u.qrDataUrl}" alt="QR for ${u.label}" />` : '<div class="qr-placeholder">QR</div>'}
      <div class="qr-info">
        <span class="qr-label">${u.label}</span>
        <a class="qr-url" href="${u.url}" target="_blank">${u.url}</a>
      </div>
    </div>
  `).join('');

  return `
    <div class="qr-overlay" id="qr-overlay">
      <div class="qr-modal">
        <div class="qr-header">
          <h2>Connect to Dashboard</h2>
          <p>Scan a QR code from any device on your local network</p>
          <button class="qr-close" id="qr-close">&times;</button>
        </div>
        <div class="qr-cards">${cards}</div>
        <div class="qr-footer">
          <span>Tip: Open on your phone while wearing G2 glasses for dual-screen monitoring</span>
        </div>
      </div>
    </div>
  `;
}

/** Show the QR overlay on first launch (dismissed by click or key) */
export async function showQROverlay(): Promise<void> {
  const urls = getNetworkURLs();
  const withQR = await generateQRCodes(urls);
  const html = renderQROverlay(withQR);

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  const overlay = document.getElementById('qr-overlay');
  const closeBtn = document.getElementById('qr-close');

  function dismiss() {
    overlay?.classList.add('qr-hiding');
    setTimeout(() => container.remove(), 300);
  }

  closeBtn?.addEventListener('click', dismiss);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') {
      dismiss();
      document.removeEventListener('keydown', handler);
    }
  });

  // Auto-dismiss after 15 seconds
  setTimeout(dismiss, 15000);
}

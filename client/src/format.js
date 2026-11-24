export function duration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const since = (date, now = Date.now()) => (date ? duration((now - new Date(date)) / 1000) : '—');

/** "Today", "Yesterday" or a short date, for separators between messages. */
export function dayLabel(date, now = Date.now()) {
  const d = new Date(date);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date(now)) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

export function clock(date) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const INTENT_LABEL = {
  price: 'Price',
  size: 'Size',
  availability: 'Availability',
  cod_shipping: 'COD / shipping',
  order_status: 'Order status',
  return_exchange: 'Return / exchange',
  complaint: 'Complaint',
  collab: 'Collab',
  spam: 'Likely spam',
  greeting: 'Greeting',
  follow_up: 'Follow-up',
  unclassified: 'Unclassified',
};

export const intentLabel = (intent) => INTENT_LABEL[intent ?? 'unclassified'] ?? intent;

// Each message type gets an emoji and a colour (hue) so the inbox can be scanned at a glance.
// The text label is always shown too, so colour is never the only signal.
// Message types are shown as neutral labels. Only complaints get a tone (red),
// because they are what makes a chat urgent; spam/unclassified are dimmed.
export const INTENT_META = {
  complaint: { tone: 'alert' },
  spam: { tone: 'muted' },
  unclassified: { tone: 'muted' },
};
export const intentMeta = (intent) => INTENT_META[intent ?? 'unclassified'] ?? {};

export const STATUS_LABEL = {
  NEW: 'New',
  OPEN: 'Open',
  WAITING_ON_CUSTOMER: 'Waiting on customer',
  RESOLVED: 'Resolved',
};

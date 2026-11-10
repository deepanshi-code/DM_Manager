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

export const STATUS_LABEL = {
  NEW: 'New',
  OPEN: 'Open',
  WAITING_ON_CUSTOMER: 'Waiting on customer',
  RESOLVED: 'Resolved',
};

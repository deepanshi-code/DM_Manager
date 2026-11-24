import { intentLabel, intentMeta } from '../format.js';

/** Neutral message-type label; complaints are tinted red, spam/unclassified dimmed. */
export default function IntentPill({ intent, size = 'sm' }) {
  const { tone = '' } = intentMeta(intent);
  return <span className={`intent-pill ${size} ${tone}`}>{intentLabel(intent)}</span>;
}

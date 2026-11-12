import { intentLabel, intentMeta } from '../format.js';

/** Coloured message-type pill: emoji + label. */
export default function IntentPill({ intent, size = 'sm' }) {
  const meta = intentMeta(intent);
  return (
    <span className={`intent-pill ${size} ${meta.muted ? 'muted' : ''}`} style={{ '--ih': meta.hue }}>
      <span className="intent-emoji" aria-hidden="true">{meta.emoji}</span>
      {intentLabel(intent)}
    </span>
  );
}

// Initials avatar with a stable colour per username. `ring` highlights the chat:
// "new" = gradient ring (unread), "late" = red ring (overdue).
function hue(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

export function initialsOf(name = '') {
  const letters = name.replace(/[^a-zA-Z]+/g, ' ').trim().split(/\s+/);
  const first = letters[0] ?? '';
  const two = letters.length > 1 ? first[0] + letters[1][0] : first.slice(0, 2);
  return (two || '?').toUpperCase();
}

export default function Avatar({ name = '?', size = 44, ring }) {
  return (
    <span
      className={`avatar ${ring ? `ring-${ring}` : ''}`}
      style={{ '--h': hue(name), '--size': `${size}px` }}
      aria-hidden="true"
    >
      <span className="avatar-inner">{initialsOf(name)}</span>
    </span>
  );
}

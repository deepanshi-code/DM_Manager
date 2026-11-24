// Initials avatar with a soft, stable colour per name, and an optional status dot:
// "late" (overdue, red), "unread" (blue), "online" (green, the signed-in agent).
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

export default function Avatar({ name = '?', size = 40, status }) {
  return (
    <span className="avatar" style={{ '--size': `${size}px`, '--h': hue(name) }} aria-hidden="true">
      <span className="avatar-inner">{initialsOf(name)}</span>
      {status && <span className={`avatar-dot ${status}`} />}
    </span>
  );
}

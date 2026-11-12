// Small stroke icon set (24×24, inherits text colour). Decorative unless a title is given.
const PATHS = {
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  back: <path d="M15 5l-7 7 7 7" />,
  keyboard: (<><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M7.5 14h9" /></>),
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  alert: (<><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 10v4M12 17.5h.01" /></>),
  send: (<><path d="M21 3 10 14" /><path d="M21 3 14.5 21l-4.5-7-7-4.5z" /></>),
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  inbox: (<><path d="M3 13h5l1.5 2.5h5L16 13h5" /><path d="M5.5 5h13l2.5 8v5.5A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5V13z" /></>),
  flame: <path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.6-2.6 1.5-3.5.2 1.3.8 2 1.5 2.5C11 8 11 5.5 12 3z" />,
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" /></>),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  reply: <path d="M10 8 5 12.5l5 4.5M5 12.5h9a5 5 0 0 1 5 5V19" />,
};

export default function Icon({ name, size = 20, className = '', title, strokeWidth = 1.8 }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

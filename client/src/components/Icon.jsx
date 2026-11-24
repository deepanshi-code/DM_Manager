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
  chevronRight: <path d="m9 6 6 6-6 6" />,
  inbox: (<><path d="M3 13h5l1.5 2.5h5L16 13h5" /><path d="M5.5 5h13l2.5 8v5.5A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5V13z" /></>),
  flame: <path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.6-2.6 1.5-3.5.2 1.3.8 2 1.5 2.5C11 8 11 5.5 12 3z" />,
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" /></>),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  reply: <path d="M10 8 5 12.5l5 4.5M5 12.5h9a5 5 0 0 1 5 5V19" />,
  zap: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 20a2 2 0 0 0 4 0" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>),
  copy: (<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>),
  panel: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  note: (<><path d="M5 4h14v11l-5 5H5V4Z" /><path d="M14 20v-5h5M9 9h6M9 13h3" /></>),
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />,
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

// The three views agents live in, as tabs; everything else under "More".
const TABS = [
  { key: 'NEEDS_REPLY', label: 'To reply' },
  { key: 'URGENT', label: 'Urgent', tone: 'danger' },
  { key: 'OVERDUE', label: 'Overdue', tone: 'danger' },
];
const MORE = [
  { key: 'MINE', label: 'Assigned to me' },
  { key: 'FOLLOW_UP', label: 'Follow-ups due' },
  { key: 'ALL', label: 'All chats', countKey: 'total' },
  { key: 'NEW', label: 'New' },
  { key: 'OPEN', label: 'Open' },
  { key: 'WAITING_ON_CUSTOMER', label: 'Waiting on customer' },
  { key: 'RESOLVED', label: 'Resolved' },
];

export default function ViewTabs({ filter, onFilter, counts }) {
  const inMore = MORE.some((m) => m.key === filter);
  return (
    <nav className="tabs" aria-label="Inbox views">
      {TABS.map((t) => {
        const n = counts?.[t.key];
        return (
          <button
            key={t.key}
            type="button"
            className={`tab ${filter === t.key ? 'active' : ''}`}
            onClick={() => onFilter(t.key)}
            aria-pressed={filter === t.key}
          >
            {t.label}
            {n > 0 && <span className={`tab-count ${t.tone ?? ''}`}>{n}</span>}
          </button>
        );
      })}
      <label className={`tab tab-more ${inMore ? 'active' : ''}`}>
        <span className="sr-only">More views</span>
        <select value={inMore ? filter : ''} onChange={(e) => e.target.value && onFilter(e.target.value)}>
          <option value="" disabled>More</option>
          {MORE.map((m) => {
            const n = counts?.[m.countKey ?? m.key];
            return <option key={m.key} value={m.key}>{m.label}{n != null ? ` (${n})` : ''}</option>;
          })}
        </select>
      </label>
    </nav>
  );
}

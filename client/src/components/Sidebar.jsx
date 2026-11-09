const FILTERS = [
  { key: 'NEEDS_REPLY', label: 'Needs reply' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'NEW', label: 'New' },
  { key: 'OPEN', label: 'Open' },
  { key: 'WAITING_ON_CUSTOMER', label: 'Waiting on customer' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'ALL', label: 'All conversations', countKey: 'total' },
];

export default function Sidebar({ filter, onFilter, counts }) {
  return (
    <nav className="sidebar" aria-label="Inbox filters">
      {FILTERS.map((f) => {
        const count = counts?.[f.countKey ?? f.key];
        return (
          <button
            key={f.key}
            className={`filter ${filter === f.key ? 'active' : ''} ${f.key === 'OVERDUE' && count ? 'has-overdue' : ''}`}
            onClick={() => onFilter(f.key)}
          >
            <span>{f.label}</span>
            {count != null && <span className="count">{count}</span>}
          </button>
        );
      })}
    </nav>
  );
}

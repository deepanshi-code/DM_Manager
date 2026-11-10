import { duration, since } from '../format.js';

export default function StatsBar({ stats, now }) {
  if (!stats) return <div className="stats" />;
  const { counts } = stats;
  const items = [
    { label: 'Need reply', value: counts.NEEDS_REPLY, tone: counts.NEEDS_REPLY ? 'warn' : '' },
    { label: 'Overdue', value: counts.OVERDUE, tone: counts.OVERDUE ? 'danger' : '' },
    { label: 'Urgent', value: counts.URGENT ?? 0, tone: counts.URGENT ? 'danger' : '' },
    { label: 'Oldest waiting', value: counts.oldest_unanswered_since ? since(counts.oldest_unanswered_since, now) : '—' },
    { label: 'Median reply time', value: duration(stats.medianResponseSeconds) },
    {
      label: `Replied within ${duration(stats.slaSeconds)}`,
      value: stats.repliesWithinSlaPct == null ? '—' : `${stats.repliesWithinSlaPct}%`,
    },
  ];
  return (
    <div className="stats">
      {items.map((s) => (
        <div key={s.label} className={`stat ${s.tone ?? ''}`}>
          <span className="stat-value">{s.value}</span>
          <span className="stat-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

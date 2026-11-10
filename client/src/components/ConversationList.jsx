import { intentLabel, since, STATUS_LABEL } from '../format.js';

const EMPTY = {
  NEEDS_REPLY: 'Inbox zero: every customer has a reply.',
  OVERDUE: 'Nothing overdue.',
};

export default function ConversationList({
  items, filter, search, onSearch, intent, onIntent, intents, intentCounts, selectedId, onSelect, now,
}) {
  const options = [...intents, 'unclassified'];
  return (
    <section className="list" aria-label="Conversations">
      <div className="list-tools">
        <input
          className="search"
          type="search"
          placeholder="Search name or message…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <select aria-label="Filter by message type" value={intent} onChange={(e) => onIntent(e.target.value)}>
          <option value="">All types</option>
          {options.map((i) => (
            <option key={i} value={i}>
              {intentLabel(i)}{intentCounts?.[i] ? ` (${intentCounts[i]})` : ''}
            </option>
          ))}
        </select>
      </div>
      {items.length === 0 && <p className="empty">{EMPTY[filter] ?? 'No conversations here.'}</p>}
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <button
              className={`row ${selectedId === c.id ? 'selected' : ''} ${c.is_overdue ? 'overdue' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <div className="row-top">
                <span className="username">@{c.username ?? c.ig_user_id}</span>
                <span className="time">{since(c.last_message_at, now)} ago</span>
              </div>
              <div className="preview">{c.last_message_preview}</div>
              <div className="row-tags">
                {c.priority === 'URGENT' && (
                  <span className="chip urgent">{c.customer_chasing && c.intent !== 'complaint' ? 'Chasing' : 'Urgent'}</span>
                )}
                <span className={`chip intent intent-${c.intent ?? 'unclassified'}`}>{intentLabel(c.intent)}</span>
                <span className={`chip status-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                {c.is_overdue ? (
                  <span className="chip danger">Overdue · waiting {since(c.needs_reply_since, now)}</span>
                ) : c.needs_reply_since ? (
                  <span className="chip warn">Waiting {since(c.needs_reply_since, now)}</span>
                ) : null}
                {c.assignee && <span className="chip muted">{c.assignee}</span>}
                {c.unread_count > 0 && <span className="unread" aria-label={`${c.unread_count} unread`}>{c.unread_count}</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

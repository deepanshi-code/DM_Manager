import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import IntentPill from './IntentPill.jsx';
import { intentLabel, intentMeta, since, STATUS_LABEL } from '../format.js';

const EMPTY = {
  NEEDS_REPLY: ['You’re all caught up', 'Every customer has a reply. New messages appear here automatically.'],
  OVERDUE: ['Nothing overdue', 'Every customer got a reply in time.'],
  URGENT: ['No urgent chats', 'No complaints or customers chasing a reply.'],
};

// In these views every row needs a reply, so status adds nothing.
const ACTION_VIEWS = new Set(['NEEDS_REPLY', 'OVERDUE', 'URGENT']);

function Row({ c, selected, showStatus, now, onSelect }) {
  const name = c.username ?? c.ig_user_id;
  const waiting = c.needs_reply_since ? since(c.needs_reply_since, now) : null;
  const unread = c.unread_count > 0;

  return (
    <button
      type="button"
      className={`row ${selected ? 'selected' : ''} ${unread ? 'unread' : ''}`}
      onClick={() => onSelect(c.id)}
      aria-current={selected ? 'true' : undefined}
    >
      <Avatar name={name} size={52} ring={c.is_overdue ? 'late' : unread ? 'new' : undefined} />
      <span className="row-main">
        <span className="row-line">
          <span className="row-name">{name}</span>
          <span className={`row-time ${c.is_overdue ? 'late' : ''}`} title={waiting ? 'Waiting for a reply' : 'Last message'}>
            {waiting ?? `${since(c.last_message_at, now)}`}
          </span>
        </span>
        <span className="row-preview">{c.last_message_preview}</span>
        <span className="row-tags">
          {c.is_overdue && <span className="flag late"><Icon name="clock" size={11} strokeWidth={2.4} />Overdue</span>}
          {!c.is_overdue && c.priority === 'URGENT' && c.intent === 'complaint' && <span className="flag late">Urgent</span>}
          {c.customer_chasing && <span className="flag warn"><Icon name="flame" size={11} strokeWidth={2.4} />Chasing</span>}
          <IntentPill intent={c.intent} />
          {showStatus && <span className="flag plain">{STATUS_LABEL[c.status]}</span>}
          {c.assignee && <span className="assignee" title={`Assigned to ${c.assignee}`}><Avatar name={c.assignee} size={18} /></span>}
        </span>
      </span>
      {unread && (
        <span className="row-unread">
          {c.unread_count}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </button>
  );
}

export default function ConversationList({
  items, loaded, filter, search, onSearch, intent, onIntent, intents, intentCounts, selectedId, onSelect, now,
}) {
  const options = [...intents, 'unclassified'];
  const [emptyTitle, emptyText] = search || intent
    ? ['No matches', 'Try a different name, word or message type.']
    : EMPTY[filter] ?? ['Nothing here', 'No conversations in this view.'];

  return (
    <section className="list" aria-label="Conversations">
      <div className="list-tools">
        <label className="search">
          <Icon name="search" size={16} />
          <span className="sr-only">Search by name or message</span>
          <input
            id="inbox-search"
            type="search"
            placeholder="Search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
        <label className="type-filter">
          <span className="sr-only">Filter by message type</span>
          <select value={intent} onChange={(e) => onIntent(e.target.value)}>
            <option value="">All types</option>
            {options.map((i) => (
              <option key={i} value={i}>
                {intentMeta(i).emoji} {intentLabel(i)}{intentCounts?.[i] ? ` (${intentCounts[i]})` : ''}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
      </div>

      {!loaded ? (
        <ul className="skeleton" aria-label="Loading conversations">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i}><span className="sk-avatar" /><span className="sk-lines"><span /><span /></span></li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="empty-art" aria-hidden="true">
            <Icon name={filter === 'NEEDS_REPLY' && !search && !intent ? 'check' : 'inbox'} size={30} strokeWidth={1.6} />
          </div>
          <p className="empty-title">{emptyTitle}</p>
          <p>{emptyText}</p>
        </div>
      ) : (
        <ul className="rows">
          {items.map((c) => (
            <li key={c.id}>
              <Row c={c} selected={selectedId === c.id} showStatus={!ACTION_VIEWS.has(filter)} now={now} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

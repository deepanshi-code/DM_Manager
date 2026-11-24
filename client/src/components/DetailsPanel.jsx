import { useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { clock, dayLabel, since, STATUS_LABEL } from '../format.js';

/** Quick reminder choices, computed from "now". */
function presets(now) {
  const d = new Date(now);
  const tomorrow10 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 10, 0, 0);
  return [
    { label: 'In 1 hour', at: new Date(now + 3600_000) },
    { label: 'In 4 hours', at: new Date(now + 4 * 3600_000) },
    { label: 'Tomorrow 10:00', at: tomorrow10 },
    { label: 'In 3 days', at: new Date(now + 3 * 86400_000) },
  ];
}

const toLocalInput = (date) => {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function when(date, now) {
  return `${dayLabel(date, now)} ${clock(date)}`;
}

const ACTIVITY = {
  inbound_message: (e) => (e.from_status === 'RESOLVED' ? 'Customer wrote again: reopened' : 'Customer wrote'),
  opened: (e) => `${e.actor} opened the chat`,
  reply_sent: (e) => `${e.actor} replied`,
  reply_in_instagram_app: () => 'Replied from the Instagram app',
  manual: (e) => `${e.actor} marked it ${STATUS_LABEL[e.to_status]?.toLowerCase() ?? e.to_status}`,
  reminder_set: (e) => `${e.actor} set a follow-up reminder`,
  reminder_cleared: (e) => `${e.actor} cleared the reminder`,
};

/** Right-hand panel next to a conversation: customer, follow-up, team notes, activity. */
export default function DetailsPanel({ conversation: c, now, onAddNote, onDeleteNote, onSetReminder, onClose, me }) {
  const d = c.details;
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customAt, setCustomAt] = useState(() => toLocalInput(Date.now() + 86400_000));
  const [copied, setCopied] = useState(null);
  const name = c.username ?? c.ig_user_id;
  const resolved = c.status === 'RESOLVED';
  const reminderDue = d?.reminder && new Date(d.reminder.at) <= now;

  async function submitNote(e) {
    e.preventDefault();
    if (!note.trim() || saving) return;
    setSaving(true);
    try {
      await onAddNote(note.trim());
      setNote('');
    } catch {
      // App shows the error; keep the text
    } finally {
      setSaving(false);
    }
  }

  function copy(order) {
    navigator.clipboard?.writeText(order).then(() => {
      setCopied(order);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  }

  if (!d) return null;

  return (
    <aside className="details" aria-label="Conversation details">
      <div className="details-head">
        <h2>Details</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Hide details" title="Hide details">
          <Icon name="close" size={16} />
        </button>
      </div>

      <section className="dsec customer">
        <Avatar name={name} size={44} />
        <div>
          <strong>@{name}</strong>
          <span>Customer since {dayLabel(d.firstSeen, now).toLowerCase()}</span>
        </div>
        <dl className="dstats">
          <div><dt>Messages</dt><dd>{d.messagesReceived}</dd></div>
          <div><dt>Replies</dt><dd>{d.repliesSent}</dd></div>
          <div><dt>Waiting</dt><dd className={c.is_overdue ? 'late' : ''}>{c.needs_reply_since ? since(c.needs_reply_since, now) : '—'}</dd></div>
        </dl>
        {d.orderNumbers.length > 0 && (
          <div className="orders">
            <span className="dlabel">Orders mentioned</span>
            <div className="order-chips">
              {d.orderNumbers.map((o) => (
                <button key={o} type="button" className="order-chip" onClick={() => copy(o)} title="Copy order number">
                  #{o} <Icon name={copied === o ? 'check' : 'copy'} size={12} />
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="dsec">
        <h3><Icon name="bell" size={14} /> Follow-up reminder</h3>
        {d.reminder ? (
          <div className={`reminder ${reminderDue ? 'due' : ''}`}>
            <div>
              <strong>{reminderDue ? 'Follow-up due' : when(d.reminder.at, now)}</strong>
              <span>{reminderDue ? `since ${when(d.reminder.at, now)}` : `set by ${d.reminder.setBy ?? 'agent'}`}</span>
            </div>
            <button type="button" className="link" onClick={() => onSetReminder(null).catch(() => {})}>Clear</button>
          </div>
        ) : resolved ? (
          <p className="dmuted">Reopen the chat to set a reminder.</p>
        ) : (
          <>
            <p className="dmuted">If the customer goes quiet, this chat comes back to you.</p>
            <div className="preset-grid">
              {presets(now).map((p) => (
                <button key={p.label} type="button" className="preset" onClick={() => onSetReminder(p.at.toISOString()).catch(() => {})}>
                  {p.label}
                </button>
              ))}
              <button type="button" className={`preset ${custom ? 'on' : ''}`} onClick={() => setCustom((v) => !v)}>Pick a time…</button>
            </div>
            {custom && (
              <form
                className="custom-time"
                onSubmit={(e) => {
                  e.preventDefault();
                  onSetReminder(new Date(customAt).toISOString()).then(() => setCustom(false)).catch(() => {});
                }}
              >
                <input type="datetime-local" value={customAt} onChange={(e) => setCustomAt(e.target.value)} required aria-label="Reminder time" />
                <button type="submit" className="btn btn-primary">Set</button>
              </form>
            )}
          </>
        )}
      </section>

      <section className="dsec">
        <h3><Icon name="note" size={14} /> Team notes <span className="dcount">{d.notes.length || ''}</span></h3>
        <form className="note-form" onSubmit={submitNote}>
          <textarea
            id="note-box"
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitNote(e); }}
            placeholder="Add a note for the team (the customer won't see it)"
            aria-label="New team note"
          />
          {note.trim() && <button type="submit" className="btn btn-ghost" disabled={saving}>Add note</button>}
        </form>
        {d.notes.length > 0 && (
          <ul className="notes">
            {d.notes.map((n) => (
              <li key={n.id} className="note">
                <div className="note-head">
                  <Avatar name={n.author ?? '?'} size={18} />
                  <strong>{n.author ?? 'Agent'}</strong>
                  <span>{when(n.created_at, now)}</span>
                  {(!me || n.author === me) && (
                    <button type="button" className="note-del" onClick={() => onDeleteNote(n.id).catch(() => {})} aria-label="Delete note" title="Delete note">
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
                <p>{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dsec">
        <h3><Icon name="clock" size={14} /> Activity</h3>
        <ol className="timeline">
          {d.activity.map((e, i) => (
            <li key={i}>
              <span className="tl-dot" />
              <span className="tl-text">{(ACTIVITY[e.reason] ?? ((x) => `${x.actor}: ${x.reason}`))(e)}</span>
              <time>{when(e.created_at, now)}</time>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

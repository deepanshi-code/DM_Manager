import { useEffect, useRef, useState } from 'react';
import { clock, duration, intentLabel, since, STATUS_LABEL } from '../format.js';

/** Predicted label on a customer message; the agent can correct it in place. */
function IntentTag({ message: m, intents, onCorrect }) {
  const effective = m.intent_corrected ?? m.intent ?? 'unclassified';
  const corrected = m.intent_corrected != null;
  const title = corrected
    ? `Corrected by ${m.intent_corrected_by ?? 'agent'} (model said: ${intentLabel(m.intent)})`
    : `Predicted by ${m.intent_source ?? 'classifier'}${m.intent_confidence != null ? `, confidence ${Math.round(m.intent_confidence * 100)}%` : ''}. Change it if it's wrong.`;
  return (
    <label className={`intent-tag ${corrected ? 'corrected' : ''} ${m.intent_low_confidence && !corrected ? 'unsure' : ''}`} title={title}>
      <span className="sr-only">Message type</span>
      <select value={effective} onChange={(e) => onCorrect(m.id, e.target.value).catch(() => {})}>
        {!intents.includes(effective) && <option value={effective}>{intentLabel(effective)}</option>}
        {intents.map((i) => <option key={i} value={i}>{intentLabel(i)}</option>)}
      </select>
      {corrected ? <span aria-hidden="true">✓</span> : m.intent_low_confidence ? <span aria-hidden="true">?</span> : null}
    </label>
  );
}

const ACTION_LABEL = {
  OPEN: 'Reopen',
  WAITING_ON_CUSTOMER: 'Mark waiting',
  RESOLVED: 'Resolve',
};

export default function ConversationView({
  conversation: c, agents, intents, now, onReply, onStatus, onAssign, onCorrectIntent,
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const messageCount = c?.messages.length ?? 0;

  // Effects must return nothing or a cleanup function, so use block bodies `{ }`.
  // (In recent Chromium, scrollIntoView() returns a Promise, which crashes React
  // if it is returned from an arrow-function effect.)
  useEffect(() => {
    setDraft('');
  }, [c?.id]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [c?.id, messageCount]);

  if (!c) {
    return (
      <section className="view empty-view">
        <p>Select a conversation. The list is sorted so the customer who has waited longest is on top.</p>
      </section>
    );
  }

  async function submit(e) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await onReply(draft);
      setDraft('');
    } catch {
      // error banner is shown by App; keep the draft so nothing typed is lost
    } finally {
      setSending(false);
    }
  }

  const windowLeft = c.replyWindow?.closesAt ? (new Date(c.replyWindow.closesAt) - now) / 1000 : 0;
  const windowOpen = windowLeft > 0;

  return (
    <section className="view" aria-label="Conversation">
      <header className="view-header">
        <div>
          <h2>@{c.username ?? c.ig_user_id}</h2>
          <div className="view-sub">
            {c.priority === 'URGENT' && <span className="chip urgent">Urgent</span>}
            {c.customer_chasing && <span className="chip warn">Customer is chasing</span>}
            <span className={`chip intent intent-${c.intent ?? 'unclassified'}`}>{intentLabel(c.intent)}</span>
            <span className={`chip status-${c.status}`}>{STATUS_LABEL[c.status]}</span>
            {c.is_overdue && <span className="chip danger">Overdue</span>}
            {c.needs_reply_since && <span className="chip warn">Waiting {since(c.needs_reply_since, now)}</span>}
            <span className={`window ${windowOpen ? '' : 'closed'}`}>
              {windowOpen ? `Reply window: ${duration(windowLeft)} left` : 'Reply window closed'}
            </span>
          </div>
        </div>
        <div className="view-actions">
          <select
            aria-label="Assign to"
            value={c.assignee ?? ''}
            onChange={(e) => onAssign(e.target.value || null).catch(() => {})}
          >
            <option value="">Unassigned</option>
            {agents.map((a) => <option key={a}>{a}</option>)}
          </select>
          {c.allowedTransitions.map((s) => (
            <button key={s} className="secondary" onClick={() => onStatus(s).catch(() => {})}>
              {ACTION_LABEL[s] ?? s}
            </button>
          ))}
        </div>
      </header>

      <ol className="messages">
        {c.messages.map((m) => (
          <li key={m.id} className={`bubble ${m.direction === 'INBOUND' ? 'in' : 'out'} ${m.delivery_status.toLowerCase()}`}>
            <div className="bubble-text">{m.body}</div>
            <div className="bubble-meta">
              {m.direction === 'INBOUND' && <IntentTag message={m} intents={intents} onCorrect={onCorrectIntent} />}
              {clock(m.sent_at)}
              {m.direction === 'OUTBOUND' && (
                <>
                  {m.sent_by && ` · ${m.sent_by}`}
                  {m.delivery_status === 'FAILED' && ` · failed: ${m.error}`}
                  {m.delivery_status === 'PENDING' && ' · sending…'}
                  {m.response_seconds != null && ` · replied after ${duration(m.response_seconds)}`}
                </>
              )}
            </div>
          </li>
        ))}
        <li ref={bottomRef} aria-hidden="true" />
      </ol>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
          }}
          placeholder={windowOpen ? 'Type a reply… (Ctrl+Enter to send)' : 'The 24h reply window has closed for this customer.'}
          disabled={!windowOpen || sending}
          maxLength={1000}
          rows={3}
        />
        <button type="submit" disabled={!windowOpen || sending || !draft.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}

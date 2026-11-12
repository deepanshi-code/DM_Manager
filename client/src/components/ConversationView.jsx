import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import IntentPill from './IntentPill.jsx';
import { clock, dayLabel, duration, intentLabel, intentMeta, since, STATUS_LABEL } from '../format.js';

/** Predicted label under a customer message; the agent can correct it in place. */
function IntentTag({ message: m, intents, onCorrect }) {
  const effective = m.intent_corrected ?? m.intent ?? 'unclassified';
  const corrected = m.intent_corrected != null;
  const unsure = m.intent_low_confidence && !corrected;
  const title = corrected
    ? `Corrected by ${m.intent_corrected_by ?? 'agent'} (model said: ${intentLabel(m.intent)})`
    : `Predicted by ${m.intent_source ?? 'classifier'}${m.intent_confidence != null ? `, confidence ${Math.round(m.intent_confidence * 100)}%` : ''}. Change it if it's wrong.`;
  return (
    <label
      className={`intent-tag ${corrected ? 'corrected' : ''} ${unsure ? 'unsure' : ''} ${intentMeta(effective).muted ? 'muted' : ''}`}
      style={{ '--ih': intentMeta(effective).hue }}
      title={title}
    >
      <span className="sr-only">Message type{unsure ? ' (unsure)' : ''}</span>
      {corrected ? <Icon name="check" size={12} strokeWidth={2.6} /> : <span aria-hidden="true">{intentMeta(effective).emoji}</span>}
      <select value={effective} onChange={(e) => onCorrect(m.id, e.target.value).catch(() => {})}>
        {!intents.includes(effective) && <option value={effective}>{intentLabel(effective)}</option>}
        {intents.map((i) => <option key={i} value={i}>{intentMeta(i).emoji} {intentLabel(i)}</option>)}
      </select>
      {unsure && <span className="unsure-mark" aria-hidden="true">?</span>}
    </label>
  );
}

export default function ConversationView({
  conversation: c, agents, intents, now, composerRef, drafts, autoAdvance, onAutoAdvance,
  onBack, onReply, onStatus, onAssign, onCorrectIntent,
}) {
  // `drafts` (a ref to a Map owned by App) keeps unsent text per conversation while switching chats.
  const [draft, setDraftState] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const messageCount = c?.messages.length ?? 0;
  const id = c?.id;

  const setDraft = (text) => {
    setDraftState(text);
    if (id) drafts.current.set(id, text);
  };

  // Effects must return nothing or a cleanup function, so use block bodies `{ }`.
  // (In recent Chromium, scrollIntoView() returns a Promise, which crashes React
  // if it is returned from an arrow-function effect.)
  useEffect(() => {
    setDraftState(id ? drafts.current.get(id) ?? '' : '');
  }, [id]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [id, messageCount]);
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft, composerRef]);

  async function submit(e) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    const sentFrom = c.id;
    setSending(true);
    try {
      await onReply(draft);
      drafts.current.delete(sentFrom);
      if (sentFrom === id) setDraftState('');
    } catch {
      // error banner is shown by App; keep the draft so nothing typed is lost
    } finally {
      setSending(false);
    }
  }

  const name = c.username ?? c.ig_user_id;
  const windowLeft = c.replyWindow?.closesAt ? (new Date(c.replyWindow.closesAt) - now) / 1000 : 0;
  const windowOpen = windowLeft > 0;
  const windowSoon = windowOpen && windowLeft < 2 * 3600;
  const canResolve = c.allowedTransitions.includes('RESOLVED');
  const canReopen = c.allowedTransitions.includes('OPEN');
  const canWait = c.allowedTransitions.includes('WAITING_ON_CUSTOMER');

  let lastDay = null;

  return (
    <section className="thread" aria-label={`Conversation with ${name}`}>
      <header className="thread-header">
        <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="Back to inbox">
          <Icon name="back" size={22} />
        </button>
        <Avatar name={name} size={40} ring={c.is_overdue ? 'late' : undefined} />
        <div className="thread-title">
          <h2>{name}</h2>
          <p className="thread-facts">
            {c.is_overdue && <span className="flag late"><Icon name="clock" size={11} strokeWidth={2.4} />Overdue</span>}
            {!c.is_overdue && c.priority === 'URGENT' && <span className="flag late">Urgent</span>}
            {c.customer_chasing && <span className="flag warn"><Icon name="flame" size={11} strokeWidth={2.4} />Chasing</span>}
            <IntentPill intent={c.intent} />
            <span className="fact">{STATUS_LABEL[c.status]}</span>
            {c.needs_reply_since && <span className="fact">· waiting {since(c.needs_reply_since, now)}</span>}
          </p>
        </div>
        <div className="thread-actions">
          <label className="pill-select">
            <span className="sr-only">Assigned to</span>
            <Icon name="user" size={15} />
            <select value={c.assignee ?? ''} onChange={(e) => onAssign(e.target.value || null).catch(() => {})}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          {canWait && (
            <button type="button" className="btn btn-ghost" onClick={() => onStatus('WAITING_ON_CUSTOMER').catch(() => {})}>
              Mark waiting
            </button>
          )}
          {canReopen && (
            <button type="button" className="btn btn-ghost" onClick={() => onStatus('OPEN').catch(() => {})}>
              <Icon name="undo" size={16} /> Reopen
            </button>
          )}
          {canResolve && (
            <button type="button" className="btn btn-brand" onClick={() => onStatus('RESOLVED').catch(() => {})} title="Resolve (e)">
              <Icon name="check" size={16} strokeWidth={2.2} /> Resolve
            </button>
          )}
        </div>
      </header>

      <ol className="messages">
        <li className="thread-intro" aria-hidden="true">
          <Avatar name={name} size={76} ring="new" />
          <strong>{name}</strong>
          <span>Instagram · first message {dayLabel(c.first_inbound_at ?? c.created_at, now).toLowerCase()}</span>
          <span className="intro-tags"><IntentPill intent={c.intent} size="md" /></span>
        </li>
        {c.messages.map((m) => {
          const day = dayLabel(m.sent_at, now);
          const separator = day !== lastDay ? <li className="day" key={`d-${m.id}`}>{day}</li> : null;
          lastDay = day;
          const inbound = m.direction === 'INBOUND';
          return [
            separator,
            <li key={m.id} className={`msg ${inbound ? 'in' : 'out'} ${m.delivery_status.toLowerCase()}`}>
              <div className="bubble">{m.body}</div>
              <div className="msg-meta">
                {inbound && <IntentTag message={m} intents={intents} onCorrect={onCorrectIntent} />}
                <time dateTime={m.sent_at}>{clock(m.sent_at)}</time>
                {!inbound && m.sent_by && <span>· {m.sent_by}</span>}
                {!inbound && m.delivery_status === 'PENDING' && <span>· sending…</span>}
                {!inbound && m.response_seconds != null && <span>· replied after {duration(m.response_seconds)}</span>}
              </div>
              {!inbound && m.delivery_status === 'FAILED' && (
                <div className="msg-error">
                  <Icon name="alert" size={14} /> Not delivered{m.error ? `: ${m.error}` : ''}.{' '}
                  <button type="button" className="link" onClick={() => { setDraft(m.body); composerRef.current?.focus(); }}>
                    Try again
                  </button>
                </div>
              )}
            </li>,
          ];
        })}
        <li ref={bottomRef} aria-hidden="true" />
      </ol>

      <form className="composer" onSubmit={submit}>
        <div className={`composer-box ${!windowOpen ? 'disabled' : ''}`}>
          <label htmlFor="reply-box" className="sr-only">Reply to {name}</label>
          <textarea
            id="reply-box"
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
            }}
            placeholder={windowOpen ? 'Message…' : 'The 24-hour reply window has closed for this customer.'}
            disabled={!windowOpen || sending}
            maxLength={1000}
            rows={1}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={!windowOpen || sending || !draft.trim()}
            aria-label={sending ? 'Sending' : 'Send'}
            title="Send (Ctrl+Enter)"
          >
            <Icon name="send" size={18} strokeWidth={2.2} />
          </button>
        </div>
        <div className="composer-foot">
          <span className={`window ${!windowOpen ? 'closed' : windowSoon ? 'soon' : ''}`}>
            <Icon name="clock" size={13} />
            {windowOpen ? `Reply window ${duration(windowLeft)} left` : 'Reply window closed'}
          </span>
          {draft.length > 800 && <span className="char-count">{draft.length}/1000</span>}
          <label className="toggle">
            <input type="checkbox" checked={autoAdvance} onChange={(e) => onAutoAdvance(e.target.checked)} />
            <span className="toggle-track" aria-hidden="true"><span /></span>
            Open next chat after sending
          </label>
          <span className="kbd-hint"><kbd>Ctrl</kbd> <kbd>Enter</kbd> to send</span>
        </div>
      </form>
    </section>
  );
}

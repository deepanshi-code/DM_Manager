import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import IntentPill from './IntentPill.jsx';
import { duration, intentLabel, intentMeta, since } from '../format.js';

function greeting(now) {
  const h = new Date(now).getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Shown when no chat is open: today's picture and one clear next step. */
export default function Overview({ stats, agent, now, nextUp, loading, onStart, onOpen, onFilter, onIntent }) {
  if (loading) {
    return (
      <section className="thread overview" aria-busy="true">
        <p className="muted">Loading conversation…</p>
      </section>
    );
  }
  const c = stats?.counts;
  const waiting = c?.NEEDS_REPLY ?? 0;
  const byIntent = Object.entries(stats?.needsReplyByIntent ?? {}).sort((a, b) => b[1] - a[1]);
  const maxIntent = Math.max(1, ...byIntent.map(([, n]) => n));
  const slaPct = stats?.repliesWithinSlaPct;

  const tiles = c
    ? [
        { label: 'Overdue', value: c.OVERDUE, icon: 'clock', view: 'OVERDUE', hue: 345 },
        { label: 'Urgent', value: c.URGENT ?? 0, icon: 'flame', view: 'URGENT', hue: 20 },
        { label: 'Longest wait', value: c.oldest_unanswered_since ? since(c.oldest_unanswered_since, now) : '—', icon: 'alert', hue: 265 },
        { label: 'Median reply time', value: duration(stats.medianResponseSeconds), icon: 'reply', hue: 200 },
      ]
    : [];

  return (
    <section className="thread overview" aria-label="Overview">
      <div className="overview-inner">
        <div className="hero">
          <div className="hero-text">
            <p className="hero-hello">{greeting(now)}{agent ? `, ${agent}` : ''} 👋</p>
            {waiting ? (
              <>
                <h1><span className="hero-number">{waiting}</span> customer{waiting === 1 ? ' is' : 's are'} waiting</h1>
                <p className="hero-sub">Overdue and urgent chats are at the top of your inbox.</p>
                <button type="button" className="btn btn-light btn-lg" onClick={onStart}>
                  Start replying <Icon name="send" size={16} strokeWidth={2.2} />
                </button>
              </>
            ) : (
              <>
                <h1>You’re all caught up ✨</h1>
                <p className="hero-sub">New messages will appear in your inbox automatically.</p>
              </>
            )}
          </div>
          <div
            className="ring"
            style={{ '--pct': slaPct ?? 0 }}
            role="img"
            aria-label={slaPct == null ? 'No replies yet' : `${slaPct}% of replies sent within ${duration(stats.slaSeconds)}`}
          >
            <div className="ring-inner">
              <strong>{slaPct == null ? '—' : `${slaPct}%`}</strong>
              <span>on time</span>
            </div>
          </div>
        </div>

        <div className="tiles">
          {tiles.map((t) => {
            const body = (
              <>
                <span className="tile-icon"><Icon name={t.icon} size={18} strokeWidth={2} /></span>
                <span className="tile-value">{t.value}</span>
                <span className="tile-label">{t.label}</span>
              </>
            );
            return t.view ? (
              <button key={t.label} type="button" className="tile" style={{ '--th': t.hue }} onClick={() => onFilter(t.view)}>{body}</button>
            ) : (
              <div key={t.label} className="tile" style={{ '--th': t.hue }}>{body}</div>
            );
          })}
        </div>

        <div className="panels">
          <section className="panel">
            <h2>What customers are asking</h2>
            {byIntent.length === 0 ? (
              <p className="muted small">Nothing waiting right now.</p>
            ) : (
              <ul className="bars">
                {byIntent.map(([intent, n]) => (
                  <li key={intent}>
                    <button
                      type="button"
                      className="bar-row"
                      onClick={() => onIntent(intent)}
                      aria-label={`${intentLabel(intent)}: ${n} waiting. Show these chats.`}
                    >
                      <span className="bar-label"><IntentPill intent={intent} /></span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(100 * n) / maxIntent}%`, '--ih': intentMeta(intent).hue }} />
                      </span>
                      <span className="bar-n">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Next up</h2>
            {nextUp.length === 0 ? (
              <p className="muted small">No one is waiting.</p>
            ) : (
              <ul className="next-up">
                {nextUp.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="next-row" onClick={() => onOpen(x.id)}>
                      <Avatar name={x.username ?? x.ig_user_id} size={36} ring={x.is_overdue ? 'late' : undefined} />
                      <span className="next-main">
                        <span className="next-name">{x.username ?? x.ig_user_id}</span>
                        <span className="next-preview">{x.last_message_preview}</span>
                      </span>
                      <span className={`next-wait ${x.is_overdue ? 'late' : ''}`}>{since(x.needs_reply_since, now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <p className="hint">Tip: press <kbd>j</kbd> to open the next chat · <kbd>?</kbd> for all shortcuts</p>
      </div>
    </section>
  );
}

import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { duration, intentLabel, since } from '../format.js';

function greeting(now) {
  const h = new Date(now).getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const LOW_VALUE = new Set(['spam', 'unclassified']);

/** Tiny area chart of customer messages per hour (oldest → newest). */
function Sparkline({ values }) {
  const w = 120;
  const h = 36;
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${h} ${line} ${w},${h}`} className="spark-area" />
      <polyline points={line} className="spark-line" />
    </svg>
  );
}

/** Donut showing the share of replies sent within the reply target. */
function Ring({ pct }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const filled = pct == null ? 0 : (pct / 100) * c;
  return (
    <svg className="ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={r} className="ring-track" />
      <circle cx="50" cy="50" r={r} className="ring-fill" strokeDasharray={`${filled} ${c}`} transform="rotate(-90 50 50)" />
    </svg>
  );
}

function Kpi({ icon, label, value, sub, tone, onClick, children }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`kpi ${tone ?? ''} ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <span className="kpi-top">
        <span className="kpi-icon"><Icon name={icon} size={16} /></span>
        <span className="kpi-label">{label}</span>
        {onClick && <Icon name="chevronRight" size={14} />}
      </span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-sub">{sub}</span>
      {children}
    </Tag>
  );
}

/** Shown when no chat is open: today's picture and one clear next step. */
export default function Overview({ stats, agent, now, nextUp, loading, onStart, onOpen, onFilter, onIntent, followUps = 0 }) {
  if (loading) {
    return (
      <section className="thread overview" aria-busy="true">
        <p className="muted">Loading conversation…</p>
      </section>
    );
  }
  const c = stats?.counts;
  const waiting = c?.NEEDS_REPLY ?? 0;
  const byIntent = Object.entries(stats?.needsReplyByIntent ?? {})
    .sort((a, b) => LOW_VALUE.has(a[0]) - LOW_VALUE.has(b[0]) || b[1] - a[1]);
  const maxIntent = Math.max(1, ...byIntent.map(([, n]) => n));
  const slaPct = stats?.repliesWithinSlaPct;
  const hourly = stats?.inboundByHour ?? [];
  const last12 = hourly.reduce((a, b) => a + b, 0);
  const team = stats?.team ?? [];
  const maxReplies = Math.max(1, ...team.map((t) => t.replies));
  const target = stats ? duration(stats.slaSeconds) : '';
  const today = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <section className="thread overview" aria-label="Overview">
      <div className="overview-inner">
        <header className="ov-head">
          <div>
            <p className="ov-eyebrow">{greeting(now)}{agent ? `, ${agent}` : ''} · {today}</p>
            <h1>
              {waiting
                ? <>{waiting} customer{waiting === 1 ? ' is' : 's are'} waiting for a reply</>
                : 'All customers have a reply'}
            </h1>
            <p className="ov-sub">
              {waiting
                ? 'Overdue and urgent conversations are listed first in your inbox.'
                : 'New messages will appear in the inbox automatically.'}
            </p>
          </div>
          <div className="ov-actions">
            <a className="btn btn-ghost btn-lg" href="/api/report.csv" download title="One row per conversation with reply times, for analysis in a spreadsheet">
              <Icon name="download" size={16} /> Report
            </a>
            {waiting > 0 && (
              <button type="button" className="btn btn-primary btn-lg" onClick={onStart}>
                Start replying <kbd className="kbd-on-primary">j</kbd>
              </button>
            )}
          </div>
        </header>

        {c && (
          <div className="kpis">
            <Kpi icon="inbox" label="Waiting for a reply" value={waiting} sub={`${last12} message${last12 === 1 ? '' : 's'} in the last 12 h`}>
              <Sparkline values={hourly} />
            </Kpi>
            <Kpi
              icon="clock"
              label="Overdue"
              value={c.OVERDUE}
              sub={c.oldest_unanswered_since ? `Longest wait ${since(c.oldest_unanswered_since, now)}` : 'Nobody is waiting'}
              tone={c.OVERDUE > 0 ? 'alert' : undefined}
              onClick={() => onFilter('OVERDUE')}
            />
            <Kpi
              icon="flame"
              label="Urgent"
              value={c.URGENT ?? 0}
              sub="Complaints and customers chasing"
              tone={(c.URGENT ?? 0) > 0 ? 'warn' : undefined}
              onClick={() => onFilter('URGENT')}
            />
            <Kpi icon="reply" label="Median reply time" value={duration(stats.medianResponseSeconds)} sub={`Target: under ${target}`} />
          </div>
        )}

        <div className="panels">
          <section className="panel ring-panel">
            <h2>Replies on time</h2>
            <div className="ring-wrap">
              <Ring pct={slaPct} />
              <div className="ring-label">
                <strong>{slaPct == null ? '—' : `${slaPct}%`}</strong>
                <span>within {target}</span>
              </div>
            </div>
            <p className="panel-note">
              {stats?.replies ? `${stats.replies} repl${stats.replies === 1 ? 'y' : 'ies'} measured` : 'No replies yet'}
            </p>
          </section>

          <section className="panel bars-panel">
            <div className="panel-head">
              <h2>Waiting, by message type</h2>
              <span className="panel-hint">Click to filter</span>
            </div>
            {byIntent.length === 0 ? (
              <p className="muted small">Nothing waiting right now.</p>
            ) : (
              <ul className="bars">
                {byIntent.map(([intent, n]) => (
                  <li key={intent}>
                    <button
                      type="button"
                      className={`bar-row ${LOW_VALUE.has(intent) ? 'dim' : ''} ${intent === 'complaint' ? 'alert' : ''}`}
                      onClick={() => onIntent(intent)}
                      aria-label={`${intentLabel(intent)}: ${n} waiting. Show these chats.`}
                    >
                      <span className="bar-label">{intentLabel(intent)}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(100 * n) / maxIntent}%` }} />
                      </span>
                      <span className="bar-n">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel team-panel">
            <div className="panel-head">
              <h2>Team</h2>
              <span className="panel-hint">Last 24 hours</span>
            </div>
            {team.length === 0 ? (
              <p className="muted small">No replies sent in the last 24 hours.</p>
            ) : (
              <table className="team">
                <thead>
                  <tr><th>Agent</th><th>Replies</th><th>Median</th><th>On time</th></tr>
                </thead>
                <tbody>
                  {team.map((t) => (
                    <tr key={t.agent}>
                      <td><span className="team-name"><Avatar name={t.agent} size={24} />{t.agent}</span></td>
                      <td>
                        <span className="team-bar"><span style={{ width: `${(100 * t.replies) / maxReplies}%` }} /></span>
                        <span className="num">{t.replies}</span>
                      </td>
                      <td className="num">{duration(t.medianResponseSeconds)}</td>
                      <td className={`num ${t.withinSlaPct != null && t.withinSlaPct < 50 ? 'late' : ''}`}>
                        {t.withinSlaPct == null ? '—' : `${t.withinSlaPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel next-panel">
            <div className="panel-head">
              <h2>Next up</h2>
              {followUps > 0 && (
                <button type="button" className="link small" onClick={() => onFilter('FOLLOW_UP')}>
                  {followUps} follow-up{followUps === 1 ? '' : 's'} due
                </button>
              )}
            </div>
            {nextUp.length === 0 ? (
              <p className="muted small">No one is waiting.</p>
            ) : (
              <ul className="next-up">
                {nextUp.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="next-row" onClick={() => onOpen(x.id)}>
                      <Avatar name={x.username ?? x.ig_user_id} size={32} status={x.is_overdue ? 'late' : undefined} />
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

        <p className="hint">Tip: press <kbd>j</kbd> to open the next chat, <kbd>1</kbd>–<kbd>3</kbd> for saved replies, <kbd>?</kbd> for all shortcuts</p>
      </div>
    </section>
  );
}

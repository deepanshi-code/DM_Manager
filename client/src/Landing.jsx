import { useEffect } from 'react';
import Icon from './components/Icon.jsx';
import Avatar from './components/Avatar.jsx';
import './landing.css';

const PAINS = [
  { icon: 'inbox', title: 'Newest first buries the oldest', text: 'Instagram shows the latest message on top. The customer who has waited longest sinks out of sight.' },
  { icon: 'clock', title: 'Nobody knows who is waiting', text: 'There is no reply timer and no "overdue" list. A chat that was missed stays missed.' },
  { icon: 'reply', title: 'The same questions, all day', text: 'Price, size, COD, "where is my order". Typed again and again by hand, by every teammate.' },
];

const FEATURES = [
  { icon: 'clock', title: 'Reply timer on every chat', text: 'Each conversation tracks how long the customer has waited. Past the target, it turns overdue and moves to the top.' },
  { icon: 'flame', title: 'Urgent first', text: 'Complaints and customers chasing a reply ("hello??") are flagged urgent, so they are answered before routine questions.' },
  { icon: 'chart', title: 'Sorted by message type', text: 'Every DM is labelled: price, size, COD, order status, return, complaint, spam. Filter the inbox by what customers ask.' },
  { icon: 'zap', title: 'Saved replies, one key', text: 'The right answers are suggested for each chat. Press 1–3, fill in the [price], send. The agent always sees and edits the text.' },
  { icon: 'user', title: 'Built for a team', text: 'Assign chats, see who replied and how fast. Replies typed in the Instagram app on a phone count too.' },
  { icon: 'bell', title: 'Alerts when chats go overdue', text: 'Get notified when customers start waiting too long, even when the dashboard is in a background tab.' },
];

const STEPS = [
  { n: 1, title: 'Connect Instagram', text: 'Link the shop’s professional account through Meta’s official messaging API. New DMs arrive in seconds.' },
  { n: 2, title: 'Every DM is sorted', text: 'Each chat gets a reply timer, a message type and a priority. The inbox puts the most urgent customer first.' },
  { n: 3, title: 'Reply and measure', text: 'Answer with saved replies and keyboard shortcuts. The overview shows reply times, on-time rate and who is waiting.' },
];

const METRICS = [
  { label: 'Median reply time', text: 'How long a typical customer waits for an answer.' },
  { label: 'Replies on time', text: 'Share of replies sent within the shop’s target, e.g. 1 hour.' },
  { label: 'Never answered', text: 'Customers still waiting, and the longest wait right now.' },
  { label: 'Saved-reply use', text: 'How often templates are used and edited, and whether they speed replies up.' },
];

/** Static product preview built from the dashboard's own look (no screenshot to go stale). */
function Preview() {
  const rows = [
    { name: 'meena_k', text: 'Received a torn kurta, very disappointed', time: '1h 8m', late: true, tags: [['Urgent', 'late'], ['Complaint', 'alert']] },
    { name: 'kabir37', text: 'hello?? is size M available', time: '42m', late: true, tags: [['Chasing', 'plain'], ['Size', '']], unread: 2 },
    { name: 'riya.styles', text: 'COD available for Pune?', time: '3m', tags: [['COD / shipping', '']], unread: 1 },
    { name: 'arjun_668', text: 'price of the denim jacket?', time: '1m', tags: [['Price', '']], unread: 1 },
  ];
  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-pv-rail">
        <span className="lp-pv-logo"><Icon name="send" size={13} strokeWidth={2.2} /></span>
        <span className="lp-pv-ico on"><Icon name="inbox" size={15} /></span>
        <span className="lp-pv-ico"><Icon name="chart" size={15} /></span>
        <span className="lp-pv-ico"><Icon name="zap" size={15} /></span>
      </div>
      <div className="lp-pv-list">
        <div className="lp-pv-head">
          <strong>Inbox</strong>
          <span><b>26</b> waiting · <em>8 overdue</em></span>
        </div>
        {rows.map((r, i) => (
          <div key={r.name} className={`lp-pv-row ${i === 0 ? 'sel' : ''}`}>
            <Avatar name={r.name} size={30} status={r.late ? 'late' : r.unread ? 'unread' : undefined} />
            <div className="lp-pv-main">
              <div className="lp-pv-line"><b>{r.name}</b><span className={r.late ? 'late' : ''}>{r.late && <Icon name="clock" size={10} strokeWidth={2.6} />}{r.time}</span></div>
              <div className="lp-pv-text">{r.text}</div>
              <div className="lp-pv-tags">{r.tags.map(([t, k]) => <span key={t} className={`lp-pv-tag ${k}`}>{t}</span>)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="lp-pv-chat">
        <div className="lp-pv-chathead">
          <Avatar name="meena_k" size={26} status="late" />
          <div><b>meena_k</b><span><i className="lp-dot" /> Overdue · waiting 1h 8m</span></div>
          <span className="lp-pv-resolve"><Icon name="check" size={11} strokeWidth={2.6} /> Resolve</span>
        </div>
        <div className="lp-pv-msgs">
          <div className="lp-pv-bubble in">Received a torn kurta, very disappointed 😞</div>
          <div className="lp-pv-bubble out">Hi @meena_k, I’m really sorry about this. Please share your order number and a photo, and I’ll sort it out today.</div>
        </div>
        <div className="lp-pv-chips">
          <Icon name="zap" size={11} />
          <span className="lp-pv-chip on"><kbd>1</kbd>Apology + fix</span>
          <span className="lp-pv-chip"><kbd>2</kbd>Thanks</span>
        </div>
        <div className="lp-pv-input">Message…<span><Icon name="send" size={11} strokeWidth={2.4} /></span></div>
      </div>
    </div>
  );
}

export default function Landing() {
  useEffect(() => {
    document.title = 'DM Manager: no Instagram customer left waiting';
  }, []);

  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="lp-brand" href="/">
          <span className="lp-logo"><Icon name="send" size={15} strokeWidth={2.2} /></span>
          DM Manager
        </a>
        <nav className="lp-links" aria-label="Page sections">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#measure">What it measures</a>
        </nav>
        <a className="lp-btn lp-btn-dark" href="/app">Open dashboard <Icon name="chevronRight" size={15} /></a>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text">
            <span className="lp-eyebrow"><Icon name="inbox" size={13} /> Team inbox for Instagram DMs</span>
            <h1>No customer left waiting.</h1>
            <p className="lp-lead">
              For shops that get hundreds of Instagram DMs a day. DM Manager puts the customer who has waited longest at the top,
              flags complaints and follow-ups, and makes the common answers one key away.
            </p>
            <div className="lp-cta">
              <a className="lp-btn lp-btn-primary" href="/app">Open the dashboard <Icon name="chevronRight" size={16} /></a>
              <a className="lp-btn lp-btn-ghost" href="#how">See how it works</a>
            </div>
            <ul className="lp-checks">
              <li><Icon name="check" size={14} strokeWidth={2.6} /> Official Meta messaging API</li>
              <li><Icon name="check" size={14} strokeWidth={2.6} /> Every reply approved by a person</li>
              <li><Icon name="check" size={14} strokeWidth={2.6} /> Works with replies sent from the phone</li>
            </ul>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-glow" />
            <Preview />
          </div>
        </section>

        <section className="lp-section lp-problem">
          <div className="lp-section-head">
            <span className="lp-kicker">The problem</span>
            <h2>At 500 DMs a day, some customers simply get forgotten.</h2>
            <p>Not because anyone ignores them, but because the inbox isn’t built for a busy shop.</p>
          </div>
          <div className="lp-grid-3">
            {PAINS.map((p) => (
              <div key={p.title} className="lp-card lp-pain">
                <span className="lp-icon lp-icon-red"><Icon name={p.icon} size={18} /></span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section" id="features">
          <div className="lp-section-head">
            <span className="lp-kicker">Features</span>
            <h2>Everything a small team needs to answer every DM.</h2>
          </div>
          <div className="lp-grid-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-card">
                <span className="lp-icon"><Icon name={f.icon} size={18} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-section-head">
            <span className="lp-kicker">How it works</span>
            <h2>From DM to answered in three steps.</h2>
          </div>
          <ol className="lp-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="lp-step">
                <span className="lp-step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-section lp-measure" id="measure">
          <div className="lp-measure-inner">
            <div className="lp-section-head lp-left">
              <span className="lp-kicker">What it measures</span>
              <h2>Know whether customers are actually being answered.</h2>
              <p>The overview tracks the numbers that matter for a busy inbox, per team and per agent, so improvement can be measured, not guessed.</p>
            </div>
            <div className="lp-metrics">
              {METRICS.map((m) => (
                <div key={m.label} className="lp-metric">
                  <strong>{m.label}</strong>
                  <span>{m.text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-final">
          <h2>Ready to clear the inbox?</h2>
          <p>Open the dashboard to try it with demo messages.</p>
          <a className="lp-btn lp-btn-primary lp-btn-lg" href="/app">Open the dashboard <Icon name="chevronRight" size={17} /></a>
        </section>
      </main>

      <footer className="lp-footer">
        <span className="lp-brand small"><span className="lp-logo"><Icon name="send" size={12} strokeWidth={2.2} /></span> DM Manager</span>
        <span>A capstone project. Demo data is synthetic; no real customer messages are shown.</span>
      </footer>
    </div>
  );
}

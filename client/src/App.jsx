import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import ViewTabs from './components/ViewTabs.jsx';
import ConversationList from './components/ConversationList.jsx';
import ConversationView from './components/ConversationView.jsx';
import Overview from './components/Overview.jsx';
import Toast from './components/Toast.jsx';
import ShortcutsHelp from './components/ShortcutsHelp.jsx';
import Icon from './components/Icon.jsx';
import Avatar from './components/Avatar.jsx';
import { since } from './format.js';

// Refresh by polling every few seconds: simple and good enough for a small team.
// Server-Sent Events or WebSockets are a later improvement.
const POLL_MS = 3000;

// Per-browser preference; storage can be unavailable (private mode), so never crash on it.
function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const isTyping = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export default function App() {
  const [meta, setMeta] = useState(null);
  const [agent, setAgent] = useState(() => readPref('dm.agent', ''));
  const [filter, setFilter] = useState('NEEDS_REPLY'); // default view = what needs action
  const [search, setSearch] = useState('');
  const [intent, setIntent] = useState('');
  const [list, setList] = useState([]);
  const [loaded, setLoaded] = useState(false); // avoid a false "all caught up" before the first fetch
  const [stats, setStats] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [autoAdvance, setAutoAdvance] = useState(() => readPref('dm.autoAdvance', true));
  const [toast, setToast] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const requestSeq = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;
  const composerRef = useRef(null);
  const drafts = useRef(new Map());

  useEffect(() => {
    api.meta().then((m) => {
      setMeta(m);
      setAgent((current) => (m.agents.includes(current) ? current : m.agents[0] ?? ''));
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => writePref('dm.agent', agent), [agent]);
  useEffect(() => writePref('dm.autoAdvance', autoAdvance), [autoAdvance]);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const [l, s, d] = await Promise.all([
        api.list({ filter, q: search, intent }),
        api.stats(),
        selectedId ? api.get(selectedId) : Promise.resolve(null),
      ]);
      if (seq !== requestSeq.current) return; // a newer request started (filter changed): drop this one
      setList(l);
      setStats(s);
      setDetail(d);
      setNow(Date.now());
      setLoaded(true);
      setError('');
    } catch (e) {
      if (seq === requestSeq.current) setError(`${e.message}. Is the server running?`);
    }
  }, [filter, search, intent, selectedId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Changing the view shows a loading state instead of the previous view's rows.
  useEffect(() => {
    setLoaded(false);
  }, [filter, intent]);

  // Tab title shows the work waiting, so it's visible from another browser tab.
  useEffect(() => {
    const n = stats?.counts?.NEEDS_REPLY;
    document.title = n ? `(${n}) DM Manager` : 'DM Manager';
  }, [stats]);

  const open = useCallback(async (id) => {
    setSelectedId(id);
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      await api.read(id, agent);
      setDetail(await api.get(id));
    } catch (e) {
      setError(e.message);
    }
  }, [agent]);

  /** The conversation to open after finishing `id`: the next one down, else the one above. */
  function nextAfter(id) {
    const items = listRef.current;
    const i = items.findIndex((c) => c.id === id);
    if (i === -1) return items[0]?.id ?? null;
    return items[i + 1]?.id ?? items[i - 1]?.id ?? null;
  }

  function move(step) {
    const items = listRef.current;
    if (!items.length) return;
    const i = items.findIndex((c) => c.id === selectedId);
    const target = i === -1 ? items[0] : items[Math.min(items.length - 1, Math.max(0, i + step))];
    if (target && target.id !== selectedId) open(target.id);
  }

  function finished(id, message, undo) {
    setToast({ id: Date.now(), message, undo });
    if (!autoAdvance) return;
    const next = nextAfter(id);
    if (next) open(next);
    else {
      open(null);
      setToast({ id: Date.now(), message: `${message}. You're all caught up!`, undo });
    }
  }

  // Wrap mutations so every action refreshes the views and shows errors.
  const run = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      refresh();
    }
  };

  const who = detail ? (detail.username ?? detail.ig_user_id) : 'customer';

  const handlers = {
    reply: (text) => {
      const id = selectedId;
      const name = who;
      return run(() => api.reply(id, text, agent)).then(() => finished(id, `Reply sent to ${name}`));
    },
    status: (status) => {
      const id = selectedId;
      const name = who;
      const previous = detail?.status;
      return run(() => api.setStatus(id, status, agent)).then(() => {
        if (status === 'RESOLVED') {
          finished(id, `Resolved ${name}`, previous && previous !== 'RESOLVED'
            ? () => run(() => api.setStatus(id, 'OPEN', agent)).then(() => open(id))
            : undefined);
        }
      });
    },
    assign: (assignee) => run(() => api.assign(selectedId, assignee)),
    correctIntent: (messageId, value) => run(() => api.correctIntent(messageId, value, agent)),
  };

  // Keyboard shortcuts for agents handling hundreds of chats a day.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (helpOpen) setHelpOpen(false);
        else if (isTyping(document.activeElement)) document.activeElement.blur();
        else if (selectedId) open(null);
        return;
      }
      if (isTyping(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key;
      if (key === 'j' || key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (key === 'k' || key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (key === 'r' && detail) { e.preventDefault(); composerRef.current?.focus(); }
      else if (key === 'e' && detail?.allowedTransitions.includes('RESOLVED')) { e.preventDefault(); handlers.status('RESOLVED').catch(() => {}); }
      else if (key === '/') { e.preventDefault(); document.getElementById('inbox-search')?.focus(); }
      else if (key === '?') { e.preventDefault(); setHelpOpen((v) => !v); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const counts = stats?.counts;
  const showThread = detail && detail.id === selectedId;

  return (
    <div className={`app ${selectedId ? 'show-thread' : 'show-inbox'}`}>
      <aside className="inbox">
        <header className="inbox-header">
          <div className="inbox-top">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true"><Icon name="send" size={16} strokeWidth={2} /></span>
              <h1>Inbox</h1>
            </div>
            <div className="inbox-top-actions">
              <button type="button" className="icon-btn" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
                <Icon name="keyboard" size={20} />
              </button>
              <label className="agent" title="Signed in as">
                <Avatar name={agent || '?'} size={30} />
                <span className="sr-only">Signed in as</span>
                <select value={agent} onChange={(e) => setAgent(e.target.value)}>
                  {meta?.agents.map((a) => <option key={a}>{a}</option>)}
                </select>
                <Icon name="chevronDown" size={14} />
              </label>
            </div>
          </div>
          <p className="summary" aria-live="polite">
            {counts
              ? counts.NEEDS_REPLY
                ? <>
                    <strong>{counts.NEEDS_REPLY}</strong> waiting
                    {counts.OVERDUE > 0 && <> · <span className="late">{counts.OVERDUE} overdue</span></>}
                    {counts.oldest_unanswered_since && <> · longest {since(counts.oldest_unanswered_since, now)}</>}
                  </>
                : 'Everyone has a reply'
              : ' '}
          </p>
          <ViewTabs filter={filter} onFilter={setFilter} counts={counts} />
        </header>
        <ConversationList
          items={list}
          loaded={loaded}
          filter={filter}
          search={search}
          onSearch={setSearch}
          intent={intent}
          onIntent={setIntent}
          intents={meta?.intents ?? []}
          intentCounts={filter === 'NEEDS_REPLY' ? stats?.needsReplyByIntent : null}
          selectedId={selectedId}
          onSelect={open}
          now={now}
        />
      </aside>

      <main className="main">
        {error && (
          <div className="error-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
            <button type="button" className="link" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        {showThread ? (
          <ConversationView
            conversation={detail}
            agents={meta?.agents ?? []}
            intents={meta?.intents ?? []}
            now={now}
            composerRef={composerRef}
            drafts={drafts}
            autoAdvance={autoAdvance}
            onAutoAdvance={setAutoAdvance}
            onBack={() => open(null)}
            onCorrectIntent={handlers.correctIntent}
            onReply={handlers.reply}
            onStatus={handlers.status}
            onAssign={handlers.assign}
          />
        ) : (
          <Overview
            stats={stats}
            agent={agent}
            now={now}
            loading={Boolean(selectedId)}
            nextUp={list.filter((x) => x.needs_reply_since).slice(0, 3)}
            onStart={() => move(1)}
            onOpen={open}
            onFilter={setFilter}
            onIntent={(value) => {
              setFilter('NEEDS_REPLY');
              setIntent(value);
            }}
          />
        )}
      </main>
      <Toast toast={toast} onClose={() => setToast(null)} />
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

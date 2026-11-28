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
import Login from './components/Login.jsx';
import SavedReplies from './components/SavedReplies.jsx';
import Rail from './components/Rail.jsx';
import DetailsPanel from './components/DetailsPanel.jsx';
import BulkBar from './components/BulkBar.jsx';
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

// Only text entry swallows shortcuts; a ticked checkbox or a changed dropdown must not.
const TEXT_INPUTS = new Set(['text', 'search', 'password', 'email', 'number', 'tel', 'url', 'datetime-local', 'date', 'time']);
const isTyping = (el) =>
  el && ((el.tagName === 'INPUT' && TEXT_INPUTS.has((el.type || 'text').toLowerCase()))
    || el.tagName === 'TEXTAREA' || el.isContentEditable);

export default function App() {
  // null = still checking; { required, agent } once the server has answered.
  const [session, setSession] = useState(null);
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
  const [savedOpen, setSavedOpen] = useState(false);
  const [alertsOn, setAlertsOn] = useState(() => readPref('dm.alerts', false));
  const [detailsOpen, setDetailsOpen] = useState(() => readPref('dm.details', typeof window !== 'undefined' && window.innerWidth >= 1280));
  const [checked, setChecked] = useState(() => new Set()); // conversations selected for a bulk action
  const [bootError, setBootError] = useState(''); // the server couldn't be reached on first load
  const selectedIdRef = useRef(null); // the chat on screen right now (for async callbacks)
  selectedIdRef.current = selectedId;
  const openSeq = useRef(0);
  const lastCounts = useRef(null); // previous overdue/urgent counts, to alert only on increases

  const requestSeq = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;
  const composerRef = useRef(null);
  const drafts = useRef(new Map());

  // Signed in, or the server runs without login (AUTH=off demo mode).
  const ready = Boolean(session && (!session.required || session.agent));

  // Ask the server whether login is required. If it can't be reached (still starting, waking up
  // from sleep, network blip) keep retrying and say so; never guess "no login needed".
  useEffect(() => {
    let cancelled = false;
    let timer;
    const check = () => api.me()
      .then((s) => { if (!cancelled) { setBootError(''); setSession(s); } })
      .catch((e) => {
        if (cancelled) return;
        setBootError(e.message);
        timer = setTimeout(check, 3000);
      });
    check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Forget everything that belonged to the previous agent (sign-out, expired session).
  const resetUserState = useCallback(() => {
    drafts.current.clear();
    lastCounts.current = null;
    setChecked(new Set());
    setSelectedId(null);
    setDetail(null);
    setList([]);
    setStats(null);
    setLoaded(false);
    setError('');
    setToast(null);
  }, []);

  // A 401 only comes from a server with login on: show the login screen.
  const signedOut = useCallback(() => {
    resetUserState();
    setSession({ required: true, agent: null });
  }, [resetUserState]);
  const isAuthError = (e) => e?.status === 401;

  useEffect(() => {
    if (!ready) return;
    api.meta().then((m) => {
      setMeta(m);
      const me = m.auth?.agent;
      setAgent((current) => me ?? (m.agents.includes(current) ? current : m.agents[0] ?? ''));
    }).catch((e) => (isAuthError(e) ? signedOut() : setError(e.message)));
  }, [ready, signedOut]);

  useEffect(() => writePref('dm.agent', agent), [agent]);
  useEffect(() => writePref('dm.autoAdvance', autoAdvance), [autoAdvance]);
  useEffect(() => writePref('dm.alerts', alertsOn), [alertsOn]);
  useEffect(() => writePref('dm.details', detailsOpen), [detailsOpen]);
  // Changing view clears the selection, so a bulk action never hits chats you can't see.
  useEffect(() => setChecked(new Set()), [filter, intent, search]);

  // Overdue alerts: when more chats become overdue or urgent, tell the agent. A desktop
  // notification if this tab is in the background (and allowed), otherwise a toast.
  useEffect(() => {
    const c = stats?.counts;
    if (!c) return;
    const prev = lastCounts.current;
    lastCounts.current = { overdue: c.OVERDUE, urgent: c.URGENT ?? 0, followUp: c.FOLLOW_UP ?? 0 };
    if (!alertsOn || !prev) return; // never alert for what was already there when the page opened
    const moreOverdue = c.OVERDUE - prev.overdue;
    const moreUrgent = (c.URGENT ?? 0) - prev.urgent;
    const parts = [];
    if (moreOverdue > 0) parts.push(`${moreOverdue} chat${moreOverdue === 1 ? '' : 's'} just went overdue`);
    if (moreUrgent > 0) parts.push(`${moreUrgent} new urgent chat${moreUrgent === 1 ? '' : 's'}`);
    const moreFollowUps = (c.FOLLOW_UP ?? 0) - (prev.followUp ?? 0);
    if (moreFollowUps > 0) parts.push(`${moreFollowUps} follow-up${moreFollowUps === 1 ? ' is' : 's are'} due`);
    if (!parts.length) return;
    const message = parts.join(' · ');
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification('DM Manager', { body: message, tag: 'dm-overdue' });
      n.onclick = () => { window.focus(); setFilter(moreOverdue > 0 ? 'OVERDUE' : 'URGENT'); n.close(); };
    } else {
      setToast({ id: Date.now(), message });
    }
  }, [stats, alertsOn]);

  async function toggleAlerts() {
    if (alertsOn) return setAlertsOn(false);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => {});
    }
    setAlertsOn(true);
    const desktop = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    setToast({ id: Date.now(), message: desktop ? 'Alerts on: you will be notified about overdue and urgent chats' : 'Alerts on (in this tab only: desktop notifications are blocked)' });
  }

  const refresh = useCallback(async () => {
    if (!ready) return;
    const seq = ++requestSeq.current;
    try {
      const [l, s, d] = await Promise.all([
        api.list({ filter, q: search, intent, agent }),
        api.stats(agent),
        selectedId ? api.get(selectedId, agent) : Promise.resolve(null),
      ]);
      if (seq !== requestSeq.current) return; // a newer request started (filter changed): drop this one
      setList(l);
      // A chat that left this view (answered by a teammate) can't stay selected for a bulk action.
      setChecked((prev) => {
        if (prev.size === 0) return prev;
        const visible = new Set(l.map((c) => c.id));
        const kept = [...prev].filter((cid) => visible.has(cid));
        return kept.length === prev.size ? prev : new Set(kept);
      });
      setStats(s);
      setDetail(d);
      setNow(Date.now());
      setLoaded(true);
      setError('');
    } catch (e) {
      if (isAuthError(e)) signedOut();
      else if (seq === requestSeq.current) setError(`${e.message}. Is the server running?`);
    }
  }, [ready, filter, search, intent, selectedId, signedOut, agent]);

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
    // Shareable link to the open chat: /app?c=<id> (replaceState, so Back still leaves the app).
    try {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set('c', String(id));
      else url.searchParams.delete('c');
      window.history.replaceState(null, '', url);
    } catch {
      /* ignore */
    }
    const seq = ++openSeq.current;
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      await api.read(id, agent);
      const d = await api.get(id, agent);
      if (seq === openSeq.current) setDetail(d); // the agent may have moved on to another chat
    } catch (e) {
      if (seq !== openSeq.current) return;
      if (isAuthError(e)) signedOut();
      else setError(e.message);
    }
  }, [agent, signedOut]);

  // Opening a shared link (/app?c=<id>): open that chat once the app is ready.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!ready || !meta || deepLinked.current) return;
    deepLinked.current = true;
    const id = Number(new URLSearchParams(window.location.search).get('c'));
    if (Number.isInteger(id) && id > 0) open(id);
  }, [ready, meta, open]);

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
    // If the agent already opened another chat while this one was sending, stay there.
    if (!autoAdvance || selectedIdRef.current !== id) return;
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
      if (isAuthError(e)) signedOut();
      else setError(e.message);
      throw e;
    } finally {
      refresh();
    }
  };

  const who = detail ? (detail.username ?? detail.ig_user_id) : 'customer';

  const handlers = {
    reply: (text, savedReplyId) => {
      const id = selectedId;
      const name = who;
      return run(() => api.reply(id, text, agent, savedReplyId ?? undefined)).then(() => finished(id, `Reply sent to ${name}`));
    },
    status: (status) => {
      const id = selectedId;
      const name = who;
      const previous = detail?.status;
      return run(() => api.setStatus(id, status, agent)).then(() => {
        if (status === 'RESOLVED') {
          finished(id, `Resolved ${name}`, previous && previous !== 'RESOLVED'
            ? () => run(() => api.setStatus(id, 'OPEN', agent)).then(() => open(id)).catch(() => {})
            : undefined);
        }
      });
    },
    assign: (assignee) => run(() => api.assign(selectedId, assignee)),
    correctIntent: (messageId, value) => run(() => api.correctIntent(messageId, value, agent)),
    addNote: (body) => run(() => api.addNote(selectedId, body, agent)),
    deleteNote: (noteId) => run(() => api.deleteNote(noteId, agent)),
    setReminder: (at) => {
      const name = who;
      return run(() => api.setReminder(selectedId, at, agent)).then(() => {
        setToast({ id: Date.now(), message: at ? `Reminder set: follow up with ${name} ${new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Reminder cleared' });
      });
    },
    assignToMe: () => {
      if (!selectedId || !agent) return Promise.resolve();
      return run(() => api.assign(selectedId, agent)).then(() => setToast({ id: Date.now(), message: `Assigned to you` }));
    },
    bulk: (action, assignee) => {
      const ids = [...checked];
      return run(() => api.bulk(ids, action, agent, assignee)).then((r) => {
        setChecked(new Set());
        const verb = action === 'assign' ? (assignee ? `Assigned to ${assignee}` : 'Unassigned') : action === 'spam' ? 'Marked as spam' : 'Resolved';
        setToast({ id: Date.now(), message: `${verb}: ${r.done} chat${r.done === 1 ? '' : 's'}${r.failed ? ` (${r.failed} failed)` : ''}` });
        if (ids.includes(selectedId) && action !== 'assign') open(null);
      });
    },
  };

  function toggleCheck(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Keyboard shortcuts for agents handling hundreds of chats a day.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (helpOpen) setHelpOpen(false);
        else if (savedOpen) setSavedOpen(false);
        else if (document.querySelector('[role="dialog"]')) return; // that dialog closes itself
        else if (isTyping(document.activeElement)) document.activeElement.blur();
        else if (checked.size) setChecked(new Set());
        else if (selectedId) open(null);
        return;
      }
      if (isTyping(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?' && !savedOpen) { e.preventDefault(); setHelpOpen((v) => !v); return; }
      if (savedOpen || document.querySelector('[role="dialog"]')) return; // a dialog has the keyboard
      const key = e.key;
      if (key === 'j' || key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (key === 'k' || key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (key === 'r' && detail) { e.preventDefault(); composerRef.current?.focus(); }
      else if (key === 'a' && detail) { e.preventDefault(); handlers.assignToMe().catch(() => {}); }
      else if (key === 'n' && detail) {
        e.preventDefault();
        setDetailsOpen(true);
        requestAnimationFrame(() => document.getElementById('note-box')?.focus());
      }
      else if (key === 'x' && selectedId) { e.preventDefault(); toggleCheck(selectedId); }
      else if (key === 'e' && detail?.allowedTransitions.includes('RESOLVED')) { e.preventDefault(); handlers.status('RESOLVED').catch(() => {}); }
      else if (key === '/') { e.preventDefault(); document.getElementById('inbox-search')?.focus(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const counts = stats?.counts;
  const showThread = detail && detail.id === selectedId;

  async function signOut() {
    await api.logout().catch(() => {});
    resetUserState();
    setSession({ required: true, agent: null });
  }

  if (!session) {
    // Checking the session. Blank for the first moment (no flash), a clear message if it takes retries.
    return bootError ? (
      <main className="boot">
        <div className="boot-card" role="status">
          <span className="spinner" aria-hidden="true" />
          <strong>Connecting to the server…</strong>
          <span>It may be starting up or waking from sleep. Retrying every few seconds.</span>
          <small>{bootError}</small>
        </div>
      </main>
    ) : null;
  }
  if (!ready) return <Login onSignedIn={(name) => setSession({ required: true, agent: name })} />;

  return (
    <div className={`app ${selectedId ? 'show-thread' : 'show-inbox'}`}>
      <Rail
        view={selectedId ? 'inbox' : 'overview'}
        counts={counts}
        agent={agent}
        agents={meta?.agents ?? []}
        loginRequired={session.required}
        alertsOn={alertsOn}
        onInbox={() => (selectedId ? document.getElementById('inbox-search')?.focus() : move(1))}
        onOverview={() => open(null)}
        onSaved={() => setSavedOpen(true)}
        onAlerts={toggleAlerts}
        onHelp={() => setHelpOpen(true)}
        onAgent={setAgent}
        onSignOut={signOut}
      />
      <aside className="inbox">
        <header className="inbox-header">
          <div className="inbox-top">
            <div className="brand">
              <span className="brand-mark mobile-only" aria-hidden="true"><Icon name="send" size={14} strokeWidth={2} /></span>
              <h1>Inbox</h1>
            </div>
            {/* On phones there is no rail, so its actions live here. */}
            <div className="inbox-top-actions mobile-only">
              <button
                type="button"
                className={`icon-btn ${alertsOn ? 'on' : ''}`}
                onClick={toggleAlerts}
                aria-pressed={alertsOn}
                aria-label="Overdue alerts"
                title={alertsOn ? 'Overdue alerts are on' : 'Turn on overdue alerts'}
              >
                <Icon name="bell" size={18} />
              </button>
              <button type="button" className="icon-btn" onClick={() => setSavedOpen(true)} aria-label="Saved replies" title="Saved replies">
                <Icon name="zap" size={18} />
              </button>
              <button type="button" className="icon-btn" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
                <Icon name="keyboard" size={20} />
              </button>
              {session.required ? (
                <>
                  <span className="agent" title={`Signed in as ${agent}`}>
                    <Avatar name={agent || '?'} size={26} />
                    <span className="agent-name">{agent}</span>
                  </span>
                  <button type="button" className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
                    <Icon name="logout" size={18} />
                  </button>
                </>
              ) : (
                <label className="agent" title="Demo mode: pick who you are (login is off)">
                  <Avatar name={agent || '?'} size={26} />
                  <span className="sr-only">Acting as</span>
                  <select value={agent} onChange={(e) => setAgent(e.target.value)}>
                    {meta?.agents.map((a) => <option key={a}>{a}</option>)}
                  </select>
                  <Icon name="chevronDown" size={14} />
                </label>
              )}
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
        {counts?.FOLLOW_UP > 0 && filter !== 'FOLLOW_UP' && (
          <button type="button" className="followup-banner" onClick={() => setFilter('FOLLOW_UP')}>
            <Icon name="bell" size={15} />
            <span><strong>{counts.FOLLOW_UP}</strong> follow-up{counts.FOLLOW_UP === 1 ? ' is' : 's are'} due</span>
            <span className="followup-go">Show <Icon name="chevronRight" size={14} /></span>
          </button>
        )}
        {checked.size > 0 && (
          <BulkBar
            count={checked.size}
            total={list.length}
            agents={meta?.agents ?? []}
            onSelectAll={() => setChecked(new Set(list.map((c) => c.id)))}
            onClear={() => setChecked(new Set())}
            onAction={(action, assignee) => handlers.bulk(action, assignee).catch(() => {})}
          />
        )}
        <ConversationList
          checked={checked}
          onToggleCheck={toggleCheck}
          draftIds={new Set([...drafts.current].filter(([, d]) => d?.text?.trim()).map(([id]) => id))}
          me={agent}
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

      {error && (
        <div className="error-banner" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
          <button type="button" className="link" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      <main className="main">
        {showThread ? (
          <div className="thread-wrap">
          <ConversationView
            viewers={detail.viewers ?? []}
            detailsOpen={detailsOpen}
            onToggleDetails={() => setDetailsOpen((v) => !v)}
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
          {detailsOpen && (
            <DetailsPanel
              conversation={detail}
              now={now}
              me={session.required ? agent : null}
              onAddNote={handlers.addNote}
              onDeleteNote={handlers.deleteNote}
              onSetReminder={handlers.setReminder}
              onClose={() => setDetailsOpen(false)}
            />
          )}
          </div>
        ) : (
          <Overview
            stats={stats}
            agent={agent}
            now={now}
            loading={Boolean(selectedId)}
            nextUp={list.filter((x) => x.needs_reply_since).slice(0, 3)}
            onStart={() => move(1)}
            followUps={counts?.FOLLOW_UP ?? 0}
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
      {savedOpen && <SavedReplies intents={meta?.intents ?? []} onClose={() => { setSavedOpen(false); refresh(); }} />}
    </div>
  );
}

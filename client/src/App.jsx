import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import StatsBar from './components/StatsBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import ConversationList from './components/ConversationList.jsx';
import ConversationView from './components/ConversationView.jsx';

// Phase 1 refreshes by polling every few seconds: simple and good enough for a
// small team. Server-Sent Events or WebSockets are a later improvement.
const POLL_MS = 3000;

export default function App() {
  const [meta, setMeta] = useState(null);
  const [agent, setAgent] = useState('');
  const [filter, setFilter] = useState('NEEDS_REPLY'); // default view = what needs action
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api.meta().then((m) => {
      setMeta(m);
      setAgent(m.agents[0] ?? '');
    }).catch((e) => setError(e.message));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [l, s, d] = await Promise.all([
        api.list({ filter, q: search }),
        api.stats(),
        selectedId ? api.get(selectedId) : Promise.resolve(null),
      ]);
      setList(l);
      setStats(s);
      setDetail(d);
      setNow(Date.now());
      setError('');
    } catch (e) {
      setError(`${e.message}. Is the server running?`);
    }
  }, [filter, search, selectedId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function open(id) {
    setSelectedId(id);
    try {
      await api.read(id, agent);
      setDetail(await api.get(id));
    } catch (e) {
      setError(e.message);
    }
  }

  // Wrap mutations so every action refreshes the views and shows errors.
  const act = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      await refresh();
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">DM Manager</div>
        <StatsBar stats={stats} now={now} />
        <label className="agent-picker">
          Signed in as
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            {meta?.agents.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
      </header>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="workspace">
        <Sidebar filter={filter} onFilter={setFilter} counts={stats?.counts} />
        <ConversationList
          items={list}
          filter={filter}
          search={search}
          onSearch={setSearch}
          selectedId={selectedId}
          onSelect={open}
          now={now}
        />
        <ConversationView
          conversation={detail}
          agents={meta?.agents ?? []}
          now={now}
          onReply={act((text) => api.reply(selectedId, text, agent))}
          onStatus={act((status) => api.setStatus(selectedId, status, agent))}
          onAssign={act((assignee) => api.assign(selectedId, assignee))}
        />
      </div>
    </div>
  );
}

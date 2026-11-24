import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { intentLabel } from '../format.js';
import Icon from './Icon.jsx';

const EMPTY_FORM = { id: null, title: '', intent: '', body: '' };

/** "{name}" and "[price]" shown as small tokens, so it's clear what gets filled in. */
function Preview({ text }) {
  const parts = text.split(/(\{name\}|\[[^\]]*\])/g);
  return parts.map((p, i) =>
    p === '{name}' ? <span key={i} className="token auto" title="Filled in with the customer's @handle">@customer</span>
      : /^\[.*\]$/.test(p) ? <span key={i} className="token edit" title="You type this before sending">{p.slice(1, -1)}</span>
      : p,
  );
}

/**
 * All saved replies: search, insert into the reply box (when `onInsert` is given), add, edit, delete.
 * {name} is filled in with the customer's handle; text in [brackets] is for the agent to replace.
 */
export default function SavedReplies({ intents, onInsert, onClose }) {
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null); // null = list view; otherwise the add/edit form
  const [error, setError] = useState('');
  const searchRef = useRef(null);

  const load = () => api.savedReplies().then(setItems).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const previous = document.activeElement;
    searchRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items) return [];
    return q
      ? items.filter((r) => `${r.title} ${r.body} ${intentLabel(r.intent ?? '')}`.toLowerCase().includes(q))
      : items;
  }, [items, query]);

  async function save(e) {
    e.preventDefault();
    setError('');
    const payload = { title: form.title, body: form.body, intent: form.intent || null };
    try {
      if (form.id) await api.updateSavedReply(form.id, payload);
      else await api.createSavedReply(payload);
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(r) {
    if (!window.confirm(`Delete the saved reply "${r.title}"?`)) return;
    try {
      await api.deleteSavedReply(r.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); form ? setForm(null) : onClose(); } }}
      >
        <div className="dialog-header">
          <h2 id="saved-title">{form ? (form.id ? 'Edit saved reply' : 'New saved reply') : 'Saved replies'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        {error && <p className="form-error" role="alert"><Icon name="alert" size={14} /> {error}</p>}

        {form ? (
          <form className="saved-form" onSubmit={save}>
            <div className="saved-form-row">
              <label className="field">
                <span>Title</span>
                <input value={form.title} maxLength={60} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
              </label>
              <label className="field">
                <span>Suggest for</span>
                <select value={form.intent} onChange={(e) => setForm({ ...form, intent: e.target.value })}>
                  <option value="">Any message</option>
                  {intents.map((i) => <option key={i} value={i}>{intentLabel(i)}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Reply</span>
              <textarea rows={5} maxLength={1000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
            </label>
            <p className="dialog-note">
              <code>{'{name}'}</code> becomes the customer’s @handle. Put details that change, like <code>[price]</code>, in square brackets: they get selected so you can type over them.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        ) : (
          <>
            <div className="saved-tools">
              <label className="search">
                <Icon name="search" size={16} />
                <span className="sr-only">Search saved replies</span>
                <input ref={searchRef} type="search" placeholder="Search saved replies" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <button type="button" className="btn btn-ghost" onClick={() => setForm(EMPTY_FORM)}>
                <Icon name="plus" size={15} /> New
              </button>
            </div>
            {items === null ? (
              <p className="muted small">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="muted small">{query ? 'No saved replies match.' : 'No saved replies yet.'}</p>
            ) : (
              <ul className="saved-list">
                {shown.map((r) => (
                  <li key={r.id} className="saved-item">
                    <button
                      type="button"
                      className="saved-main"
                      onClick={() => (onInsert ? onInsert(r) : setForm({ id: r.id, title: r.title, intent: r.intent ?? '', body: r.body }))}
                      title={onInsert ? 'Insert into the reply box' : 'Edit'}
                    >
                      <span className="saved-head">
                        <span className="saved-name">{r.title}</span>
                        <span className="intent-pill">{r.intent ? intentLabel(r.intent) : 'Any message'}</span>
                        {r.use_count > 0 && <span className="saved-uses">used {r.use_count}×</span>}
                      </span>
                      <span className="saved-body"><Preview text={r.body} /></span>
                    </button>
                    <span className="saved-actions">
                      <button type="button" className="icon-btn" aria-label={`Edit ${r.title}`} onClick={() => setForm({ id: r.id, title: r.title, intent: r.intent ?? '', body: r.body })}>
                        <Icon name="edit" size={16} />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Delete ${r.title}`} onClick={() => remove(r)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

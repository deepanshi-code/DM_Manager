import Icon from './Icon.jsx';

/** Shown above the list while conversations are selected: act on all of them at once. */
export default function BulkBar({ count, total, agents, onSelectAll, onClear, onAction }) {
  return (
    <div className="bulkbar" role="region" aria-label="Bulk actions">
      <span className="bulk-count"><strong>{count}</strong> selected</span>
      {count < total && <button type="button" className="link small" onClick={onSelectAll}>Select all {total}</button>}
      <span className="bulk-actions">
        <label className="bulk-assign" title="Assign the selected chats">
          <Icon name="user" size={14} />
          <span className="sr-only">Assign selected chats to</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value === '') return;
              onAction('assign', e.target.value === '__none' ? null : e.target.value);
            }}
          >
            <option value="" disabled>Assign</option>
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
            <option value="__none">Unassign</option>
          </select>
        </label>
        <button type="button" className="bulk-btn" onClick={() => onAction('spam')} title="Label as spam and resolve">
          <Icon name="alert" size={14} /> Spam
        </button>
        <button type="button" className="bulk-btn primary" onClick={() => onAction('resolve')}>
          <Icon name="check" size={14} strokeWidth={2.4} /> Resolve
        </button>
        <button type="button" className="icon-btn" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)">
          <Icon name="close" size={15} />
        </button>
      </span>
    </div>
  );
}

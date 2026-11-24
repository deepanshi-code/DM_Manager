import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';

function RailButton({ icon, label, active, pressed, badge, alert, onClick }) {
  return (
    <button
      type="button"
      className={`rail-btn ${active ? 'active' : ''} ${pressed ? 'on' : ''}`}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      aria-pressed={pressed === undefined ? undefined : pressed}
    >
      <Icon name={icon} size={20} />
      {badge > 0 && <span className={`rail-badge ${alert ? 'alert' : ''}`}>{badge > 99 ? '99+' : badge}</span>}
      <span className="rail-tip" aria-hidden="true">{label}</span>
    </button>
  );
}

/** Left navigation rail (desktop/tablet). On phones the inbox header shows the same actions. */
export default function Rail({
  view, counts, agent, agents, loginRequired, alertsOn,
  onOverview, onInbox, onSaved, onAlerts, onHelp, onAgent, onSignOut,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => {
      if (e.type === 'keydown') {
        if (e.key !== 'Escape') return;
        e.stopPropagation(); // Escape closes only the menu, not the open chat behind it
        setMenuOpen(false);
      } else if (!menuRef.current?.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  return (
    <nav className="rail" aria-label="Main">
      <a className="rail-logo" href="/" aria-label="DM Manager home page" title="Home page"><Icon name="send" size={18} strokeWidth={2.2} /></a>

      <div className="rail-group">
        <RailButton icon="inbox" label="Inbox" active={view === 'inbox'} badge={counts?.NEEDS_REPLY} alert={counts?.OVERDUE > 0} onClick={onInbox} />
        <RailButton icon="chart" label="Overview" active={view === 'overview'} onClick={onOverview} />
        <RailButton icon="zap" label="Saved replies" onClick={onSaved} />
      </div>

      <div className="rail-group rail-bottom">
        <RailButton icon="bell" label={alertsOn ? 'Overdue alerts: on' : 'Overdue alerts: off'} pressed={alertsOn} onClick={onAlerts} />
        <RailButton icon="keyboard" label="Keyboard shortcuts" onClick={onHelp} />
        <div className="rail-me" ref={menuRef}>
          <button
            type="button"
            className="rail-avatar"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${agent || 'Agent'}: account menu`}
          >
            <Avatar name={agent || '?'} size={34} status="online" />
          </button>
          {menuOpen && (
            <div className="rail-menu" role="menu">
              <div className="rail-menu-head">
                <Avatar name={agent || '?'} size={36} />
                <span>
                  <strong>{agent}</strong>
                  <small>{loginRequired ? 'Signed in' : 'Demo mode (login off)'}</small>
                </span>
              </div>
              {loginRequired ? (
                <button type="button" role="menuitem" className="rail-menu-item" onClick={() => { setMenuOpen(false); onSignOut(); }}>
                  <Icon name="logout" size={16} /> Sign out
                </button>
              ) : (
                <>
                  <p className="rail-menu-label">Act as</p>
                  {agents.map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="menuitemradio"
                      aria-checked={a === agent}
                      className={`rail-menu-item ${a === agent ? 'checked' : ''}`}
                      onClick={() => { onAgent(a); setMenuOpen(false); }}
                    >
                      <Avatar name={a} size={22} /> {a}
                      {a === agent && <Icon name="check" size={14} strokeWidth={2.4} />}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

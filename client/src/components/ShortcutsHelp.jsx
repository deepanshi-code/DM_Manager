import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

const SHORTCUTS = [
  ['j / ↓', 'Next conversation'],
  ['k / ↑', 'Previous conversation'],
  ['r', 'Reply (focus the message box)'],
  ['1 / 2 / 3', 'Insert a suggested saved reply'],
  ['Ctrl + Enter', 'Send reply'],
  ['e', 'Resolve conversation'],
  ['a', 'Assign the chat to me'],
  ['n', 'Write a team note'],
  ['x', 'Select the chat for a bulk action'],
  ['/', 'Search'],
  ['Esc', 'Leave the text box, or close the conversation'],
  ['?', 'Show or hide this list'],
];

export default function ShortcutsHelp({ onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt>{keys.split(' / ').map((k, i) => (
                <span key={k}>{i > 0 && ' / '}<kbd>{k}</kbd></span>
              ))}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <p className="dialog-note">
          After you send a reply or resolve a chat, the next conversation opens automatically. Turn this off
          under the reply box.
        </p>
      </div>
    </div>
  );
}

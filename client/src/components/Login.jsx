import { useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

/** Sign-in screen, shown when the server has login turned on and there is no session. */
export default function Login({ onSignedIn }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { agent } = await api.login(name, password);
      onSignedIn(agent);
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Icon name="send" size={14} strokeWidth={2} /></span>
          <h1>DM Manager</h1>
        </div>
        <p className="login-sub">Sign in to answer your team’s Instagram messages.</p>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>

        {error && <p className="login-error" role="alert"><Icon name="alert" size={14} /> {error}</p>}

        <button type="submit" className="btn btn-primary login-btn" disabled={busy || !name || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="login-note">Accounts are created by your admin with <code>npm run agent -- add &lt;name&gt;</code>.</p>
      </form>
    </main>
  );
}

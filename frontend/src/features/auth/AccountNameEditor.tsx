import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../lib/api';
import { useAuth } from './AuthContext';

export function AccountNameEditor() {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [expected, setExpected] = useState({ id: '', first_name: '', last_name: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  if (!auth.user || auth.publicDemo) return null;

  function open() {
    if (!auth.user) return;
    setExpected({ id: auth.user.id, first_name: auth.user.first_name, last_name: auth.user.last_name });
    setName(`${auth.user.first_name} ${auth.user.last_name}`.trim());
    setError(''); setStatus(''); setEditing(true);
  }
  function close() { setEditing(false); setError(''); requestAnimationFrame(() => editButton.current?.focus()); }
  async function save(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!value || value.length > 150 || /\p{Cc}/u.test(value)) {
      setError('Enter a name of up to 150 characters, without control characters.'); return;
    }
    if (auth.user?.id !== expected.id) { setError('The signed-in account changed. Reopen the name editor.'); return; }
    setBusy(true); setError(''); setStatus('');
    try {
      await apiFetch('/api/v1/auth/profile/', { method: 'PATCH', body: JSON.stringify({ first_name: value, last_name: '',
        expected_first_name: expected.first_name, expected_last_name: expected.last_name }) });
      let refreshed = false;
      try { refreshed = Boolean(await auth.refresh()); } catch { /* The accepted save remains successful. */ }
      setStatus(refreshed ? 'Account name saved.' : 'Account name saved. Refresh the page to update your account summary.');
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your account name.'); }
    finally { setBusy(false); }
  }
  return <section className="account-profile-group account-name" aria-labelledby="account-name-title">
    <div className="account-name__heading"><div><h2 id="account-name-title">Account name</h2><p>Used across your signed-in workspaces. Campus person records are managed separately.</p></div>
      {!editing ? <button ref={editButton} className="security-secondary" type="button" onClick={open}>Edit name</button> : null}</div>
    {editing ? <form onSubmit={event => void save(event)} aria-busy={busy}>
      <label htmlFor="account-name">Name</label><input ref={input} id="account-name" autoComplete="name" value={name} maxLength={150}
        aria-describedby="account-name-limit" disabled={busy} onChange={event => setName(event.target.value)}/>
      <small id="account-name-limit">Up to 150 characters. Keep the spelling and spacing you use.</small>
      {error ? <div className="account-name__error" role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => { void auth.refresh().then(result => { if (result) close(); else setError('Could not reload your account. Try again.'); }).catch(() => setError('Could not reload your account. Try again.')); }}>Reload account</button></div> : null}
      <div className="account-name__actions"><button className="security-secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button className="security-primary" type="submit" disabled={busy || !name.trim() || name.trim().length > 150}>{busy ? 'Saving…' : 'Save name'}</button></div>
    </form> : null}
    {status ? <p className="account-name__status" role="status">{status}</p> : null}
  </section>;
}

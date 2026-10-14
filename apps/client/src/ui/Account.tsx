import { useEffect, useState } from 'preact/hooks';
import {
  account,
  backend,
  linkProvider,
  linkedProviders,
  oauthProviders,
  rename,
  saveAccount,
  signInWithEmail,
  signInWithProvider,
  signOut,
  takeLinkConflict,
  type Account as AccountInfo,
  type OAuthProvider,
} from '../net/backend';

const PROVIDER_NAME: Record<OAuthProvider, string> = { google: 'Google', github: 'GitHub' };

type Busy = null | 'name' | 'save' | 'signin' | 'signout' | 'oauth';

/**
 * Account panel: display name, and turning the guest account into a permanent one.
 * Everyone starts as a guest (an anonymous account in this browser). Confirming an
 * email keeps the same account, so the name and match history carry over.
 */
export function Account({ onClose, onChange }: { onClose: () => void; onChange?: (a: AccountInfo) => void }) {
  const sb = backend();
  const [me, setMe] = useState<AccountInfo | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [linked, setLinked] = useState<string[]>([]);
  /** Linking failed because that Google / GitHub account already has an account. */
  const [conflict] = useState(takeLinkConflict);
  useEffect(() => void oauthProviders().then(setProviders), []);

  const load = async () => {
    if (!sb) return;
    try {
      const a = await account(sb);
      setMe(a);
      setName(a.name);
      setLinked(await linkedProviders(sb));
      onChange?.(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => void load(), []);

  /** Run an action; `done` is the notice afterwards (or computed from the action's result). */
  const run = async <T,>(kind: Busy, fn: () => Promise<T>, done: string | ((r: T) => string)) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      setNotice(typeof done === 'function' ? done(r) : done);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div class="codex-overlay" data-testid="account" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="codex account">
        <header class="codex-head">
          <h1>Account</h1>
          <button class="close" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        <div class="codex-body prose">
          {!sb ? (
            <p class="lead" data-testid="account-offline">
              Accounts need the online service, which this build does not have. Skirmish works without one.
            </p>
          ) : !me ? (
            <p class="muted">{error ?? 'Loading…'}</p>
          ) : (
            <>
              <section>
                <h3>Name</h3>
                <p class="muted small">Shown to opponents in multiplayer and on the leaderboard.</p>
                <div class="seed">
                  <input value={name} maxLength={20} data-testid="account-name" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
                  <button
                    data-testid="account-rename"
                    disabled={busy !== null || name.trim() === me.name}
                    onClick={() => void run('name', () => rename(sb, name), 'Name saved.')}
                  >
                    {busy === 'name' ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </section>
              {me.guest && conflict && (
                <section class="conflict" data-testid="account-conflict">
                  <h3>You already have an account</h3>
                  <p class="muted small">
                    Your {PROVIDER_NAME[conflict]} email already belongs to a Signal Fall account, so it cannot be added to this guest. Sign in to that
                    account instead: its name, history and rating come back. This guest's matches stay with the guest.
                  </p>
                  <button class={`oauth ${conflict}`} data-testid="account-conflict-signin" disabled={busy !== null} onClick={() => void run('oauth', () => signInWithProvider(sb, conflict), '')}>
                    Sign in with {PROVIDER_NAME[conflict]}
                  </button>
                </section>
              )}
              {me.guest ? (
                <>
                  <section>
                    <h3>Keep your account</h3>
                    <p class="muted small">
                      You are playing as a <b>guest</b>: the account lives only in this browser. Add your email and open the link we send, and it becomes
                      a permanent account you can sign in to anywhere. Your name and match history stay.
                    </p>
                    {me.pendingEmail && (
                      <p class="small" data-testid="account-pending">
                        Waiting for you to confirm <b>{me.pendingEmail}</b>. Check your inbox.
                      </p>
                    )}
                    <div class="seed">
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        data-testid="account-email"
                        onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
                      />
                      <button
                        class="start"
                        data-testid="account-save"
                        disabled={busy !== null || !validEmail}
                        onClick={() =>
                          void run(
                            'save',
                            () => saveAccount(sb, email),
                            (pending) => (pending ? 'Check your email and open the link to confirm.' : 'Account saved.'),
                          )
                        }
                      >
                        {busy === 'save' ? 'Sending…' : 'Send link'}
                      </button>
                    </div>
                    {providers.length > 0 && (
                      <div class="oauth-row">
                        <span class="muted small">or keep it with</span>
                        {providers.map((p) => (
                          <button class={`oauth ${p}`} data-testid={`account-link-${p}`} disabled={busy !== null} onClick={() => void run('oauth', () => linkProvider(sb, p), '')}>
                            {PROVIDER_NAME[p]}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                  <section>
                    <h3>Already have an account?</h3>
                    <p class="muted small">Signing in replaces this guest in this browser.</p>
                    <div class="oauth-row">
                      <button
                        data-testid="account-signin"
                        disabled={busy !== null || !validEmail}
                        onClick={() => void run('signin', () => signInWithEmail(sb, email), 'Check your email for the sign-in link.')}
                      >
                        {busy === 'signin' ? 'Sending…' : 'Email me a sign-in link'}
                      </button>
                      {providers.map((p) => (
                        <button class={`oauth ${p}`} data-testid={`account-signin-${p}`} disabled={busy !== null} onClick={() => void run('oauth', () => signInWithProvider(sb, p), '')}>
                          Sign in with {PROVIDER_NAME[p]}
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <section>
                  <h3>Signed in</h3>
                  <p data-testid="account-email-shown">
                    {me.email}
                    {me.pendingEmail && <span class="muted"> (changing to {me.pendingEmail})</span>}
                  </p>
                  {linked.length > 0 && <p class="muted small">Sign in with: {linked.map((p) => PROVIDER_NAME[p as OAuthProvider] ?? p).join(', ')}</p>}
                  {providers.some((p) => !linked.includes(p)) && (
                    <div class="oauth-row">
                      <span class="muted small">Also sign in with</span>
                      {providers
                        .filter((p) => !linked.includes(p))
                        .map((p) => (
                          <button class={`oauth ${p}`} data-testid={`account-link-${p}`} disabled={busy !== null} onClick={() => void run('oauth', () => linkProvider(sb, p), '')}>
                            {PROVIDER_NAME[p]}
                          </button>
                        ))}
                    </div>
                  )}
                  <button data-testid="account-signout" disabled={busy !== null} onClick={() => void run('signout', () => signOut(sb), 'Signed out. You are a guest again.')}>
                    Sign out
                  </button>
                </section>
              )}
              <p class="muted small">
                What we keep and why:{' '}
                <a href="/privacy/" target="_blank" rel="noopener">
                  privacy
                </a>
                .
              </p>
              {notice && (
                <p class="good" data-testid="account-notice">
                  {notice}
                </p>
              )}
              {error && (
                <p class="mp-status" data-testid="account-error">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

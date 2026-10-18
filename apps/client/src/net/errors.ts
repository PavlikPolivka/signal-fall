import { backend } from './backend';

/** At most this many reports per page load, and each distinct message once. */
const MAX_REPORTS = 5;
const sent = new Set<string>();

/**
 * Anonymous crash reports: uncaught errors (main thread and sim worker) go to the backend with
 * the message, stack, page path and what the game was doing. Nothing about the player is sent,
 * and nothing is sent without a backend or a session (no account is made just to report).
 */
export function reportErrors(context: () => string, worker?: Worker): void {
  const report = (message: string, stack?: string) => {
    if (import.meta.env.DEV || sent.size >= MAX_REPORTS || sent.has(message)) return;
    sent.add(message);
    const sb = backend();
    if (!sb) return;
    void sb.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      void sb.from('client_errors').insert({
        message: message.slice(0, 2000),
        stack: stack?.slice(0, 8000) ?? null,
        path: location.pathname.slice(0, 200),
        context: context().slice(0, 200),
        client_version: String(import.meta.env.VITE_VERSION ?? 'dev').slice(0, 64),
      });
    });
  };
  window.addEventListener('error', (e) => report(e.message || String(e.error), e.error instanceof Error ? e.error.stack : undefined));
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    report(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  });
  worker?.addEventListener('error', (e) => report(`worker: ${e.message}`, `${e.filename}:${e.lineno}:${e.colno}`));
}

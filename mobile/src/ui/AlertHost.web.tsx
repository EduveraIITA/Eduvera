import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useSession } from '../auth/SessionProvider';
import { useTheme } from './theme';
import { browserAlerts } from './alert-queue';

export function AlertHost() {
  const { scopeKey } = useSession(), { colors } = useTheme();
  const alert = useSyncExternalStore(browserAlerts.subscribe, browserAlerts.current, () => null);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { browserAlerts.setScope(scopeKey); }, [scopeKey]);
  useLayoutEffect(() => {
    const node = dialog.current; if (!node) return;
    if (alert && !node.open) node.showModal();
    if (!alert && node.open) node.close();
  }, [alert]);
  const preferred = alert?.buttons.findIndex(button => button.isPreferred) ?? -1;
  const primary = alert ? alert.buttons.findLastIndex(button => button.style !== 'cancel') : -1;
  return <><style>{'dialog[data-campus-alert]::backdrop{background:rgba(0,0,0,.35)}dialog[data-campus-alert] button:focus-visible{outline:2px solid currentColor;outline-offset:3px}'}</style><dialog ref={dialog} data-campus-alert role="alertdialog" aria-labelledby="campus-alert-title" aria-describedby={alert?.message ? 'campus-alert-message' : undefined} onCancel={event => { event.preventDefault(); if (alert) browserAlerts.dismiss(alert.id); }} style={{ width: 'min(440px, calc(100vw - 40px))', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 24, padding: 24, backgroundColor: colors.surface, color: colors.ink, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
    {alert ? <><h2 id="campus-alert-title" style={{ fontSize: 20, lineHeight: '28px', margin: '0 0 12px', fontWeight: 600 }}>{alert.title}</h2>{alert.message ? <p id="campus-alert-message" style={{ fontSize: 16, lineHeight: '24px', whiteSpace: 'pre-wrap', margin: '0 0 20px' }}>{alert.message}</p> : null}<div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>{alert.buttons.map((button, index) => <button key={index} autoFocus={index === (preferred < 0 ? 0 : preferred)} onClick={() => browserAlerts.choose(alert.id, index)} style={{ minHeight: 44, minWidth: 72, padding: '10px 16px', border: 0, borderRadius: 16, cursor: 'pointer', fontSize: 14, fontWeight: 600, backgroundColor: button.style === 'destructive' ? colors.dangerSoft : index === primary ? colors.action : colors.row, color: button.style === 'destructive' ? colors.danger : index === primary ? colors.onAction : colors.ink }}>{button.text ?? 'OK'}</button>)}</div></> : null}
  </dialog></>;
}

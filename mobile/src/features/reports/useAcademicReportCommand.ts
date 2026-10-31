import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch, captureApiContext, getApiOrigin } from '../../lib/api';
import { AcademicReportJournal, reportCommandKind, reportCommandScopeKey, type ReportCommand, type ReportCommandScope } from '../../lib/academic-report-command';
import { createChunkedNativePendingStorage } from '../../lib/native-pending-action';
import { useOperationContext } from '../../lib/use-operation-context';
import { reportBatchMatches, reportSchemeMatches, reportWorkspaceMatches } from '../../lib/academic-report-policy';
import type { AcademicReportWorkspace, GradingSchemeDetail, ReportBatchDetail } from '../../../../packages/contracts/src/academic-reports';

type Record = { journal: AcademicReportJournal };
const registry = new Map<string, Record>();
let selectedScope = '';
export function useAcademicReportCommand(href: string, onAccepted: (command: ReportCommand) => Promise<void>) {
  const { user, schoolId, environment } = useSession();
  const captureOperation = useOperationContext(href);
  const scope: ReportCommandScope = { actorId: user?.id ?? '', schoolId: schoolId ?? '', mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() };
  const key = reportCommandScopeKey(scope); selectedScope = key;
  const record = useMemo(() => {
    const existing = registry.get(key); if (existing) return existing;
    let randomId: (() => string) | undefined;
    const storage = Promise.all([import('../../lib/device-storage'), import('expo-crypto')]).then(async ([store, crypto]) => {
      randomId = crypto.randomUUID;
      const prefix = `thatcampus.academic-reports.${await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, key)}`;
      return createChunkedNativePendingStorage({ get: store.getItemAsync, set: (name, value) => store.setItemAsync(name, value, { keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: store.deleteItemAsync, randomId: crypto.randomUUID, digest: value => crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, value) }, prefix);
    });
    const root = `/api/v1/schools/${encodeURIComponent(scope.schoolId)}/academic-reports`;
    const next: Record = { journal: new AcademicReportJournal({ scope,
      storage: { read: async () => (await storage).read(), write: async value => (await storage).write(value), clear: async () => (await storage).clear() },
      randomId: () => { if (!randomId) throw new Error('Secure action identity is not ready.'); return randomId(); },
      capture: () => { const transport = captureApiContext(); return { assertCurrent: () => { transport.assertCurrent(); if (selectedScope !== key || getApiOrigin() !== scope.origin) throw new Error('The account, campus, world or server changed. The original grading action remains retained.'); } }; },
      send: command => apiFetch(command.endpoint, { method: command.method, body: command.body }),
      refresh: async (command, assertCurrent) => {
        assertCurrent();
        const workspace = await apiFetch<AcademicReportWorkspace>(`${root}/workspace/`); assertCurrent();
        if (!reportWorkspaceMatches(workspace, scope.schoolId)) throw new Error('The saved report workspace could not be verified.');
        const kind = reportCommandKind(command)!; const result = command.result as { id: string };
        if (kind.kind === 'batch' || kind.kind === 'comments') { const id = kind.kind === 'comments' ? kind.target! : result.id; assertCurrent(); const detail = await apiFetch<ReportBatchDetail>(`${root}/batches/${encodeURIComponent(id)}/`); assertCurrent(); if (!reportBatchMatches(detail, id, workspace, scope.schoolId)) throw new Error('The accepted release does not match the current workspace.'); }
        if (kind.kind === 'scheme') { assertCurrent(); const detail = await apiFetch<GradingSchemeDetail>(`${root}/schemes/${encodeURIComponent(result.id)}/`); assertCurrent(); if (!reportSchemeMatches(detail, result.id, workspace, scope.schoolId)) throw new Error('The accepted grading structure does not match the current workspace.'); }
        assertCurrent(); if (selectedScope !== key) throw new Error('The selected world changed before refresh.');
      },
    }) }; registry.set(key, next); return next;
  }, [key]);
  const [state, setState] = useState(record.journal.snapshot());
  useEffect(() => { const stop = record.journal.subscribe(setState); void record.journal.hydrate(); return stop; }, [record]);
  const operation = () => ({ assertCurrent: captureOperation(), accepted: onAccepted });
  return { ...state, locked: !state.ready || state.busy || state.blocked || !!state.pending, run: (input: Parameters<AcademicReportJournal['run']>[0]) => record.journal.run(input, operation()), recover: (ownerHref: string) => record.journal.recover(ownerHref, operation()) };
}
export type AcademicReportWriter = ReturnType<typeof useAcademicReportCommand>;

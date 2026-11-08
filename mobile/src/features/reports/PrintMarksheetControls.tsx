import React, { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../../lib/api';
import { prepareMarksheetPrint } from '../../lib/marksheet-print';
import { loadPublishedMarksheet, type PublishedSelection, type PublishedLearnerTarget } from '../../lib/published-marksheet';
import { useScreenExitGuard } from '../../ui/BackNavigation';
import { Notice } from '../../ui/components';
import { ControlButton } from '../../ui/DomainControls';

export function PrintMarksheetControls(props: PublishedLearnerTarget & { schoolId: string; selection: PublishedSelection }) {
  const { schoolId, selection } = props, learner = props.personId !== undefined ? { personId: props.personId } : { studentId: props.studentId };
  const { schoolId: selectedSchool, environment, memberships } = useSession(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useScreenExitGuard({ blocked: busy, title: 'Preparing marksheet', message: 'Finish or close the print dialog before leaving this result.' });
  async function print(savePdf: boolean) {
    if (busy || environment.unavailable || selectedSchool !== schoolId) return;
    let target: ReturnType<typeof prepareMarksheetPrint> | undefined;
    try {
      const context = captureApiContext(); context.assertCurrent(); target = prepareMarksheetPrint(savePdf); setBusy(true); setError('');
      const html = await loadPublishedMarksheet({ schoolId, ...learner, selection, schoolName: memberships.find(item => item.school_id === schoolId)?.school_name ?? 'Campus', worldLabel: environment.mode === 'simulation' ? `Simulation · ${environment.run_id ?? environment.namespace_id ?? 'selected run'}` : '', assertCurrent: context.assertCurrent, read: apiFetch });
      context.assertCurrent(); await target.print(html, context.assertCurrent);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The marksheet could not be printed.'); }
    finally { target?.cancel(); setBusy(false); }
  }
  return <><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Print marksheet" kind="secondary" busy={busy} disabled={busy || environment.unavailable} onPress={() => void print(false)} /><ControlButton title="Save PDF" kind="secondary" disabled={busy || environment.unavailable} onPress={() => void print(true)} /></View>{error ? <Notice tone="warning" message={error} /> : null}</>;
}

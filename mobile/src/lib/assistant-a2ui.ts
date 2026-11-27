import { ASSISTANT_A2UI_CATALOG, type CampusA2uiActionMessage, type CampusA2uiComponent } from './campus-a2ui';

const SOURCE = { '@path': '/sourceId' };
const ACTION = { '@path': '/actionId' };
const reportId = (sourceId: string) => `assistant-report-${sourceId}`;
const controlsId = (actionId: string, kind: 'decision' | 'record') => `assistant-review-${kind}-${actionId}`;

function surface(surfaceId: string, root: CampusA2uiComponent, components: CampusA2uiComponent[], dataModel: Record<string, unknown>) {
  return [{ version: '1.0', createSurface: { surfaceId, catalogId: ASSISTANT_A2UI_CATALOG, components: [root, ...components], dataModel } }];
}

export function assistantReplyMessages(runId: string, answer: string) {
  return surface(`assistant-reply-${runId}`, { id: 'root', component: 'Text', text: { '@path': '/answer' } }, [], { answer });
}

export function assistantReportMessages(sourceId: string, visible: { chart: boolean; source: boolean }) {
  const components: CampusA2uiComponent[] = [];
  if (visible.chart) components.push({ id: 'chart', component: 'ReportChart', sourceId: SOURCE });
  if (visible.source) components.push({ id: 'source', component: 'ReportSource', sourceId: SOURCE,
    action: { event: { name: 'open_assistant_source', context: { sourceId: SOURCE } } } });
  return surface(reportId(sourceId), { id: 'root', component: 'Column', children: components.map(component => component.id) }, components, { sourceId });
}

export function assistantReportSourceSelected({ action }: CampusA2uiActionMessage, sourceId: string) {
  return action.surfaceId === reportId(sourceId) && action.sourceComponentId === 'source' &&
    action.name === 'open_assistant_source' && action.context.sourceId === sourceId;
}

export function assistantDecisionMessages(actionId: string, confirmationLabel: string, expired: boolean) {
  return surface(controlsId(actionId, 'decision'), { id: 'root', component: 'Row', children: ['dismiss', 'confirm'] }, [
    { id: 'dismiss', component: 'Button', child: 'dismiss-label',
      action: { event: { name: 'dismiss_assistant_action', context: { actionId: ACTION } } } },
    { id: 'dismiss-label', component: 'Text', text: 'Dismiss' },
    { id: 'confirm', component: 'Button', child: 'confirm-label', variant: 'primary', disabled: expired,
      action: { event: { name: 'confirm_assistant_action', context: { actionId: ACTION } } } },
    { id: 'confirm-label', component: 'Text', text: confirmationLabel },
  ], { actionId });
}

export function assistantDecisionSelected({ action }: CampusA2uiActionMessage, actionId: string, locked: boolean, expired: boolean) {
  if (locked || action.surfaceId !== controlsId(actionId, 'decision') || action.context.actionId !== actionId) return;
  if (action.sourceComponentId === 'dismiss' && action.name === 'dismiss_assistant_action') return 'reject';
  if (!expired && action.sourceComponentId === 'confirm' && action.name === 'confirm_assistant_action') return 'confirm';
}

export function assistantActionRecordMessages(actionId: string, label: string) {
  return surface(controlsId(actionId, 'record'), { id: 'root', component: 'Button', child: 'label',
    action: { event: { name: 'open_assistant_action', context: { actionId: ACTION } } } },
  [{ id: 'label', component: 'Text', text: label }], { actionId });
}

export function assistantActionRecordSelected({ action }: CampusA2uiActionMessage, actionId: string) {
  return action.surfaceId === controlsId(actionId, 'record') && action.sourceComponentId === 'root' &&
    action.name === 'open_assistant_action' && action.context.actionId === actionId;
}

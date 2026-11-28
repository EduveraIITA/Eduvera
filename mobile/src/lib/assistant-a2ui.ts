import type { AgentPublicWebSource } from '../../../packages/contracts/src/wire/features/assistant/agentApi';
import { assistantPublicWebUrl } from './assistant-policy';
import { validCopilotArgs, type InteriorCheckpoint } from './copilot';
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


export function assistantCampusNameMessages(detailId:string) {
  const binding={ '@path':'/name' };
  return surface(`assistant-campus-name-${detailId}`, { id:'root',component:'Column',children:['name','accept'] }, [
    { id:'name',component:'TextField',variant:'shortText',label:'Campus name',maxLength:180,value:binding },
    { id:'accept',component:'Button',variant:'primary',child:'accept-label',
      action:{event:{name:'answer_campus_detail',context:{detailId:{'@path':'/detailId'},name:binding}}} },
    { id:'accept-label',component:'Text',text:'Use name' },
  ],{detailId,name:''});
}

export function assistantCampusNameAnswer({action}:CampusA2uiActionMessage,detailId:string):string | undefined {
  if(action.surfaceId!==`assistant-campus-name-${detailId}` || action.sourceComponentId!=='accept' ||
     action.name!=='answer_campus_detail' || action.context.detailId!==detailId || typeof action.context.name!=='string')return;
  const name=action.context.name.trim();
  return validCopilotArgs('prepare_campus_create',{name}) ? name : undefined;
}

const interiorSurface = (stepId: string) => `assistant-interior-${stepId}`;
const selectedBuilding = { '@path': '/selectedBuilding' };
const interiorStep = { '@path': '/stepId' };
export function assistantInteriorSelectionMessages(checkpoint: InteriorCheckpoint, mapActive: boolean) {
  const { step_id: stepId, target, options } = checkpoint;
  const prompt = options.length ? 'Which building should I map?' : target ? `Select ${target} on the map.` : 'Select a building on the map.';
  const components: CampusA2uiComponent[] = [{ id: 'prompt', component: 'Text', text: { '@path': '/prompt' } }];
  const children = ['prompt'];
  const controls = ['stop'];
  if (options.length) {
    components.push({ id: 'building', component: 'ChoicePicker', label: 'Building', value: selectedBuilding,
      variant: 'mutuallyExclusive', options: options.map(({ label, campus_name }, index) => ({ value: String(index), label: `${label} · ${campus_name}` })) });
    children.push('building');
    controls.push('use');
    components.push({ id: 'use', component: 'Button', child: 'use-label', variant: 'primary',
      action: { event: { name: 'choose_interior_building', context: { stepId: interiorStep, selectedBuilding } } } },
    { id: 'use-label', component: 'Text', text: 'Use building' });
  }
  if (!mapActive) {
    controls.unshift('map');
    components.push({ id: 'map', component: 'Button', child: 'map-label', ...(options.length ? {} : { variant: 'primary' }),
      action: { event: { name: 'show_interior_map', context: { stepId: interiorStep } } } },
    { id: 'map-label', component: 'Text', text: 'Show map' });
  }
  components.push({ id: 'controls', component: 'Row', children: controls },
    { id: 'stop', component: 'Button', child: 'stop-label', action: { event: { name: 'stop_interior_setup', context: { stepId: interiorStep } } } },
    { id: 'stop-label', component: 'Text', text: 'Stop' });
  children.push('controls');
  return surface(interiorSurface(stepId), { id: 'root', component: 'Column', children }, components, { stepId, prompt, selectedBuilding: [] });
}

export function assistantInteriorSelectionAction({ action }: CampusA2uiActionMessage, checkpoint: InteriorCheckpoint) {
  if (action.surfaceId !== interiorSurface(checkpoint.step_id) || action.context.stepId !== checkpoint.step_id) return;
  if (action.sourceComponentId === 'map' && action.name === 'show_interior_map') return { kind: 'map' as const };
  if (action.sourceComponentId === 'stop' && action.name === 'stop_interior_setup') return { kind: 'stop' as const };
  if (action.sourceComponentId !== 'use' || action.name !== 'choose_interior_building') return;
  const value = action.context.selectedBuilding;
  const option = Array.isArray(value) && value.length === 1 && typeof value[0] === 'string' && /^[0-7]$/.test(value[0])
    ? checkpoint.options[Number(value[0])] : undefined;
  return option ? { kind: 'select' as const, selection: { campus_id: option.campus_id, element_id: option.element_id } } : { kind: 'missing' as const };
}

export function assistantPublicWebSourceMessages(source: AgentPublicWebSource, compact = false) {
  const id = `assistant-public-web-${source.id}`;
  const host = new URL(source.url).hostname;
  const description = !compact && !!source.description;
  const components: CampusA2uiComponent[] = [
    { id: 'open', component: 'Button', variant: 'borderless', child: 'label',
      action: { event: { name: 'open_public_web_source', context: { sourceId: SOURCE } } } },
    { id: 'label', component: 'Text', text: { '@path': '/label' } },
  ];
  if (description) components.push({ id: 'description', component: 'Text', text: { '@path': '/description' } });
  return surface(id, { id: 'root', component: 'Column', children: description ? ['open', 'description'] : ['open'] },
    components, { sourceId: source.id, label: compact ? source.title : `${source.title} · ${host}`, description: source.description });
}

export function assistantPublicWebSourceSelected({ action }: CampusA2uiActionMessage, source: AgentPublicWebSource) {
  if (action.surfaceId === `assistant-public-web-${source.id}` && action.sourceComponentId === 'open' &&
      action.name === 'open_public_web_source' && action.context.sourceId === source.id) return assistantPublicWebUrl(source.url);
}

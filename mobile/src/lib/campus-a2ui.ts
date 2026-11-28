export const CAMPUS_A2UI_BASIC_CATALOG = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
export const ASSISTANT_A2UI_CATALOG = 'https://thatcampus.com/a2ui/catalogs/assistant/v1';
export type CampusA2uiCatalog = typeof CAMPUS_A2UI_BASIC_CATALOG | typeof ASSISTANT_A2UI_CATALOG;
const MAX_MESSAGES = 32;
const MAX_COMPONENTS = 128;
const MAX_DEPTH = 12;
const ACTION_NAMES = ['focus_feature', 'accept_place_hint', 'review_places', 'answer_indoor_question', 'skip_indoor_question',
  'open_floor_plan_source', 'use_public_floor_plan'] as const;
const ASSISTANT_ACTION_NAMES = ['open_assistant_source', 'open_assistant_action', 'confirm_assistant_action', 'dismiss_assistant_action', 'answer_campus_detail', 'choose_interior_building', 'show_interior_map', 'stop_interior_setup', 'open_public_web_source'] as const;

type DataModel = Record<string, unknown>;
type ActionName = typeof ACTION_NAMES[number] | typeof ASSISTANT_ACTION_NAMES[number];

export interface CampusA2uiActionMessage {
  version: '1.0';
  action: {
    name: ActionName;
    surfaceId: string;
    sourceComponentId: string;
    timestamp: string;
    context: Record<string, unknown>;
    userMessage?: string;
  };
}

export interface CampusA2uiComponent extends Record<string, unknown> {
  id: string;
  component: 'Column' | 'Row' | 'Card' | 'Divider' | 'Text' | 'TextField' | 'ChoicePicker' | 'Button' | 'ReportChart' | 'ReportSource';
}

export interface CampusA2uiSurfaceState {
  id: string;
  catalogId: CampusA2uiCatalog;
  components: Map<string, CampusA2uiComponent>;
  model: DataModel;
}

export function a2uiRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pointerParts(path: unknown): string[] | undefined {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 512 || /~(?![01])/.test(path)) return;
  const parts = path === '/' ? [] : path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.length <= MAX_DEPTH && parts.every(part => !['__proto__', 'prototype', 'constructor'].includes(part))) return parts;
}

export function a2uiBindingPath(value: unknown): string | undefined {
  if (!a2uiRecord(value) || Object.keys(value).length !== 1 || typeof value['@path'] !== 'string') return;
  if (pointerParts(value['@path'])?.length) return value['@path'];
}

export function resolveA2uiValue(value: unknown, model: DataModel): unknown {
  if (!a2uiRecord(value)) return value;
  const path = a2uiBindingPath(value);
  return path ? pointerParts(path)?.reduce<unknown>((current, part) => {
    if (Array.isArray(current)) return /^(0|[1-9]\d*)$/.test(part) ? current[Number(part)] : undefined;
    if (a2uiRecord(current) && Object.hasOwn(current, part)) return current[part];
  }, model) : undefined;
}

export function a2uiText(value: unknown, model: DataModel): string {
  const result = resolveA2uiValue(value, model);
  return typeof result === 'string' ? result : '';
}

function writeAtPath(target: unknown, [part, ...rest]: string[], value: unknown): unknown {
  if (part === undefined) return value;
  if (Array.isArray(target)) {
    if (!/^(0|[1-9]\d*)$/.test(part) || Number(part) >= target.length) return target;
    const list = [...target];
    if (value === null && !rest.length) list.splice(Number(part), 1);
    else list[Number(part)] = writeAtPath(list[Number(part)], rest, value);
    return list;
  }
  const object = a2uiRecord(target) ? { ...target } : {};
  if (value === null && !rest.length) delete object[part];
  else object[part] = writeAtPath(Object.hasOwn(object, part) ? object[part] : undefined, rest, value);
  return object;
}

export function writeA2uiValue(model: DataModel, path: unknown, value: unknown): DataModel {
  const parts = pointerParts(path);
  if (!parts) return model;
  if (!parts.length) return a2uiRecord(value) ? value : {};
  return writeAtPath(model, parts, value) as DataModel;
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 180;
}

function a2uiComponent(value: unknown, catalogId: CampusA2uiCatalog): value is CampusA2uiComponent {
  return a2uiRecord(value) && validId(value.id)
    && (value['@catalogId'] === undefined || value['@catalogId'] === catalogId)
    && typeof value.component === 'string'
    && (['Column', 'Row', 'Card', 'Divider', 'Text', 'TextField', 'ChoicePicker', 'Button'].includes(value.component)
      || (catalogId === ASSISTANT_A2UI_CATALOG && ['ReportChart', 'ReportSource'].includes(value.component)));
}

export function campusA2uiChildren(component: CampusA2uiComponent): string[] | undefined {
  if (component.component === 'Column' || component.component === 'Row') {
    const { children } = component;
    return Array.isArray(children) && children.length <= MAX_COMPONENTS && children.every(validId) ? children : undefined;
  }
  if (component.component === 'Card' || component.component === 'Button') {
    return validId(component.child) ? [component.child] : undefined;
  }
  return [];
}

function hasRenderableTree(components: Map<string, CampusA2uiComponent>): boolean {
  const visited = new Set<string>();
  const visit = (id: string, depth: number): boolean => {
    if (depth > MAX_DEPTH || visited.has(id)) return false;
    const component = components.get(id);
    if (!component) return false;
    visited.add(id);
    const children = campusA2uiChildren(component);
    if (!children || (component.component === 'Button' && components.get(children[0])?.component !== 'Text')) return false;
    return children.every(child => visit(child, depth + 1));
  };
  return visit('root', 0);
}

function addComponents(surface: CampusA2uiSurfaceState, components: unknown): boolean {
  if (!Array.isArray(components) || !components.length || components.length > MAX_COMPONENTS) return false;
  for (const candidate of components) {
    if (!a2uiComponent(candidate, surface.catalogId)) return false;
    surface.components.set(candidate.id, candidate);
  }
  return surface.components.size <= MAX_COMPONENTS;
}

/** Each owner opts into one local catalog. A map message cannot activate Assistant controls. */
export function readCampusA2uiSurfaces(messages: readonly unknown[], catalog: CampusA2uiCatalog = CAMPUS_A2UI_BASIC_CATALOG): CampusA2uiSurfaceState[] | undefined {
  if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) return;
  const surfaces = new Map<string, CampusA2uiSurfaceState>();
  for (const message of messages) {
    if (!a2uiRecord(message) || message.version !== '1.0' || Object.keys(message).length !== 2) return;
    if (a2uiRecord(message.createSurface)) {
      const { surfaceId, catalogId, sendDataModel, components, dataModel } = message.createSurface;
      if (!validId(surfaceId) || surfaces.has(surfaceId) || catalogId !== catalog || (sendDataModel !== undefined && sendDataModel !== false)
        || (dataModel !== undefined && !a2uiRecord(dataModel))) return;
      const surface = { id: surfaceId, catalogId: catalog, components: new Map<string, CampusA2uiComponent>(), model: dataModel ?? {} };
      if (components !== undefined && !addComponents(surface, components)) return;
      surfaces.set(surfaceId, surface);
    } else if (a2uiRecord(message.updateComponents)) {
      const { surfaceId, components } = message.updateComponents;
      const surface = validId(surfaceId) ? surfaces.get(surfaceId) : undefined;
      if (!surface || !addComponents(surface, components)) return;
    } else if (a2uiRecord(message.updateDataModel)) {
      const { surfaceId, path = '/', value } = message.updateDataModel;
      const surface = validId(surfaceId) ? surfaces.get(surfaceId) : undefined;
      if (!surface || !pointerParts(path) || !Object.hasOwn(message.updateDataModel, 'value')) return;
      surface.model = writeA2uiValue(surface.model, path, value);
    } else if (a2uiRecord(message.deleteSurface)) {
      if (!validId(message.deleteSurface.surfaceId) || !surfaces.delete(message.deleteSurface.surfaceId)) return;
    } else return;
  }
  const result = [...surfaces.values()];
  return result.every(surface => hasRenderableTree(surface.components)) ? result : undefined;
}

function isActionName(name: unknown, catalog: CampusA2uiCatalog): name is ActionName {
  const actions = catalog === ASSISTANT_A2UI_CATALOG ? ASSISTANT_ACTION_NAMES : ACTION_NAMES;
  return actions.some(allowed => allowed === name);
}

export function campusA2uiAction(
  surfaceId: string,
  component: CampusA2uiComponent,
  model: DataModel,
  timestamp = new Date().toISOString(),
  catalog: CampusA2uiCatalog = CAMPUS_A2UI_BASIC_CATALOG,
): CampusA2uiActionMessage | undefined {
  const source = catalog === ASSISTANT_A2UI_CATALOG && component.component === 'ReportSource';
  if ((!source && component.component !== 'Button') || !a2uiRecord(component.action) || !a2uiRecord(component.action.event)) return;
  const { name, context = {}, userMessage } = component.action.event;
  if (!isActionName(name, catalog) || !a2uiRecord(context) || (source && name !== 'open_assistant_source')) return;
  const entries = Object.entries(context).map(([key, value]) => [key, resolveA2uiValue(value, model)] as const);
  if (entries.some(([, value]) => value === undefined)) return;
  const messageText = a2uiText(userMessage, model);
  return {
    version: '1.0',
    action: { name, surfaceId, sourceComponentId: component.id, timestamp, context: Object.fromEntries(entries),
      ...(messageText ? { userMessage: messageText } : {}) },
  };
}

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren, type RefCallback } from 'react';
import { AppState } from 'react-native';
import { useIsFocused, usePathname, useRootNavigationState } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { ApiError, apiFetch, captureApiContext } from '../lib/api';
import { ApiConnectionError } from '../lib/api-client';
import { campusHrefForRoute, focusedCampusRoute, type CampusNavigationState } from '../lib/back-policy';
import { copilotCallId, copilotIsPublishedMapHref, copilotPublishedMapHref, copilotRouteContext, copilotToolNames, copilotToolAvailableOn, readCopilotBatch, readCopilotBuildingSelectionReply, readCopilotWorkflowReply, validCopilotArgs, validInteriorTarget, type CopilotContext, type CopilotResult, type CopilotToolName, type InteriorCheckpoint, type InteriorTarget } from '../lib/copilot';
import { copilotWait, measureCopilotTarget, type CopilotRect, type CopilotTargetNode } from '../lib/copilot-target';

type ActionRegistration = {
  name: CopilotToolName;
  label: string;
  sourceKey?: string;
  destinationPath?: string;
  available: boolean;
  isAtDestination?(args: Record<string, unknown>): boolean;
  run(args: Record<string, unknown>, signal: AbortSignal): boolean | Promise<boolean>;
};
type RegisteredAction = Omit<ActionRegistration, 'available'> & { available(): boolean };
type Lease = { binding: string; generation: number; context: CopilotContext; targets: ReadonlyMap<CopilotToolName, RegisteredAction> };
type Run = { id: string; threadId: string; lease: Lease };
type Activity = { label: string; phase: 'preparing' | 'applying' | 'applied' | 'blocked' | 'stopped'; tool?: CopilotToolName; threadId?: string; step?: number; total?: number };
type Detail = { id: string; threadId: string };
type InteriorSelection = InteriorCheckpoint & { threadId: string; submitting?: boolean; error?: string };
type OwnedInteriorSelection = {
  run: Run; checkpoint: InteriorCheckpoint; scopeKey: string; transport: ReturnType<typeof captureApiContext>;
};
type CopilotBatch = NonNullable<ReturnType<typeof readCopilotBatch>>;
type RevealApp = (atDestination: boolean) => void;
type OwnedDetail = Detail & { binding: string; action: RegisteredAction; generation: number };
type Execution = { run: Run; controller: AbortController; binding: string; tool?: CopilotToolName; callId?: string; destinationPath?: string; applied?: boolean; reportWorkflowOutcome?: (status: CopilotResult['status']) => Promise<unknown> };
type TargetStage = 'before' | 'after';
type TargetOptions = {
  enabled?: boolean;
  stage?: TargetStage;
  reveal?: (node: CopilotTargetNode, signal: AbortSignal) => void | Promise<void>;
};
type TargetRegistration = {
  node(): CopilotTargetNode | null;
  reveal?(node: CopilotTargetNode, signal: AbortSignal): void | Promise<void>;
};
type Pointer = { binding: string; rect: CopilotRect };
type Runtime = {
  registerTarget(tool: CopilotToolName, stage: TargetStage, target: TargetRegistration): () => void;
  pointer: Pointer | null;
  register(action: RegisteredAction): () => void;
  registerCampusTarget(owner: symbol, id: string): () => void;
  context(): CopilotContext | undefined;
  capture(context: CopilotContext): Lease | undefined;
  follow(run: Run): void;
  inspect(id: string, revealApp: RevealApp): void;
  selectInteriorTarget(selection: InteriorTarget, stepId?: string, revealApp?: RevealApp): boolean;
  cancelInteriorSelection(threadId: string, stepId?: string): void;
  interiorSelection: InteriorSelection | null;
  interiorMapActive: boolean;
  interiorMapHref: string;
  takeOver(): void;
  answerDetail(id: string, name: string): Promise<boolean>;
  detail: Detail | null;
  pending: Run | null;
  activity: Activity | null;
};
const noop = () => {};
const RuntimeContext = createContext<Runtime>({
  register: () => noop, registerTarget: () => noop, pointer: null, registerCampusTarget: () => noop, context: () => undefined, capture: () => undefined,
  follow: noop, inspect: noop, selectInteriorTarget: () => false, cancelInteriorSelection: noop, interiorSelection: null, interiorMapActive: false, interiorMapHref: copilotPublishedMapHref(), takeOver: noop, answerDetail: async () => false, detail: null, pending: null, activity: null,
});

const runEndpoint = ({ id, threadId }: Run) => `/api/v1/agent/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(id)}`;
const transientFailure = (error: unknown) => error instanceof ApiConnectionError || (error instanceof ApiError && [502,503,504].includes(error.status));

export function CopilotProvider({ children }: PropsWithChildren) {
  const session = useSession(), pathname = usePathname();
  const tree = useRootNavigationState() as CampusNavigationState | undefined;
  const route = focusedCampusRoute(tree);
  const href = route && tree ? campusHrefForRoute(tree, route.key) ?? pathname : pathname;
  const { screen, identity } = copilotRouteContext(pathname, href);
  // A registered route declares its exact scope selectors. Transient view
  // controls are given to the owning module and do not change this lease.
  const appliedTimetableDate = useRef<string | undefined>(undefined);
  const displayedTimetableDate = useRef<string | undefined>(undefined);
  displayedTimetableDate.current = pathname === '/areas/timetable/schedule' ? new URLSearchParams(href.split('?')[1]).get('date') ?? undefined : undefined;
  const binding = JSON.stringify([session.scopeKey, route?.key, pathname, ...identity]);
  const eligible = session.status === 'authenticated' && session.environment.mode === 'live' && !session.environment.unavailable;
  const current = useRef({ binding, eligible, screen, pathname, campusId: identity[0], scopeKey: session.scopeKey });
  current.current = { binding, eligible, screen, pathname, campusId: identity[0], scopeKey: session.scopeKey };
  const byTool = useRef(new Map<CopilotToolName, Set<Parameters<Runtime['register']>[0]>>());
  const targets = useRef(new Map<string, Set<TargetRegistration>>());
  const active = useRef<Run | null>(null), generation = useRef(0), lastResult = useRef<CopilotResult | undefined>(undefined);
  const execution = useRef<Execution | null>(null);
  const campusTargets = useRef(new Map<symbol, string>());
  const detailOwner = useRef<OwnedDetail | null>(null);
  const interiorOwner = useRef<OwnedInteriorSelection | null>(null);
  const interiorExchange = useRef<AbortController | null>(null);
  const [interiorSelection, setInteriorSelection] = useState<InteriorSelection | null>(null);
  const detailAnswer = useRef<AbortController | null>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [pending, setPending] = useState<Run | null>(null), [activity, setActivity] = useState<Activity | null>(null);
  const mounted = useRef(true);

  const find = useCallback((name: CopilotToolName) => {
    const candidates = [...(byTool.current.get(name) ?? [])].filter(candidate => candidate.available());
    return candidates.length === 1 ? candidates[0] : undefined;
  }, []);
  const register: Runtime['register'] = useCallback(action => {
    const entries = byTool.current.get(action.name) ?? new Set();
    byTool.current.set(action.name, entries); entries.add(action);
    return () => { entries.delete(action); if (!entries.size) byTool.current.delete(action.name); };
  }, []);
  const registerTarget: Runtime['registerTarget'] = useCallback((tool,stage,target) => {
    const key = `${tool}:${stage}`;
    const entries = targets.current.get(key) ?? new Set<TargetRegistration>();
    entries.add(target);
    targets.current.set(key, entries);
    return () => { entries.delete(target); if (!entries.size) targets.current.delete(key); };
  }, []);
  const showTarget = useCallback(async (tool: CopilotToolName, stage: TargetStage, signal: AbortSignal,
    isCurrent: () => boolean) => {
    const key = `${tool}:${stage}`;
    const findTarget = () => {
      const candidates = [...(targets.current.get(key) ?? [])].filter(target => target.node());
      return candidates.length === 1 ? candidates[0] : undefined;
    };
    let target = findTarget();
    for (let attempt=0; !target && stage==='after' && isCurrent() && attempt<9; attempt++) {
      await copilotWait(50, signal);
      target = findTarget();
    }
    const node = target?.node();
    if (!target || !node || !isCurrent()) return false;
    const binding = current.current.binding;
    try {
      if (target.reveal) await Promise.race([target.reveal(node, signal), copilotWait(650,signal)]);
      const rect = await measureCopilotTarget(node, signal);
      if (!rect || !isCurrent() || binding!==current.current.binding || findTarget()!==target || target.node()!==node) return false;
      setPointer({binding,rect});
      return true;
    } catch { return false; }
  }, []);
  const registerCampusTarget: Runtime['registerCampusTarget'] = useCallback((owner,id) => {
    campusTargets.current.set(owner,id);
    return () => { if (campusTargets.current.get(owner)===id) campusTargets.current.delete(owner); };
  }, []);
  const clearDetail = useCallback(() => {
    if (!detailOwner.current) return;
    detailOwner.current=null;setDetail(null);
  },[]);
  const clearInteriorSelection = useCallback(() => {
    interiorExchange.current?.abort();
    interiorExchange.current = null;
    interiorOwner.current = null;
    setInteriorSelection(null);
  }, []);
  const showInteriorSelection = useCallback((owner: OwnedInteriorSelection, state: Pick<InteriorSelection, 'submitting' | 'error'> = {}) => {
    interiorOwner.current = owner;
    setInteriorSelection({ ...owner.checkpoint, threadId: owner.run.threadId, ...state });
  }, []);
  const cancelInteriorSelection: Runtime['cancelInteriorSelection'] = useCallback((threadId, stepId) => {
    const owner = interiorOwner.current;
    if (!owner || owner.run.threadId !== threadId || stepId && owner.checkpoint.step_id !== stepId) return;
    clearInteriorSelection();
    if (!current.current.eligible || current.current.scopeKey !== owner.scopeKey) return;
    try { owner.transport.assertCurrent(); } catch { return; }
    void apiFetch(`${runEndpoint(owner.run)}/interior-selection`, {
      method: 'POST', body: JSON.stringify({ step_id: owner.checkpoint.step_id, cancel: true }),
    }).catch(noop);
  }, [clearInteriorSelection]);
  const context = useCallback((): CopilotContext | undefined => {
    if (!current.current.eligible || AppState.currentState !== 'active') return;
    const tools = copilotToolNames.filter(name => copilotToolAvailableOn(name,current.current.screen) && find(name));
    const result = lastResult.current?.tool === 'open_timetable' && lastResult.current.status === 'applied'
      && (!displayedTimetableDate.current || displayedTimetableDate.current !== appliedTimetableDate.current) ? undefined : lastResult.current;
    if (!tools.length && !result) return;
    const mapped = current.current.screen==='virtual_campus' ? [...new Set(campusTargets.current.values())] : [];
    return { screen: current.current.screen, tools, workflow_steps: true, building_selection: true, ...(mapped.length===1?{campus_id:mapped[0]}:{}),
      ...(result ? { last_result: result } : {}) };
  }, [find]);
  const capture = useCallback((expected: CopilotContext): Lease | undefined => {
    const available = context();
    if (!available || !expected.tools.length || available.screen !== expected.screen || available.campus_id!==expected.campus_id || expected.tools.some(name => !available.tools.includes(name))) return;
    const targets = new Map<CopilotToolName, RegisteredAction>();
    for (const name of expected.tools) {
      const target = find(name);
      if (!target) return;
      targets.set(name, target);
    }
    return { binding: current.current.binding, generation: generation.current, context: expected, targets };
  }, [context, find]);
  const takeOver = useCallback(() => {
    const run = active.current, operation = execution.current, answering = !!detailAnswer.current;
    generation.current++;
    detailAnswer.current?.abort();
    detailAnswer.current = null;
    setPointer(null);
    clearDetail();
    if (!run && !operation && !answering) { setActivity(null); return; }
    operation?.controller.abort(); execution.current = null; active.current = null;
    void operation?.reportWorkflowOutcome?.('stopped').catch(noop);
    if (operation?.tool) lastResult.current = { tool: operation.tool, status: operation.applied ? 'applied' : 'stopped',
      ...(operation.callId ? { call_id: operation.callId } : {}) };
    setPending(null);
    setActivity(previous => previous ? { ...previous, phase: 'stopped' } : null);
  }, [clearDetail]);
  useLayoutEffect(() => {
    if (!mounted.current) return;
    if (interiorOwner.current && (!eligible || interiorOwner.current.scopeKey !== session.scopeKey)) clearInteriorSelection();
    if (detailOwner.current && (!eligible || detailOwner.current.binding!==binding)) { detailAnswer.current?.abort(); clearDetail(); }
    const expected = execution.current?.binding ?? active.current?.lease.binding;
    if (active.current && (!eligible || (expected !== binding && execution.current?.destinationPath !== pathname))) takeOver();
    else if (!active.current && !execution.current) setActivity(previous => previous?.phase === 'applied' ? null : previous);
  }, [binding, eligible, pathname, session.scopeKey, takeOver, clearDetail, clearInteriorSelection]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') takeOver(); });
    return () => {
      mounted.current = false; generation.current++; execution.current?.controller.abort(); detailAnswer.current?.abort();
      active.current = null; execution.current = null; interiorExchange.current?.abort(); interiorOwner.current = null; subscription.remove();
    };
  }, [takeOver]);

  useEffect(() => {
    if (activity?.phase !== 'applied') return;
    const timer = setTimeout(() => {
      setPointer(null);
      setActivity(previous => previous===activity ? null : previous);
    }, 2400);
    return () => clearTimeout(timer);
  }, [activity]);

  const follow = useCallback((run: Run) => {
    if (!current.current.eligible || run.lease.binding !== current.current.binding || run.lease.generation !== generation.current) return;
    if (active.current || execution.current) return;
    active.current = run; setPointer(null); setPending(run); setActivity({ label: 'Assistant is working', phase: 'preparing' });
  }, []);
  const inspect = useCallback((id: string, revealApp: RevealApp, resumed?: CopilotBatch) => {
    const run = active.current;
    if (!run || run.id !== id || execution.current || !current.current.eligible || current.current.binding !== run.lease.binding) return;
    const operation:Execution = { run, controller: new AbortController(), binding:run.lease.binding };
    execution.current = operation;
    const signal = operation.controller.signal, transport = captureApiContext(), scopeKey = current.current.scopeKey;
    const currentLease = () => {
      if (!mounted.current || signal.aborted || !current.current.eligible || current.current.scopeKey !== scopeKey ||
          active.current !== run || run.lease.generation !== generation.current) return false;
      try { transport.assertCurrent(); } catch { return false; }
      return current.current.binding === operation.binding || operation.destinationPath === current.current.pathname;
    };
    const finish = (result?: CopilotResult, label?: string) => {
      if (execution.current !== operation || active.current !== run) return;
      if (result?.status === 'blocked') void operation.reportWorkflowOutcome?.('blocked').catch(noop);
      active.current = null; execution.current = null; setPending(null);
      if (result) lastResult.current = { ...result, ...(operation.callId ? { call_id:operation.callId } : {}) };
      if (result?.status!=='applied') setPointer(null);
      setActivity(result && label ? { label, tool: result.tool, threadId: run.threadId, phase: result.status } : null);
    };
    void (async () => {
      const endpoint = runEndpoint(run);
      try {
        const batch = resumed ?? readCopilotBatch(await apiFetch(`${endpoint}/events`, { signal }), run.threadId, run.id);
        if (!currentLease() || !batch) { finish(); return; }
        if (batch.interiorCheckpoint) {
          if (run.lease.context.building_selection !== true) { finish(); return; }
          showInteriorSelection({ run, checkpoint: batch.interiorCheckpoint, scopeKey, transport });
        }
        const first = batch.plan[0];
        if (!first || !run.lease.context.tools.includes(first.name)) { finish(); return; }
        const staged = !!batch.workflowCallId;
        const stagedInterior = staged && !!resumed && first.name === 'open_campus_interiors';
        if (staged && !stagedInterior && (run.lease.context.workflow_steps !== true || first.name !== 'open_campus_create' || batch.receipts.size)) { finish(); return; }
        if (first.name === 'open_campus_interiors' && first.args.building_id !== undefined && !run.lease.context.building_selection) { finish(); return; }
        const plan = batch.plan;
        clearDetail();
        for (let index=0; index<plan.length; index++) {
          const intent = plan[index]!;
          operation.tool = intent.name; operation.callId=copilotCallId(intent.id)?intent.id:undefined;
          operation.applied = false;
          if (staged) {
            let submitted = false;
            operation.reportWorkflowOutcome = async status => {
              if (submitted || !mounted.current || !current.current.eligible || current.current.scopeKey!==scopeKey) return;
              if (status==='applied' && !currentLease()) return;
              transport.assertCurrent();
              submitted = true;
              const acknowledge = () => apiFetch<unknown>(`${endpoint}/ui-receipt`, {
                method: 'POST', body: JSON.stringify({call_id:intent.id,status}), ...(status==='applied' ? { signal } : {}),
              });
              try { return await acknowledge(); }
              catch (error) {
                if (status!=='applied'||!transientFailure(error)||!currentLease()) throw error;
                // The owner deduplicates the exact receipt. Retrying it never runs the native control again.
                await copilotWait(200,signal);
                if (currentLease()) return acknowledge();
              }
            };
          }
          // React may still be mounting the next owning screen after navigation.
          let action=find(intent.name);
          for (let attempt=0; index>0&&!action&&currentLease()&&attempt<50; attempt++) {
            await copilotWait(100,signal);action=find(intent.name);
          }
          if (!currentLease()) { finish(); return; }
          if (!action || !copilotToolAvailableOn(intent.name,current.current.screen) ||
              index===0 && action!==run.lease.targets.get(intent.name)) {
            finish({tool:intent.name,status:'blocked'},'That control isn’t available on this screen');return;
          }
          setActivity({label:action.label,tool:intent.name,phase:'applying',step:index+1,total:staged && !stagedInterior ? 2 : plan.length});
          if(index===0)revealApp(action.isAtDestination?.(intent.args) === true);
          await copilotWait(140,signal);
          const pointed = await showTarget(intent.name,'before',signal,currentLease);
          if (pointed) await copilotWait(250,signal);
          if (!currentLease() || find(intent.name)!==action || current.current.binding!==operation.binding) {
            finish({tool:intent.name,status:'blocked'},'The screen changed before the step could run');return;
          }
          operation.destinationPath = action.destinationPath;
          const applied = await action.run(intent.args,signal);
          operation.applied = applied;
          if (applied && intent.name==='open_timetable' && typeof intent.args.date==='string') appliedTimetableDate.current=intent.args.date;
          if (!currentLease()) { finish();return; }
          if (!applied) { finish({tool:intent.name,status:'blocked'},action.label);return; }
          operation.binding=current.current.binding;operation.destinationPath=undefined;
          if (staged) {
            // Only a fresh, authorized response to the first receipt may supply the second step.
            if (index===0 && !stagedInterior) await showTarget(intent.name,'after',signal,currentLease);
            if (!currentLease()) { finish(); return; }
            const reply = await operation.reportWorkflowOutcome?.('applied');
            if (!currentLease()) { finish(); return; }
            const next = readCopilotWorkflowReply(reply,run.threadId,run.id,intent);
            if (!next || next.kind==='step' && (stagedInterior || index!==0)) {
              finish({tool:intent.name,status:'blocked'},'The next campus setup step could not be confirmed');return;
            }
            if (next.kind==='step') {
              plan.push(next.intent);
              continue;
            }
            if (next.status!=='applied' || index===0 && !stagedInterior) {
              finish({tool:intent.name,status:'blocked'},stagedInterior ? 'Opening the building could not be confirmed' : 'The campus form could not be prepared');return;
            }
          }
          const final = index===plan.length-1;
          if(final && intent.name==='prepare_campus_create' && intent.args.name===undefined && copilotCallId(intent.id)) {
            const request={id:intent.id,threadId:run.threadId};
            detailOwner.current={...request,binding:operation.binding,generation:generation.current,action};
            setDetail(request);
            // The detail surface expands the dock. Reveal the actual field in
            // the resulting workspace viewport before positioning the pointer.
            await copilotWait(120,signal);
          }
          await showTarget(intent.name,'after',signal,currentLease);
          if (!currentLease()) { finish();return; }
          if(final) finish({tool:intent.name,status:'applied'},action.label);
        }
      } catch {
        if (currentLease() && operation.tool) finish({ tool: operation.tool, status: 'blocked' }, 'The control could not be updated');
        else finish();
      }
    })();
  }, [find, clearDetail, showTarget, showInteriorSelection]);
  const selectInteriorTarget: Runtime['selectInteriorTarget'] = useCallback((selection, stepId, revealApp = noop) => {
    const owner = interiorOwner.current;
    if (!owner || !validInteriorTarget(selection) || stepId && owner.checkpoint.step_id !== stepId ||
        !current.current.eligible || current.current.scopeKey !== owner.scopeKey || AppState.currentState !== 'active' ||
        active.current || execution.current) return false;
    if (!stepId && current.current.screen !== 'virtual_campus') return false;
    if (stepId && !owner.checkpoint.options.some(option => option.campus_id === selection.campus_id && option.element_id === selection.element_id)) return false;
    try { owner.transport.assertCurrent(); } catch { return false; }
    if (interiorExchange.current) return true;
    const controller = new AbortController(), { signal } = controller;
    const startBinding = current.current.binding;
    const isCurrent = () => {
      if (!mounted.current || signal.aborted || !current.current.eligible ||
          interiorOwner.current !== owner || current.current.scopeKey !== owner.scopeKey) return false;
      try { owner.transport.assertCurrent(); return true; } catch { return false; }
    };
    const endpoint = runEndpoint(owner.run);
    const post = () => apiFetch(`${endpoint}/interior-selection`, {
      method: 'POST', body: JSON.stringify({ step_id: owner.checkpoint.step_id, selection }), signal,
    });
    interiorExchange.current = controller;
    showInteriorSelection(owner, { submitting: true });
    void (async () => {
      try {
        let response: unknown;
        try { response = await post(); }
        catch (error) {
          if (!transientFailure(error) || !isCurrent()) throw error;
          await copilotWait(200, signal);
          if (!isCurrent()) return;
          response = await post();
        }
        if (!isCurrent()) return;
        const next = readCopilotBuildingSelectionReply(response, owner.run.threadId, owner.run.id, owner.checkpoint.step_id, selection);
        if (!next) { showInteriorSelection(owner, { error: 'Try selecting the building again.' }); return; }
        if (next.kind === 'wait') { showInteriorSelection({ ...owner, checkpoint: next.checkpoint }); return; }
        clearInteriorSelection();
        if (next.kind === 'finished') return;
        const { id, name } = next.batch.plan[0]!;
        const available = context(), lease = available && capture(available);
        const selectedCampusNavigation = !selection.element_id && current.current.screen === 'virtual_campus' &&
          (current.current.campusId === selection.campus_id || available?.campus_id === selection.campus_id);
        if (!lease?.context.tools.includes(name) || startBinding !== current.current.binding && !selectedCampusNavigation) {
          void apiFetch(`${endpoint}/ui-receipt`, {
            method: 'POST', body: JSON.stringify({ call_id: id, status: 'blocked' }),
          }).catch(noop);
          setActivity({ label: 'Open Virtual Campus to continue with the building', tool: name, threadId: owner.run.threadId, phase: 'blocked' });
          return;
        }
        follow({ id: owner.run.id, threadId: owner.run.threadId, lease });
        inspect(owner.run.id, revealApp, next.batch);
      } catch {
        if (isCurrent()) showInteriorSelection(owner, { error: 'The selection could not be confirmed. Try again.' });
      } finally {
        if (interiorExchange.current === controller) interiorExchange.current = null;
      }
    })();
    return true;
  }, [capture, clearInteriorSelection, context, follow, inspect, showInteriorSelection]);
  const answerDetail = useCallback(async (id:string,name:string) => {
    const request=detailOwner.current,args={name:name.trim()};
    if (execution.current || detailAnswer.current || !request || request.id!==id || request.binding!==current.current.binding ||
        request.generation!==generation.current || !current.current.eligible ||
        find('prepare_campus_create')!==request.action || !validCopilotArgs('prepare_campus_create',args)) return false;
    const transport=captureApiContext(), controller=new AbortController();
    detailAnswer.current = controller;
    const isCurrent = () => {
      if (controller.signal.aborted || detailOwner.current!==request || current.current.binding!==request.binding ||
          !current.current.eligible || find('prepare_campus_create')!==request.action) return false;
      try { transport.assertCurrent(); return true; } catch { return false; }
    };
    try {
      setActivity({label:'Fill campus name',phase:'applying',tool:'prepare_campus_create'});
      const pointed=await showTarget('prepare_campus_create','after',controller.signal,isCurrent);
      if (pointed) await copilotWait(250,controller.signal);
      if (!isCurrent() || !await request.action.run(args,controller.signal) || !isCurrent()) return false;
      clearDetail();setActivity({label:'Campus name added',phase:'applied',tool:'prepare_campus_create'});
      return true;
    } catch { return false; }
    finally {
      if (detailAnswer.current===controller) {
        detailAnswer.current=null;
        setActivity(previous=>previous?.phase==='applying'&&previous.tool==='prepare_campus_create'
          ? { label:'Enter the campus name in the form', phase:'blocked', tool:'prepare_campus_create' } : previous);
      }
    }
  },[find,clearDetail,showTarget]);

  const currentPointer = eligible && pointer?.binding===binding ? pointer : null;
  const matchingInteriorSelection = eligible && interiorOwner.current?.scopeKey === session.scopeKey ? interiorSelection : null;
  const interiorMapActive = copilotIsPublishedMapHref(pathname, href);
  const interiorMapHref = copilotPublishedMapHref(identity[0] ?? undefined);
  const value = useMemo(() => ({ register, registerTarget, pointer:currentPointer, registerCampusTarget, context, capture, follow, inspect, takeOver, answerDetail, detail, pending, activity, selectInteriorTarget, cancelInteriorSelection, interiorSelection: matchingInteriorSelection, interiorMapActive, interiorMapHref }),
    [register, registerTarget, currentPointer, registerCampusTarget, context, capture, follow, inspect, takeOver, answerDetail, detail, pending, activity, selectInteriorTarget, cancelInteriorSelection, matchingInteriorSelection, interiorMapActive, interiorMapHref]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useCopilot() { return useContext(RuntimeContext); }
export function useCopilotTakeOver() { return useCopilot().takeOver; }

export function useCopilotAction(action: ActionRegistration) {
  const { register } = useCopilot(), focused = useIsFocused();
  const current = useRef({ action, focused }); current.current = { action, focused };
  useLayoutEffect(() => register({
    name: action.name, label: action.label, destinationPath: action.destinationPath,
    available: () => current.current.focused && current.current.action.available,
    isAtDestination: args => current.current.action.isAtDestination?.(args) === true,
    run: (args, signal) => !signal.aborted && current.current.focused && current.current.action.available
      && current.current.action.run(args, signal),
  }), [register, action.name, action.label, action.sourceKey, action.destinationPath]);
}

export function useCopilotCampusTarget(campusId:string | undefined) {
  const { registerCampusTarget }=useCopilot(), focused=useIsFocused(), owner=useRef(Symbol('campus-selection'));
  useLayoutEffect(()=>focused&&campusId&&copilotCallId(campusId)?registerCampusTarget(owner.current,campusId):undefined,
    [campusId,focused,registerCampusTarget]);
}

export function useCopilotActiveAction(tool: CopilotToolName) {
  const { activity } = useCopilot(), focused = useIsFocused();
  return focused && activity?.tool === tool && (activity.phase === 'applying' || activity.phase === 'applied');
}

/** A mounted owner can expose a visual anchor without adding an action or changing its permissions. */
export function useCopilotTarget(tool: CopilotToolName, options: TargetOptions = {}): RefCallback<CopilotTargetNode> {
  const { registerTarget } = useCopilot(), focused = useIsFocused(), stage = options.stage ?? 'before';
  const node = useRef<CopilotTargetNode | null>(null);
  const latest = useRef({ options, focused });
  latest.current = { options, focused };
  useLayoutEffect(() => registerTarget(tool, stage, {
    node: () => latest.current.focused && latest.current.options.enabled!==false ? node.current : null,
    reveal: (target, signal) => latest.current.options.reveal?.(target, signal),
  }), [registerTarget, tool, stage]);
  return useCallback(target => { node.current = target; }, []);
}

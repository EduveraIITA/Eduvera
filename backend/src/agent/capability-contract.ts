import { z } from 'zod';

/** One contract drives model tools, execution policy, receipts and UI presentation. */
export const CAPABILITY_CONTRACT_VERSION = '2026-10-09.2';

export const effectClass = z.enum(['observe','low_impact','consequential','restricted']);
export const controlMode = z.enum(['autonomous','monitored','approval','handoff']);
export const presentationKind = z.enum(['answer','chart','receipt','action_review','handoff']);

export type EffectClass = z.infer<typeof effectClass>;
export type ControlMode = z.infer<typeof controlMode>;
export type PresentationKind = z.infer<typeof presentationKind>;

export interface CapabilityContract {
  version: typeof CAPABILITY_CONTRACT_VERSION;
  effect: EffectClass;
  control: ControlMode;
  presentation: PresentationKind;
  /** Plain-language outcome shown to people. Never put model instructions here. */
  summary: string;
  confirmationLabel?: string;
  reversibleWith?: string;
}

const contractSchema = z.object({
  version: z.literal(CAPABILITY_CONTRACT_VERSION),
  effect: effectClass,
  control: controlMode,
  presentation: presentationKind,
  summary: z.string().trim().min(3).max(240),
  confirmationLabel: z.string().trim().min(2).max(40).optional(),
  reversibleWith: z.string().regex(/^[a-z_]+$/).optional(),
}).strict().superRefine((value,context) => {
  const allowed: Record<EffectClass,ControlMode[]> = {
    observe:['autonomous'],
    low_impact:['monitored','approval'],
    consequential:['approval'],
    restricted:['handoff'],
  };
  if(!allowed[value.effect].includes(value.control))context.addIssue({code:'custom',path:['control'],message:`${value.effect} capabilities cannot use ${value.control} control`});
  if(value.control==='monitored'&&value.presentation!=='receipt')context.addIssue({code:'custom',path:['presentation'],message:'Monitored actions must return a receipt.'});
  if(value.control==='approval'&&value.presentation!=='action_review')context.addIssue({code:'custom',path:['presentation'],message:'Approval actions must render an action review.'});
});

function checked(value:CapabilityContract):CapabilityContract {
  const parsed=contractSchema.parse(value);
  return {version:parsed.version,effect:parsed.effect,control:parsed.control,presentation:parsed.presentation,summary:parsed.summary,
    ...(parsed.confirmationLabel?{confirmationLabel:parsed.confirmationLabel}:{}),...(parsed.reversibleWith?{reversibleWith:parsed.reversibleWith}:{})};
}

export function observed(summary:string,presentation:'answer'|'chart'='answer'):CapabilityContract {
  return checked({version:CAPABILITY_CONTRACT_VERSION,effect:'observe',control:'autonomous',presentation,summary});
}

export function reviewed(summary:string,confirmationLabel='Confirm'):CapabilityContract {
  return checked({version:CAPABILITY_CONTRACT_VERSION,effect:'consequential',control:'approval',presentation:'action_review',summary,confirmationLabel});
}

export function monitored(summary:string,reversibleWith?:string):CapabilityContract {
  return checked({version:CAPABILITY_CONTRACT_VERSION,effect:'low_impact',control:'monitored',presentation:'receipt',summary,...(reversibleWith?{reversibleWith}:{})});
}

export function humanOnly(summary:string):CapabilityContract {
  return checked({version:CAPABILITY_CONTRACT_VERSION,effect:'restricted',control:'handoff',presentation:'handoff',summary});
}

export interface CapabilityDescriptor {
  name:string;
  title:string;
  domain:string;
  description:string;
  permission?:string;
  contract:CapabilityContract;
  schema:z.ZodObject;
  toolSchema?:z.ZodObject;
  prepare?:{read:string};
}

/** Permission-scoped operating knowledge returned by find_tools and status. */
export function capabilityManifest(capability:CapabilityDescriptor) {
  const schema=z.toJSONSchema(capability.toolSchema??capability.schema,{io:'input',unrepresentable:'any'}) as {properties?:Record<string,unknown>;required?:string[]};
  return {
    name:capability.name,
    title:capability.title,
    domain:capability.domain,
    purpose:capability.description,
    effect:capability.contract.effect,
    control:capability.contract.control,
    presentation:capability.contract.presentation,
    outcome:capability.contract.summary,
    inputs:Object.keys(schema.properties??{}),
    required_inputs:schema.required??[],
    ...(capability.prepare?{reads_before_change:capability.prepare.read}:{}),
    ...(capability.contract.reversibleWith?{reversible_with:capability.contract.reversibleWith}:{}),
    access:capability.permission??'portal_and_record_scope',
  };
}

export function modelToolDescription(capability:CapabilityDescriptor) {
  // Execution policy is consumed by the server, not a prohibition for the model.
  // The operation's actual result tells the assistant whether it is complete,
  // needs details, or has opened a review/screen.
  return capability.description;
}

export function summarizeCapabilityPolicy(capabilities:readonly CapabilityDescriptor[]) {
  const controls={autonomous:0,monitored:0,approval:0,handoff:0};
  const domains=new Map<string,{total:number;autonomous:number;monitored:number;approval:number;handoff:number}>();
  for(const capability of capabilities) {
    controls[capability.contract.control]++;
    const domain=domains.get(capability.domain)??{total:0,autonomous:0,monitored:0,approval:0,handoff:0};
    domain.total++;domain[capability.contract.control]++;
    domains.set(capability.domain,domain);
  }
  return {version:CAPABILITY_CONTRACT_VERSION,controls,domains:Object.fromEntries([...domains.entries()].sort(([a],[b])=>a.localeCompare(b)))};
}

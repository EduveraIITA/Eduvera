export type ChannelProviderName = 'telegram'|'whatsapp';

export interface NormalizedChannelUpdate {
  provider:ChannelProviderName;
  updateId:string;
  externalUserId:string;
  externalChatId:string;
  messageId:string;
  senderLabel:string;
  text:string;
  linkToken?:string;
}

export interface ChannelSendInput {
  externalChatId:string;
  text:string;
  action?:{label:string;url:string};
}

export interface ChannelSendResult {
  messageIds:string[];
}

/** A provider acknowledgement can be lost after acceptance. Never infer rejection. */
export class ChannelDeliveryError extends Error {
  constructor(readonly acceptance:'rejected'|'unknown') {
    super(acceptance==='rejected'?'Channel delivery was rejected.':'Channel delivery acknowledgement is uncertain.');
    this.name='ChannelDeliveryError';
  }
}
export class UncertainChannelDeliveryError extends Error {
  constructor(){super('Open the assistant in ThatCampus to read this reply. Delivery was not retried because its acknowledgement is uncertain.');this.name='UncertainChannelDeliveryError';}
}
export interface ChannelDeliveryCheckpoint {
  /** Serialize each provider call with link revocation/replacement, not the model wait. */
  withPart?<T>(send:()=>Promise<T>):Promise<T>;
  /** null claims an unsent part; a message ID reuses an already acknowledged part. */
  beforePart(index:number,count:number,input:ChannelSendInput):Promise<string|null>;
  accepted(index:number,messageId:string):Promise<void>;
  failed(index:number,acceptance:'rejected'|'unknown'):Promise<void>;
}

export interface MessagingChannelProvider {
  readonly name:ChannelProviderName;
  initialize?():Promise<void>;
  configured():boolean;
  publicIdentity():{name:ChannelProviderName;configured:boolean;label:string;username?:string};
  connectionUrl(token:string):string;
  parseWebhook(secret:string|undefined,body:unknown):NormalizedChannelUpdate|null;
  send(input:ChannelSendInput,checkpoint?:ChannelDeliveryCheckpoint):Promise<ChannelSendResult>;
  registerWebhook?():Promise<void>;
}

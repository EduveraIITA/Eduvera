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

export interface MessagingChannelProvider {
  readonly name:ChannelProviderName;
  initialize?():Promise<void>;
  configured():boolean;
  publicIdentity():{name:ChannelProviderName;configured:boolean;label:string;username?:string};
  connectionUrl(token:string):string;
  parseWebhook(secret:string|undefined,body:unknown):NormalizedChannelUpdate|null;
  send(input:ChannelSendInput):Promise<ChannelSendResult>;
  registerWebhook?():Promise<void>;
}

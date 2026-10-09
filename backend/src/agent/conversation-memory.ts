export interface MemoryTurn {
  id:string;
  question:string;
  answer:string;
  status:string;
  action_status:string|null;
}

/** Provider-neutral, conservative estimate for deciding when to compact. */
export function estimateConversationTokens(value:string) {
  return Math.max(1,Math.ceil(Buffer.byteLength(value,'utf8')/3));
}

export function serializedTurn(turn:MemoryTurn) {
  const outcome=turn.action_status?` Action outcome: ${turn.action_status}.`:'';
  const answer=turn.answer.length>12_000?turn.answer.slice(0,12_000)+' [answer truncated for memory]':turn.answer;
  return `User: ${turn.question}\nAssistant: ${answer || `[${turn.status}]`}.${outcome}`;
}

export function needsConversationCompaction(summary:string,turns:readonly MemoryTurn[],contextWindowTokens:number) {
  const content=[summary,...turns.map(serializedTurn)].filter(Boolean).join('\n\n');
  return estimateConversationTokens(content)>Math.floor(contextWindowTokens*.30);
}

/** Detect long histories from database byte totals without loading them into the prompt. */
export function needsStoredConversationCompaction(summary:string,unsummarizedBytes:number,contextWindowTokens:number) {
  const storedTokens=Math.ceil(Math.max(0,unsummarizedBytes)/3);
  return estimateConversationTokens(summary)+storedTokens>Math.floor(contextWindowTokens*.30);
}

/**
 * Compact the oldest useful chunk while retaining recent turns verbatim. The
 * selected chunk is also bounded so the summarizer itself cannot overflow a
 * smaller local model.
 */
export function turnsToCompact(summary:string,turns:readonly MemoryTurn[],contextWindowTokens:number,force=false) {
  if((!force&&!needsConversationCompaction(summary,turns,contextWindowTokens))||!turns.length)return [];
  const recentBudget=Math.max(300,Math.floor(contextWindowTokens*.10));
  let recentTokens=0;let keepFrom=turns.length;
  for(let index=turns.length-1;index>=0;index--) {
    const tokens=estimateConversationTokens(serializedTurn(turns[index]!));
    if(index<turns.length-2&&recentTokens+tokens>recentBudget)break;
    recentTokens+=tokens;keepFrom=index;
  }
  let selected=turns.slice(0,keepFrom);
  if(!selected.length)selected=[turns[0]!];
  const inputBudget=Math.max(800,Math.floor(contextWindowTokens*.22));
  const bounded:MemoryTurn[]=[];let tokens=estimateConversationTokens(summary);
  for(const turn of selected) {
    const size=estimateConversationTokens(serializedTurn(turn));
    if(bounded.length&&tokens+size>inputBudget)break;
    bounded.push(turn);tokens+=size;
  }
  return bounded;
}

export function conversationSummaryPrompt(summary:string,turns:readonly MemoryTurn[]) {
  return `Create durable conversation memory for a school-app agent. Keep only user goals, preferences, explicit corrections, unresolved questions, and receipt-level completed outcomes. Preserve the distinction between proposed, rejected, failed and succeeded actions. Never turn a proposal into a fact. Do not include database IDs, tool arguments, passwords, contact details, precise locations, marks, attendance values or other school-record facts; those must be re-read under current access. Do not add advice or new facts. Use concise plain text under 500 words.\n\nExisting memory:\n${summary||'None'}\n\nTurns to compact:\n${turns.map(serializedTurn).join('\n\n')}`;
}

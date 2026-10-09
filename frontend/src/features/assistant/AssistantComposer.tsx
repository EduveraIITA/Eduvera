import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ArrowUp, Square } from 'lucide-react';
export function useAssistantKeyboard(ref:RefObject<HTMLElement|null>) {
  useEffect(()=>{
    const viewport=window.visualViewport;
    const fit=()=>ref.current?.style.setProperty('--assistant-keyboard',String(viewport?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0)+'px');
    fit();viewport?.addEventListener('resize',fit);viewport?.addEventListener('scroll',fit);
    return()=>{viewport?.removeEventListener('resize',fit);viewport?.removeEventListener('scroll',fit);};
  },[ref]);
}
export function AssistantComposer({onSend,disabled=false,pending=false,onCancel}:{onSend:(question:string,clientId:string)=>Promise<boolean>;disabled?:boolean;pending?:boolean;onCancel:()=>void}) {
  const [draft,setDraft]=useState('');
  const [sending,setSending]=useState(false);
  const client=useRef({question:'',id:crypto.randomUUID()});
  const input=useRef<HTMLTextAreaElement>(null);
  const id=useId();
  useEffect(()=>{if(input.current){input.current.style.height='auto';input.current.style.height=String(Math.min(input.current.scrollHeight,96))+'px';}},[draft]);
  const submit=async(event:FormEvent)=>{
    event.preventDefault();const question=draft.trim();
    if(!question||pending||disabled||sending)return;
    if(client.current.question!==question)client.current={question,id:crypto.randomUUID()};
    setSending(true);
    try {if(await onSend(question,client.current.id)){setDraft('');client.current={question:'',id:crypto.randomUUID()};}}
    finally {setSending(false);}
  };
  return <form className="assistant-composer" onSubmit={event=>void submit(event)}>
    <label className="sr-only" htmlFor={id+'-question'}>Ask the assistant</label>
    <textarea ref={input} id={id+'-question'} rows={1} maxLength={4000} placeholder="Ask anything…" value={draft} disabled={disabled||sending}
      onChange={event=>setDraft(event.target.value)} aria-describedby={id+'-hint'}
      onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit(event);}}}/>
    {pending?<button type="button" onClick={onCancel} aria-label="Stop request"><Square size={17} fill="currentColor" aria-hidden="true"/></button>:<button type="submit" disabled={disabled||sending||!draft.trim()} aria-label="Send message"><ArrowUp size={21} aria-hidden="true"/></button>}
    <span className="sr-only" id={id+'-hint'}>Enter sends. Shift and Enter adds a new line. Changes require your confirmation.</span>
  </form>;
}

import { GripVertical } from 'lucide-react';
import { useRef, type PointerEvent } from 'react';
import type { DropPosition, OrganizationNode } from './api';

export interface DropTarget { id: string | null; position: DropPosition }

function targetAt(x: number,y: number): DropTarget | null {
  const element = document.elementFromPoint(x,y);
  if (element?.closest('[data-org-drop-root]')) return {id:null,position:'root'};
  const row = element?.closest<HTMLElement>('[data-org-node]');
  if (!row) return null;
  const bounds = row.getBoundingClientRect();
  const fraction = (y-bounds.top)/bounds.height;
  return {id:row.dataset.orgNode!,position:fraction < .25 ? 'before' : fraction > .75 ? 'after' : 'inside'};
}

export function OrganizationMoveHandle({node,nodes,disabled,onMove,onPreview,onDetails}:{
  node: OrganizationNode; nodes: OrganizationNode[]; disabled: boolean;
  onMove:(id:string,target:string|null,position:DropPosition)=>void;
  onPreview:(id:string|null,target:DropTarget|null)=>void;
  onDetails:()=>void;
}) {
  const gesture = useRef<{x:number;y:number;pointer:number;moving:boolean}|null>(null);
  const skipClick = useRef(false);
  const clear = () => {gesture.current=null;onPreview(null,null);};
  const finish = (event:PointerEvent<HTMLButtonElement>) => {
    const current=gesture.current;
    if (!current || current.pointer!==event.pointerId) return;
    skipClick.current=current.moving;
    if (current.moving && !disabled) {
      const target=targetAt(event.clientX,event.clientY);
      if(target) onMove(node.id,target.id,target.position);
    }
    clear();
  };
  return <button type="button" className="organization-drag-handle" disabled={disabled}
    data-org-handle={node.id} aria-label={`Move ${node.name}`} aria-describedby="organization-drag-help"
    onClick={() => {if(!skipClick.current)onDetails();skipClick.current=false;}}
    onPointerDown={event=>{
      if(disabled || event.button!==0 || !event.isPrimary)return;
      skipClick.current=false;
      gesture.current={x:event.clientX,y:event.clientY,pointer:event.pointerId,moving:false};
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event=>{
      const current=gesture.current;
      if(!current || current.pointer!==event.pointerId)return;
      if(Math.hypot(event.clientX-current.x,event.clientY-current.y)>6) current.moving=true;
      if(current.moving){
        onPreview(node.id,targetAt(event.clientX,event.clientY));
        if(event.clientY<80)window.scrollBy(0,-16);
        else if(event.clientY>window.innerHeight-80)window.scrollBy(0,16);
      }
    }}
    onPointerUp={finish} onPointerCancel={clear} onLostPointerCapture={clear}
    onKeyDown={event=>{
      if(event.key==='Escape'){clear();return;}
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();
      const siblings=nodes.filter(item=>item.parent_id===node.parent_id);
      const index=siblings.findIndex(item=>item.id===node.id);
      if(event.key==='ArrowUp' && index>0)onMove(node.id,siblings[index-1]!.id,'before');
      if(event.key==='ArrowDown' && index<siblings.length-1)onMove(node.id,siblings[index+1]!.id,'after');
      if(event.key==='ArrowRight' && index>0)onMove(node.id,siblings[index-1]!.id,'inside');
      if(event.key==='ArrowLeft' && node.parent_id)onMove(node.id,node.parent_id,'after');
      requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-org-handle="${node.id}"]`)?.focus({preventScroll:true}));
    }}><GripVertical size={18} aria-hidden="true"/></button>;
}

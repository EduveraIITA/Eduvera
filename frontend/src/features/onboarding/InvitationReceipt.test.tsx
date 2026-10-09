import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvitationReceipt } from './InvitationReceipt';

const invitation={email:'recipient@example.test',token:'012345',expires_at:'2099-10-04',delivery:'email_accepted' as const};
afterEach(()=>{cleanup();vi.useRealTimers();});

function Confirmation(){
  const [open,setOpen]=useState(true);
  return open?<InvitationReceipt invite={invitation} onClose={()=>setOpen(false)}/>:null;
}

describe('invitation success popup',()=>{
  it('opens above the page with the recipient, focuses close and auto-dismisses',async()=>{
    vi.useFakeTimers();
    const {container}=render(<Confirmation/>);
    const popup=screen.getByRole('dialog',{name:'Invitation sent'});
    expect(popup.parentElement).toBe(document.body);
    expect(container).not.toContainElement(popup);
    expect(popup).toHaveAttribute('aria-modal','true');
    expect(screen.getByRole('status')).toHaveTextContent(invitation.email);
    expect(screen.queryByText(invitation.token)).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Dismiss invitation notification'})).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    await act(()=>vi.advanceTimersByTime(3999));
    expect(popup).toBeInTheDocument();
    await act(()=>vi.advanceTimersByTime(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });
  it.each(['close','escape'])('dismisses immediately with %s and restores focus',method=>{
    const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();
    render(<Confirmation/>);
    if(method==='close')fireEvent.click(screen.getByRole('button',{name:'Dismiss invitation notification'}));
    else fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:false,cancelable:true}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();trigger.remove();
  });
  it('keeps its dismissal deadline when the page refreshes',async()=>{
    vi.useFakeTimers();const onClose=vi.fn();
    const {rerender}=render(<InvitationReceipt invite={invitation} onClose={()=>{}}/>);
    await act(()=>vi.advanceTimersByTime(2000));
    rerender(<InvitationReceipt invite={invitation} onClose={onClose}/>);
    await act(()=>vi.advanceTimersByTime(2000));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('clears the timer when navigating away',async()=>{
    vi.useFakeTimers();const onClose=vi.fn();
    const {unmount}=render(<InvitationReceipt invite={invitation} onClose={onClose}/>);
    unmount();await act(()=>vi.advanceTimersByTime(5000));
    expect(onClose).not.toHaveBeenCalled();
  });
  it.each(['failed','manual'] as const)('keeps %s delivery visible inline without a success popup',async delivery=>{
    vi.useFakeTimers();const onClose=vi.fn();
    render(<InvitationReceipt invite={{...invitation,delivery}} onClose={onClose}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Invitation not sent');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(()=>vi.advanceTimersByTime(5000));expect(onClose).not.toHaveBeenCalled();
  });
});

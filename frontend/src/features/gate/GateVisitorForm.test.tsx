import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { GateVisitorForm } from './GateVisitorForm';
import { VisitorApprovalPrompt } from './VisitorApprovalPrompt';
const submit=vi.fn();
beforeEach(()=>{submit.mockReset();URL.createObjectURL=vi.fn(()=> 'blob:visitor-preview');URL.revokeObjectURL=vi.fn();});
afterEach(cleanup);
it('submits direct entry without a host and approval with a host and photo',async()=>{
 const {container}=render(<GateVisitorForm hosts={[{id:'host',name:'Meera'}]} hindi={false} busy={false} onSubmit={submit}/>);
 fireEvent.change(screen.getByLabelText('Visitor name'),{target:{value:'Visitor Test'}});
 fireEvent.change(screen.getByLabelText('Mobile number'),{target:{value:'9876543210'}});
 fireEvent.change(screen.getByLabelText('Purpose of visit'),{target:{value:'Document delivery'}});
 fireEvent.click(screen.getByRole('button',{name:'Record visitor entry'}));
 expect((submit.mock.calls[0][0] as FormData).get('host_user_id')).toBe('');
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'host'}});
 const photo=new File(['photo'],'visitor.jpg',{type:'image/jpeg'});
 fireEvent.change(container.querySelector('input[type=file]')!,{target:{files:[photo]}});
 expect(await screen.findByAltText('Visitor photo preview')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Request approval'}));
 const form=submit.mock.calls[1][0] as FormData;expect(form.get('host_user_id')).toBe('host');expect(form.get('photo')).toBe(photo);
 fireEvent.click(screen.getByRole('button',{name:'Remove photo'}));
 await waitFor(()=>expect(screen.queryByAltText('Visitor photo preview')).not.toBeInTheDocument());
});
it('rejects unsupported photos and allows entry when no hosts exist',()=>{
 const {container}=render(<GateVisitorForm hosts={[]} hindi={false} busy={false} onSubmit={submit}/>);
 fireEvent.change(container.querySelector('input[type=file]')!,{target:{files:[new File(['<svg/>'],'visitor.svg',{type:'image/svg+xml'})]}});
 expect(screen.getByRole('alert')).toHaveTextContent('JPEG or PNG');
 expect(screen.getByRole('button',{name:'Record visitor entry'})).toBeEnabled();
});
it('shows the visitor photo before the host decides',()=>{
 render(<VisitorApprovalPrompt visitor={{id:'visitor',school_id:'school',name:'Visitor Test',purpose:'Meeting',revision:1,state:'pending',photo_url:'/api/v1/gate/schools/school/visitors/visitor/photo/'}} hindi={false} busy={false} error="" outcome={null} onComplete={vi.fn()} onLater={vi.fn()} onDecide={vi.fn()} onRetry={vi.fn()}/>);
 expect(screen.getByAltText('Photo of Visitor Test')).toHaveAttribute('src','/api/v1/gate/schools/school/visitors/visitor/photo/');
 expect(screen.getByRole('button',{name:'Approve',exact:true})).toBeEnabled();
});

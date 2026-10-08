import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateFeedback } from './CreateFeedback';
import { RespondFeedback } from './RespondFeedback';
import { FeedbackResults } from './FeedbackResults';
import { createCampaign, getResults, submitFeedback, type Campaign, type Workspace } from './api';
vi.mock('./api',()=>({createCampaign:vi.fn(),getResults:vi.fn(),submitFeedback:vi.fn()}));
const campaign:Campaign={id:'campaign',title:'Teaching check-in',teacher_name:'Anita Sharma',class_name:'7A',audience:'students',parameters:['Punctuality','Teaching clarity'],closes_at:'2026-12-01T10:00:00Z',is_closed:false,response_count:0};
const workspace:Workspace={teachers:[{id:'teacher',name:'Anita Sharma'}],classes:[{id:'class',grade:'7',section:'A',academic_year:'2026-27'}],campaigns:[],default_parameters:campaign.parameters};
beforeEach(()=>vi.clearAllMocks());afterEach(cleanup);
describe('quick teacher feedback',()=>{
  it('requires a response per parameter and submits keyboard-accessible ratings',async()=>{
    const user=userEvent.setup();const done=vi.fn(async()=>{});vi.mocked(submitFeedback).mockResolvedValue({submitted:true});
    render(<RespondFeedback school="school" campaign={campaign} onSubmitted={done}/>);
    expect(screen.getByRole('button',{name:'Submit feedback'})).toBeDisabled();
    await user.click(within(screen.getByRole('group',{name:'Punctuality'})).getByRole('radio',{name:'Low'}));
    await user.click(within(screen.getByRole('group',{name:'Teaching clarity'})).getByRole('radio',{name:'Not sure'}));
    await user.click(screen.getByRole('button',{name:'Submit feedback'}));
    expect(submitFeedback).toHaveBeenCalledWith('school','campaign',{'Punctuality':'low','Teaching clarity':'na'});
    expect(await screen.findByText('Thank you for your feedback')).toBeVisible();expect(done).toHaveBeenCalledOnce();
  });
  it('retains answers when submission fails',async()=>{
    const user=userEvent.setup();vi.mocked(submitFeedback).mockRejectedValue(new Error('Connection lost'));
    render(<RespondFeedback school="school" campaign={campaign} onSubmitted={async()=>{}}/>);
    for(const group of screen.getAllByRole('group'))await user.click(within(group).getByRole('radio',{name:'High'}));
    await user.click(screen.getByRole('button',{name:'Submit feedback'}));expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.getAllByRole('radio',{name:'High'}).every(r=>(r as HTMLInputElement).checked)).toBe(true);
  });
  it('lets the principal publish custom parameters and an audience',async()=>{
    const user=userEvent.setup();vi.mocked(createCampaign).mockResolvedValue({id:'campaign'});const created=vi.fn(async()=>{});
    render(<CreateFeedback school="school" data={workspace} onCreated={created} onCancel={()=>{}}/>);
    await user.selectOptions(screen.getByLabelText('Teacher'),'teacher');await user.selectOptions(screen.getByLabelText('Class'),'class');await user.selectOptions(screen.getByLabelText('Ask'),'parents');
    await user.type(screen.getByLabelText('Custom parameter'),'Practical examples');await user.click(screen.getByRole('button',{name:'Add'}));
    await user.type(screen.getByLabelText('Closes on'),'2026-12-01T16:00');await user.click(screen.getByRole('button',{name:'Publish feedback request'}));
    expect(createCampaign).toHaveBeenCalledWith('school',expect.objectContaining({teacher_user_id:'teacher',class_section_id:'class',audience:'parents',parameters:[...campaign.parameters,'Practical examples']}));
    expect(created).toHaveBeenCalledOnce();
  });
  it('explains suppressed results without showing rating counts',async()=>{
    vi.mocked(getResults).mockResolvedValue({campaign:{...campaign,is_closed:true},response_count:4,available:false,parameters:[]});
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><FeedbackResults school="school" id="campaign"/></QueryClientProvider>);
    expect(await screen.findByText('At least 5 responses are needed to show results.')).toBeVisible();expect(screen.queryByText('Needs a conversation')).not.toBeInTheDocument();
  });
});

import React, { useEffect, useState } from 'react';
import type { ElectiveFinanceReview } from '../../../packages/contracts/src/wire/features/learning/electiveChangeApi';
import { useSession } from '../auth/SessionProvider';
import { getApiOrigin } from '../lib/api';
import { electiveFinanceRead, learningElectiveCommand } from '../lib/learning-elective-policy';
import { useLearningElective } from '../lib/use-learning-elective';
import { useOperationContext } from '../lib/use-operation-context';
import { useApi } from '../lib/query';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts } from '../ui/DomainControls';
import { ElectiveImpact, ElectivePending } from './LearningElectiveChange';

const money = (paise: number) => Number.isSafeInteger(paise) ? new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100) : 'Amount unavailable';
type Props = {href:string;onNavigate:(href:string)=>void;schoolId:string;id:string};
const accessLost = (cause: unknown) => !!cause && typeof cause === 'object' && 'status' in cause && [401,403,404,410].includes(Number(cause.status));
export function FeesElectiveReview(props:Props) {
  const query=useApi<ElectiveFinanceReview>(electiveFinanceRead(props,props.id));
  if(query.isPending) return <Page title="Elective Finance review"><Loading/></Page>;
  if(accessLost(query.error) || !query.data || query.data.id!==props.id) return <Page title="Elective Finance review"><ScreenBack fallbackHref="/areas/fees/ledger"/><Empty title="This Finance review is unavailable" message={query.error?.message} onRetry={()=>void query.refetch()}/></Page>;
  return <FinanceReviewForm {...props} data={query.data} readError={query.isError?query.error.message:undefined} refresh={async()=>{const result=await query.refetch({throwOnError:true});if(!result.data || result.data.id!==props.id || !Number.isSafeInteger(result.data.revision))throw new Error('The current Finance review could not be confirmed.');return result.data;}}/>;
}
function FinanceReviewForm({href,onNavigate,schoolId,id,data,readError,refresh}:Props & {data:ElectiveFinanceReview;readError?:string;refresh:()=>Promise<ElectiveFinanceReview>}) {
  const {user,environment}=useSession(),[basis,setBasis]=useState(data),[outcome,setOutcome]=useState<'no_financial_change'|'requires_financial_review'>('requires_financial_review'),[reason,setReason]=useState(''),[review,setReview]=useState(false),[error,setError]=useState('');
  const write=useLearningElective<ElectiveFinanceReview>(href,electiveFinanceRead({schoolId},id),value=>{setBasis(value);setReason('');setReview(false);});
  const [checking,setChecking]=useState(false),captureRefresh=useOperationContext(JSON.stringify([href,id,'finance_elective_refresh']));
  const refreshCurrent=async()=>{if(checking || write.busy || write.action)return;setChecking(true);setError('');try{const assertCurrent=captureRefresh(),fresh=await refresh();assertCurrent();if(fresh.id!==id || !Number.isSafeInteger(fresh.revision) || fresh.revision<1 || !/^[a-f0-9]{64}$/.test(fresh.ledger_basis_hash))throw new Error('The current Finance basis could not be confirmed.');setBasis(fresh);setReview(false);write.reviewed();}catch(cause){setError(cause instanceof Error?cause.message:'The current account could not be checked.');}finally{setChecking(false);}};
  useEffect(()=>{if(!reason && !review && !write.locked)setBasis(data);},[data,reason,review,write.locked]);
  const stale=basis.revision!==data.revision || basis.ledger_basis_hash!==data.ledger_basis_hash,disabled=write.locked || stale || !!readError || !data.can_classify || checking;
  const statusMessage=data.state==='no_financial_change' ? 'No financial change was recorded. The academic owner can review the current request before applying the elective change.'
    : data.state==='applied' ? 'The elective change has been applied. No further Finance decision is needed.'
      : data.state==='withdrawn' ? 'This elective request was withdrawn. No further Finance decision is needed.'
        : 'This review cannot currently be decided by your account. The academic owner can assign the current Finance responsibility.';
  useScreenExitGuard({dirty:!!reason && !write.action,blocked:write.busy || checking,title:'Leave Finance review?',message:'Unsent review notes will be lost. Recorded decisions remain in history.'});
  const scope={actorId:user!.id,schoolId,mode:environment.mode,namespaceId:environment.namespace_id ?? null,origin:getApiOrigin()};
  const send=()=>{if(disabled)return;try{void write.run(learningElectiveCommand(scope,id,'finance.classify',{expected_revision:basis.revision,expected_ledger_basis_hash:basis.ledger_basis_hash,outcome,reason:reason.trim()}));}catch(cause){setError(cause instanceof Error?cause.message:'Review the current financial impact.');}};
  return <Page title="Elective Finance review"><ScreenBack title="Back to Fees" fallbackHref="/areas/fees/ledger" disabled={write.busy || checking}/><ElectivePending {...{write,onNavigate}}/>{error?<Notice tone="danger" message={error}/>:null}
    {readError?<><Notice tone="warning" message="Current Finance access could not refresh. Your notes are retained; refresh before deciding."/><Button title="Refresh current review" disabled={write.busy || checking || !!write.action} onPress={()=>void refreshCurrent()}/></>:null}
    <Facts items={[{label:'Learner',value:basis.labels.person},{label:'From',value:basis.labels.source_offering},{label:'To',value:basis.labels.destination_offering},{label:'Request',value:basis.reason},{label:'Changes from',value:basis.selection.effective_on},{label:'Assigned reviewer',value:basis.reviewer.label},{label:'Status',value:basis.state.replaceAll('_',' ')}]}/>
    <Disclosure title={`Current account · ${basis.ledger_basis.invoices.length} charges`} defaultOpen>{basis.ledger_basis.invoices.map(invoice=><Section key={invoice.invoice_id} title={invoice.reference}><Facts items={[{label:'Charge',value:money(invoice.amount_paise)},{label:'Paid',value:money(invoice.ledger.paid_paise)},{label:'Credits / refunds',value:`${money(invoice.ledger.credited_paise)} / ${money(invoice.ledger.refunded_paise)}`},{label:'Balance',value:money(invoice.ledger.balance_paise)},{label:'Due',value:invoice.due_on}]}/></Section>)}{!basis.ledger_basis.invoices.length?<Notice message="No linked charges were found. This alone does not establish that the elective change has no financial impact."/>:null}<ControlButton title="Open account and financial actions" disabled={write.busy} onPress={()=>onNavigate(basis.finance_account_href)}/></Disclosure>
    <Disclosure title="Academic impact"><ElectiveImpact preview={basis.preview}/></Disclosure>
    {basis.latest_decision?<Section title="Last recorded decision"><Row variant="plain" title={basis.latest_decision.outcome.replaceAll('_',' ')} detail={basis.latest_decision.reason}/></Section>:null}
    {stale || write.obsolete?<><Notice tone="warning" message="The request or ledger changed. Review the current account before making a new decision."/><Button title="Review current account" disabled={write.busy || checking || !!write.action} onPress={()=>void refreshCurrent()}/></>:null}
    {!data.can_classify?<Notice message={statusMessage}/>:write.action?null:review?<Section title="Record this Finance decision?"><Facts items={[{label:'Decision',value:outcome==='no_financial_change'?'No financial change':'Financial review required'},{label:'Reason',value:reason}]}/><Notice message="This records a classification against the reviewed ledger. It does not change a charge, payment, refund or waiver. Financial review required keeps the Finance handoff open."/><Button title="Confirm Finance decision" disabled={disabled} onPress={send}/><ControlButton title="Keep editing" disabled={write.locked} onPress={()=>setReview(false)}/></Section>:<Section title="Financial impact"><ChoiceMenu label="Decision" value={outcome} options={[{value:'requires_financial_review',label:'Financial review required'},{value:'no_financial_change',label:'No financial change'}]} disabled={disabled} onChange={value=>setOutcome(value as typeof outcome)}/><Field label="Reason and evidence reviewed" value={reason} onChangeText={setReason} maxLength={1000} multiline editable={!disabled}/><Button title="Review decision" disabled={disabled || reason.trim().length<5} onPress={()=>{setError('');setReview(true);}}/></Section>}
  </Page>;
}

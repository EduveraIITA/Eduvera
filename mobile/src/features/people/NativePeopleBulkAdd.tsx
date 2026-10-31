import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { guessPeopleImportMapping, hasPeopleImportValues, mapPeopleImportRows, parsePeoplePaste, type PeopleImportMapping, type PeopleImportRow, type PeopleImportSheet } from '../../../../packages/contracts/src/peopleBulkImport';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../../lib/api';
import { pickPeopleImport } from '../../lib/people-import-file';
import { usePeopleCreate, type CreatedCampusPerson } from '../../lib/use-people-create';
import { useCampusNavigation, useScreenExitGuard } from '../../ui/BackNavigation';
import { ChoiceMenu, ControlButton, InfoDisclosure } from '../../ui/DomainControls';
import { Button, Empty, Field, Loading, Notice, Row, Section } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Match = { id:string;label:string;revision:number;affiliations:string[] };
type Check = {row_id:string;name:string;normalized_name:string;matches:Match[];total:number;truncated:boolean};
type Review = PeopleImportRow & {check?:Check;decision:'create'|'existing'|'skip'|'';match?:Match;accepted?:CreatedCampusPerson};
type Props = {href:string;onDone:(people:CreatedCampusPerson[])=>void;onClose:()=>void};
export function NativePeopleBulkAdd(props:Props) {
  const session=useSession();
  if(!session.schoolId || !session.user || session.environment.unavailable) return <Empty title="Confirm your current campus before adding people" />;
  return <PeopleBulkComposer key={session.scopeKey} {...props} schoolId={session.schoolId} />;
}
function PeopleBulkComposer({href,onDone,onClose,schoolId}:Props & {schoolId:string}) {
  const {colors}=useTheme(), {onNavigate}=useCampusNavigation(href), {root,writer,directory,created}=usePeopleCreate(href,schoolId);
  const [stage,setStage]=useState<'choose'|'map'|'review'|'result'>('choose'), [text,setText]=useState(''), [sheets,setSheets]=useState<PeopleImportSheet[]>([]), [sheetIndex,setSheetIndex]=useState(0), [filename,setFilename]=useState('');
  const [mapping,setMapping]=useState<PeopleImportMapping>({nameColumn:0,connectionColumn:null,hasHeader:false}), [rows,setRows]=useState<Review[]>([]), currentRows=useRef(rows), [page,setPage]=useState(1);
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), stopped=useRef(false), mounted=useRef(true), running=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stopped.current=true;};},[]);
  currentRows.current=rows;
  const locked=busy || writer.locked, sheet=sheets[sheetIndex], accepted=rows.flatMap(row=>row.accepted ? [row.accepted]:[]), unresolved=rows.some(row=>!row.decision || row.decision!=='skip'&&row.errors.length>0);
  useScreenExitGuard({blocked:busy || writer.busy,dirty:stage==='choose'?!!text:rows.some(row=>row.decision!=='skip'&&!row.accepted)});
  const replaceRows=(values:Review[])=>{currentRows.current=values;setRows(values);};
  const changeRow=(number:number,values:Partial<Review>)=>replaceRows(currentRows.current.map(row=>row.row===number ? {...row,...values}:row));
  function load(next:PeopleImportSheet[], name:string) {if(!next.some(value=>value.rows.some(hasPeopleImportValues)))throw new Error('No names were found. Choose a populated sheet.');const index=Math.max(0,next.findIndex(value=>value.rows.some(hasPeopleImportValues)));setSheets(next);setSheetIndex(index);setMapping(guessPeopleImportMapping(next[index]!));setFilename(name);setStage('map');setError('');}
  async function chooseFile(){if(locked)return;setBusy(true);setError('');try{const context=captureApiContext(),value=await pickPeopleImport();context.assertCurrent();if(value)load(value.sheets,value.name);}catch(cause){setError(cause instanceof Error?cause.message:'The file could not be read.');}finally{setBusy(false);}}
  async function review(pasted=false){if(locked)return;setBusy(true);setError('');try{
    const context=captureApiContext();const input=pasted?{name:'Pasted names',rows:parsePeoplePaste(text)}:sheet;if(!input)throw new Error('Choose names to review.');
    const parsed=mapPeopleImportRows(input,pasted?guessPeopleImportMapping(input):mapping);if(!parsed.length)throw new Error('Add at least one name.');
    const names=parsed.filter(row=>!row.errors.length).map(row=>({row_id:String(row.row),name:row.name}));
    const result=names.length?await apiFetch<{results:Check[]}>(`${root}/participants/name-check`,{method:'POST',body:JSON.stringify({names})}):{results:[]};context.assertCurrent();
    if(result.results.length!==names.length || names.some(row=>!result.results.some(value=>value.row_id===row.row_id&&value.name===row.name)))throw new Error('The name check was incomplete. Review again.');
    const counts=new Map<string,number>();result.results.forEach(row=>counts.set(row.normalized_name,(counts.get(row.normalized_name)??0)+1));
    replaceRows(parsed.map(row=>{const check=result.results.find(value=>value.row_id===String(row.row)),repeated=check?(counts.get(check.normalized_name)??0)>1:row.repeated;return {...row,check,repeated,decision:row.errors.length||repeated||(check?.total??0)>0?'':'create'};}));setPage(1);setStage('review');
  }catch(cause){setError(cause instanceof Error?cause.message:'The current name review could not be confirmed.');}finally{setBusy(false);}}
  async function save(){if(locked||unresolved||running.current)return;running.current=true;setBusy(true);setError('');stopped.current=false;try{
    const context=captureApiContext();
    for(const row of currentRows.current){if(stopped.current||!mounted.current)break;if(row.accepted||row.decision==='skip')continue;context.assertCurrent();
      if(row.decision==='existing'&&row.match){const person=await apiFetch<CreatedCampusPerson>(`${root}/participants/${encodeURIComponent(row.match.id)}`);context.assertCurrent();if(person.id!==row.match.id||person.revision!==row.match.revision)throw new Error(`${row.name}: the existing person changed. Review the current identity before choosing it again.`);changeRow(row.row,{accepted:person});}
      else {created.current=null;const saved=await writer.run({endpoint:`${root}/participants`,serverKey:'idempotency_key',body:{first_name:row.name,last_name:'',...(row.affiliation?{affiliation:row.affiliation}:{}),...(row.contact_email?{contact_email:row.contact_email}:{}),...(row.contact_phone?{contact_phone:row.contact_phone}:{})}});context.assertCurrent();if(!saved||!created.current)break;changeRow(row.row,{accepted:created.current});}
    }setStage('result');
  }catch(cause){if(mounted.current){setError(cause instanceof Error?cause.message:'An addition was not confirmed. Use its original retained request.');setStage('result');}}finally{running.current=false;if(mounted.current)setBusy(false);}}
  if(directory.isPending)return <Loading label="Checking permission to add people…" />;
  if(directory.isError||directory.data?.capabilities?.can_manage_enrollment!==true)return <Empty title="Adding people is unavailable with your current access" message={directory.error?.message} onRetry={()=>{void directory.refetch();}} />;
  const columnCount=sheet?Math.max(1,...sheet.rows.map(row=>row.length)):1, header=sheet?.rows.find(hasPeopleImportValues), columns=Array.from({length:columnCount},(_,index)=>({value:String(index),label:`Column ${index+1}${mapping.hasHeader&&header?.[index]?` · ${String(header[index]).slice(0,70)}`:''}`}));
  return <View style={{gap:16}}>
    <Text accessibilityRole="header" style={{color:colors.ink,fontSize:22,lineHeight:29,fontWeight:'600'}}>{stage==='choose'?'Add campus people':stage==='map'?'Match your columns':stage==='review'?'Review people':'Addition results'}</Text>
    {error? <Notice tone="danger" message={error}/>:null}{writer.error?<Notice tone="warning" message={writer.error}/>:null}
    {writer.resumeHref?<ControlButton title="Open the original People action" onPress={()=>onNavigate(writer.resumeHref!)}/>:writer.action?<ControlButton title={writer.action.phase==='accepted'?'Refresh the saved person':'Recover the identical People request'} busy={writer.busy} onPress={()=>{void writer.recover().then(saved=>{if(saved&&created.current){const unresolved=currentRows.current.find(row=>row.decision==='create'&&!row.accepted);if(unresolved)changeRow(unresolved.row,{accepted:created.current});else onDone([created.current]);}});}}/>:null}
    {stage==='choose'?<><Field label="Names or spreadsheet rows" value={text} onChangeText={setText} multiline maxLength={1024*1024} editable={!locked} placeholder="One name per line, or paste spreadsheet columns"/><Button title="Review names" busy={busy} disabled={locked||!text.trim()} onPress={()=>{void review(true);}}/><ControlButton title="Choose Excel, CSV or TSV file" disabled={locked} onPress={()=>{void chooseFile();}}/><Notice message="Up to 100 people. Participation does not require enrollment or an app account. Names never merge identities automatically."/></>:null}
    {stage==='map'&&sheet?<><Notice message={`${filename} · ${sheet.name}`}/>{sheets.length>1?<ChoiceMenu label="Sheet" value={String(sheetIndex)} options={sheets.map((value,index)=>({value:String(index),label:value.name}))} disabled={locked} onChange={value=>{const index=Number(value);setSheetIndex(index);setMapping(guessPeopleImportMapping(sheets[index]!));}}/>:null}<ControlButton title={mapping.hasHeader?'First row contains column names':'First row contains a person'} disabled={locked} onPress={()=>setMapping({...mapping,hasHeader:!mapping.hasHeader})}/>{([{key:'nameColumn',label:'Name',required:true},{key:'connectionColumn',label:'Connection to campus'},{key:'emailColumn',label:'Contact email'},{key:'phoneColumn',label:'Contact phone'}] as const).map(value=><ChoiceMenu key={value.key} label={value.label} value={mapping[value.key]===null||mapping[value.key]===undefined?'':String(mapping[value.key])} options={[...(value.key==='nameColumn'?[]:[{value:'',label:'Not included'}]),...columns]} disabled={locked} onChange={next=>setMapping({...mapping,[value.key]:next===''?null:Number(next)})}/>)}<Button title="Review names and matches" busy={busy} disabled={locked} onPress={()=>{void review();}}/><ControlButton title="Choose another file" disabled={locked} onPress={()=>setStage('choose')}/></>:null}
    {stage==='review'||stage==='result'?<><Notice message={`${accepted.length} confirmed · ${rows.filter(row=>row.decision!=='skip'&&!row.accepted).length} remaining. Each confirmed person is kept when later additions need recovery.`}/>{rows.slice((page-1)*8,page*8).map(row=><Section key={row.row} title={`Row ${row.row} · ${row.name}`}>
      {row.accepted?<Row title={row.accepted.label} status="Confirmed"/>:<>{row.errors.length?<Notice tone="danger" message={row.errors.join('\n')}/>:null}{row.repeated?<Notice tone="warning" message="This name repeats in your import. Explicitly choose a separate person, an existing identity, or skip it."/>:null}{row.check?.total?<Notice message={`${row.check.total} campus people have this name. Review identity before choosing.${row.check.truncated?' Only the first five matches are shown.':''}`}/>:null}
      <ChoiceMenu label={`Decision for row ${row.row}`} value={row.decision==='existing'&&row.match?`existing:${row.match.id}`:row.decision} options={[{value:'',label:'Choose a decision'},...(!row.errors.length?[{value:'create',label:row.check?.total||row.repeated?'Create a separate person':'Create person'}]:[]),...(row.check?.matches.map(match=>({value:`existing:${match.id}`,label:`Use ${match.label} · ${match.affiliations.join(', ')||'Campus person'}`}))??[]),{value:'skip',label:'Skip this row'}]} disabled={locked} onChange={value=>changeRow(row.row,value.startsWith('existing:')?{decision:'existing',match:row.check?.matches.find(match=>match.id===value.slice(9))}:{decision:value as Review['decision'],match:undefined})}/></>}
    </Section>)}<View style={{flexDirection:"row",gap:12,justifyContent:"space-between"}}><ControlButton title="Previous rows" disabled={page<=1||busy} onPress={()=>setPage(page-1)}/><Text style={{color:colors.muted}}>Page {page}</Text><ControlButton title="Next rows" disabled={page*8>=rows.length||busy} onPress={()=>setPage(page+1)}/></View>
    {stage==='review'?<Button title="Add reviewed people" busy={busy} disabled={locked||unresolved||!rows.some(row=>row.decision!=='skip')} onPress={()=>{void save();}}/>:<>{accepted.length?<Button title="Use confirmed people" disabled={busy||writer.busy||!!writer.action} onPress={()=>onDone([...new Map(accepted.map(person=>[person.id,person])).values()])}/>:null}{rows.some(row=>row.decision!=='skip'&&!row.accepted)?<ControlButton title="Continue remaining additions" disabled={locked} onPress={()=>{void save();}}/>:null}</>}
    {busy?<ControlButton title="Stop after the current addition" onPress={()=>{stopped.current=true;}}/>:null}
    {!rows.some(row=>row.accepted)&&!writer.action?<ControlButton title="Revise the names" disabled={locked} onPress={()=>setStage(sheets.length?'map':'choose')}/>:null}</>:null}
    <ControlButton title="Cancel adding people" disabled={busy||writer.busy} onPress={onClose}/><InfoDisclosure title="What gets created"><Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>Canonical campus people and optional descriptive connections. No enrollment, employment, account, attendance mark or operational authority is created. Selected file bytes are removed after parsing; unsubmitted rows stay in this session.</Text></InfoDisclosure>
  </View>;
}

import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../ui/theme';
import { themeRadii } from '../ui/theme-tokens';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { useOperationClock } from '../lib/use-operation-clock';
import { diningTimeOptions } from '../../../packages/contracts/src/dining-time';
import { TemporalField } from '../ui/TemporalField';
import { ChoiceMenu } from '../ui/DomainControls';
import { DomainText } from './ResourcesScreen';
import { DiningClockField } from './DiningClockField';
export function useDiningTime(source:string){const session=useSession(),query=useApi<unknown>('/api/v1/workspace'),clock=useOperationClock(source);const timezone=useMemo(()=>{try{if(!query.data||!session.user||!session.schoolId)return '';return assertWorkspaceManifestContext(normalizeWorkspaceManifest(query.data),{actorUserId:session.user.id,institutionId:session.schoolId,environment:session.environment}).context.time_zone??'';}catch{return '';}},[query.data,session.user?.id,session.schoolId,session.environment]);return{...clock,timezone,error:clock.error||query.error?.message||(!timezone?'The current campus timezone must be confirmed before entering local hours.':'')};}
export function DiningCampusTimeField({label,value,onChange,timezone,fold,onFold,disabled,grouped}:{label:string;value:string;onChange(value:string):void;timezone:string;fold:string;onFold(value:string):void;disabled?:boolean;grouped?:boolean}){const {colors}=useTheme();let repeated=false;try{repeated=diningTimeOptions(value,timezone).length>1;}catch{}return <View style={grouped?{backgroundColor:colors.row,borderRadius:themeRadii.radiusCard,padding:16,gap:4}:undefined}>{grouped?<Text style={{color:colors.ink,fontSize:16,lineHeight:24,fontWeight:'600'}}>{label}</Text>:null}<TemporalField label={`${label} · date`} rowLabel={grouped?'Date':undefined} mode="date" value={value.slice(0,10)} onChange={date=>onChange(`${date}T${value.slice(11,16)||'12:00'}`)} disabled={disabled||!timezone}/><DiningClockField rowLabel={grouped?'Time':undefined} label={`${label} · campus time`} value={value.slice(11,16)} onChange={time=>onChange(`${value.slice(0,10)}T${time}`)} disabled={disabled||!timezone}/>{repeated?<ChoiceMenu label="This clock hour occurs twice" value={fold} options={[{value:'',label:'Choose which occurrence'},{value:'earlier',label:'Earlier occurrence'},{value:'later',label:'Later occurrence'}]} onChange={onFold} disabled={disabled}/>:null}<DomainText>{timezone}</DomainText></View>;}

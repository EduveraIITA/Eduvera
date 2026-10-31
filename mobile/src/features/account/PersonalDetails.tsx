import { useEffect, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../../auth/SessionProvider';
import { getApiOrigin } from '../../lib/api';
import { accountName } from '../../lib/account-profile';
import { useAccountQuery } from '../../lib/account-query';
import { useAccountCommand } from '../../lib/use-account-command';
import { parsePersonalProfile, personalProfileChange, type PersonalProfile } from '../../lib/personal-profile';
import { useScreenExitGuard } from '../../ui/BackNavigation';
import { ControlButton, InfoDisclosure } from '../../ui/DomainControls';
import { Empty, Field, ListGroup, Loading, Notice, Row, Section } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { AccountCommandFeedback } from '../AccountPreferences';
import { ProfilePhoneVerification } from './ProfilePhoneVerification';

export function PersonalDetails({href,onNavigate}:{href:string;onNavigate(href:string):void}) {
  const session=useSession(),query=useAccountQuery('/api/v1/auth/profile/details/',parsePersonalProfile);
  if(!query.value)return query.isPending?<Loading/>:<Empty title="Personal details could not load" message={query.invalid||query.error?.message} onRetry={()=>void query.refresh().catch(()=>{})}/>;
  if(query.value.user_id!==session.user?.id)return <Empty title="Confirm your current account before editing"/>;
  return <PersonalDetailsForm key={session.user.id} {...{href,onNavigate}} initial={query.value} query={query}/>;
}
function PersonalDetailsForm({href,onNavigate,initial,query}:{href:string;onNavigate(href:string):void;initial:PersonalProfile;query:ReturnType<typeof useAccountQuery<PersonalProfile>>}) {
  const session=useSession(),{colors}=useTheme(),[base,setBase]=useState(initial),[name,setName]=useState(accountName(initial)),[phone,setPhone]=useState(initial.contact_phone),[background,setBackground]=useState(initial.education_background),[photo,setPhoto]=useState<string|null|undefined>(),[picking,setPicking]=useState(false),pickingRef=useRef(false),[error,setError]=useState('');
  const command=useAccountCommand(JSON.stringify([session.user?.id,getApiOrigin()]),'personal-profile');
  const dirty=name.trim()!==accountName(base)||phone!==base.contact_phone||background.trim()!==base.education_background||photo!==undefined;
  const install=(value:PersonalProfile)=>{setBase(value);setName(accountName(value));setPhone(value.contact_phone);setBackground(value.education_background);setPhoto(undefined);};
  useEffect(()=>{if(!dirty&&!command.locked&&query.value&&query.value.user_id===base.user_id)install(query.value);},[query.value,command.locked,dirty]);
  const paused=!!query.invalid||query.isError,locked=command.locked||picking||paused||!!session.publicDemo;
  useScreenExitGuard({blocked:command.busy||picking,dirty:dirty||!!command.pending,title:'Leave personal details?',message:command.pending?'The last result is unconfirmed. Review current saved state before another change.':'Your unsaved profile changes will be discarded.'});
  const pick=async()=>{if(locked||pickingRef.current)return;pickingRef.current=true;setPicking(true);setError('');try{const assertCurrent=command.capture();
    const ImagePicker=await import('expo-image-picker');const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:.75,base64:true,exif:false});assertCurrent();
    if(result.canceled)return;const image=result.assets[0];if(!image?.base64||image.base64.length>7*1024*1024)throw new Error('Choose a JPEG or PNG photo under 5 MB.');setPhoto('data:image/jpeg;base64,'+image.base64);
  }catch(cause){setError(cause instanceof Error?cause.message:'The photo picker could not open.');}finally{pickingRef.current=false;setPicking(false);}};
  const save=async()=>{if(locked||!dirty)return;setError('');let body;try{body=personalProfileChange(base,{name,phone,background,photo},randomUUID());}catch(cause){setError((cause as Error).message);return;}
    const saved=await command.run({path:'/api/v1/auth/profile/details/',method:'PATCH',body:JSON.stringify(body)},{confirm:value=>{const result=parsePersonalProfile(value);if(result.user_id!==base.user_id||result.revision!==base.revision+1||result.last_change_id!==body.client_request_id||result.contact_phone!==body.contact_phone||result.education_background!==body.education_background||accountName(result)!==body.name)throw new Error('The exact profile save was not confirmed. Review current saved state.');return result;},accepted:install,refresh:query.refresh});
    if(saved)void session.refresh();
  };
  const refreshSaved=async()=>{const current=await query.refresh();if(command.pending&&current.last_change_id===(JSON.parse(command.pending.request.body??'{}') as {client_request_id?:string}).client_request_id)install(current);return current;};
  const avatar=photo!==undefined?photo:base.photo_override?base.photo_data_url:session.user?.avatar_url;
  return <>
    {session.publicDemo?<Notice message="The public demo is read-only. Use your own account to edit personal details."/>:null}
    {session.environment.mode==='simulation'?<Notice message="These are your real account details. Profile changes also apply in Live; captured campus records stay separate."/>:null}
    {paused?<Empty title="Current profile could not refresh" message={query.invalid||query.error?.message} onRetry={()=>void query.refresh().catch(()=>{})}/>:null}
    {error?<Notice tone="danger" message={error}/>:null}
    <Section title="Profile photo"><View style={{flexDirection:'row',alignItems:'center',gap:16}}>{avatar?<Image accessible={false} source={{uri:avatar.startsWith('/')?getApiOrigin()+avatar:avatar}} style={{width:80,height:80,borderRadius:40}}/>:<View accessible={false} style={{width:80,height:80,borderRadius:40,backgroundColor:colors.positiveSoft,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:26,fontWeight:'600',color:colors.positive}}>{Array.from(name.trim()||session.user?.username||'?')[0]?.toUpperCase()}</Text></View>}<View style={{gap:4}}><ControlButton title={avatar?'Change photo':'Choose photo'} busy={picking} disabled={locked} onPress={()=>void pick()}/>{avatar?<ControlButton title="Remove photo" kind="danger" disabled={locked} onPress={()=>setPhoto(null)}/>:null}</View></View></Section>
    <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" textContentType="name" autoComplete="name" editable={!locked}/>
    <Section title="Contact details"><Field label="Phone · optional" value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" placeholder="Include country code, e.g. +91" maxLength={48} editable={!locked}/>{phone===base.contact_phone&&base.phone_verified?<Text style={{color:colors.positive,fontSize:14,lineHeight:21}}>Phone verified</Text>:null}<ProfilePhoneVerification profile={base} dirty={dirty} refresh={query.refresh}/><ListGroup inset><Row variant="plain" title={base.email} detail="Sign-in email" status={session.user?.email_verified?'Verified':'Not verified'} statusTone={session.user?.email_verified?'positive':'warning'} icon="invitations" onPress={()=>onNavigate('/more/account/security?'+new URLSearchParams({from:href}))}/></ListGroup><Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>A verified contact number does not enable phone sign-in or account recovery.</Text></Section>
    <InfoDisclosure title="Education & professional background · optional"><Field label="Education or professional background" value={background} onChangeText={setBackground} multiline maxLength={1000} editable={!locked} placeholder="For example, your qualification, institution or area of expertise"/><Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>Self-reported background, not verified qualifications. This stays private and is not automatically shared with your campus or Assistant.</Text></InfoDisclosure>
    <Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>Your campus manages official person records, courses and responsibilities separately. Contact details and background are private to this account.</Text>
    <AccountCommandFeedback command={command} refresh={refreshSaved} resolves={(value,request)=>parsePersonalProfile(value).last_change_id===(JSON.parse(request.body??'{}') as {client_request_id?:string}).client_request_id} allowNewChoice/>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><ControlButton title="Save changes" kind="primary" busy={command.busy} disabled={locked||!dirty} onPress={()=>void save()}/>{dirty?<ControlButton title="Reset changes" disabled={command.locked||picking} onPress={()=>{install(base);setError('');}}/>:null}</View>
  </>;
}

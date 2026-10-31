import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch } from '../../lib/api';
import { ApiError } from '../../lib/api-client';
import { parsePersonalProfile, parsePhoneChallenge, type PersonalProfile, type PhoneChallenge } from '../../lib/personal-profile';
import { useAccountCommand } from '../../lib/use-account-command';
import { Field, Notice } from '../../ui/components';
import { ControlButton } from '../../ui/DomainControls';
import { useScreenExitGuard } from '../../ui/BackNavigation';
import { useTheme } from '../../ui/theme';
import { AccountCommandFeedback } from '../AccountPreferences';

export function ProfilePhoneVerification({ profile, dirty, refresh }: { profile:PersonalProfile;dirty:boolean;refresh():Promise<PersonalProfile> }) {
  const session=useSession(),{colors}=useTheme(),command=useAccountCommand(session.scopeKey,'account-phone-verification');
  const [challenge,setChallenge]=useState<PhoneChallenge|null>(null),[code,setCode]=useState(''),[error,setError]=useState(''),[confirming,setConfirming]=useState(false),busyRef=useRef(false),[uncertain,setUncertain]=useState(false);
  useScreenExitGuard({blocked:command.busy||confirming,dirty:!!challenge||uncertain,title:'Leave phone verification?',message:'You can review your saved phone when you return. Leaving does not mark it verified.'});
  if(!profile.contact_phone || profile.phone_verified)return null;
  if(session.environment.mode!=='live')return <Notice message="Verify your phone in Live. No verification SMS is sent from Simulation."/>;
  if(!profile.sms_available)return <Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>Not verified. SMS verification will be available after the service is connected.</Text>;
  const locked=command.locked||confirming||uncertain;
  const request=async()=>{setError('');if(dirty||locked)return;await command.run({path:'/api/v1/auth/profile/phone/request/',method:'POST',body:JSON.stringify({expected_revision:profile.revision})},{confirm:parsePhoneChallenge,accepted:result=>{setChallenge(result);setCode('');},refresh});};
  // OTP stays in this form only. Never retain it in the shared command journal.
  const confirm=async()=>{if(!challenge||locked||busyRef.current||dirty||!/^\d{6}$/.test(code))return;if(Date.parse(challenge.expires_at)<=Date.now()){setError('The code expired. Start a new verification.');setChallenge(null);setCode('');return;}
    const submitted=code,assertCurrent=command.capture({path:'/api/v1/auth/profile/phone/confirm/',method:'POST'});busyRef.current=true;setConfirming(true);setError('');setCode('');
    try{const value=await apiFetch('/api/v1/auth/profile/phone/confirm/',{method:'POST',body:JSON.stringify({challenge_id:challenge.challenge_id,code:submitted})});assertCurrent();const saved=parsePersonalProfile(value);if(saved.user_id!==profile.user_id||saved.contact_phone!==profile.contact_phone||!saved.phone_verified)throw new Error('Phone verification could not be confirmed.');setChallenge(null);await refresh();assertCurrent();}
    catch(cause){if(!(cause instanceof ApiError)||cause.status>=500||cause.status===408)setUncertain(true);if(cause instanceof ApiError&&cause.status===410)setChallenge(null);setError(cause instanceof Error?cause.message:'Verification could not be confirmed.');}
    finally{busyRef.current=false;setConfirming(false);}
  };
  const inspect=async()=>{if(busyRef.current)return;busyRef.current=true;setConfirming(true);setError('');try{const assertCurrent=command.capture(),saved=await refresh();assertCurrent();if(saved.user_id!==profile.user_id)throw new Error('The account changed. Return to Profile.');setUncertain(false);setChallenge(null);setCode('');setError(saved.phone_verified?'':'The current phone is not verified. You can start a new verification; the earlier code was not sent again.');}catch(cause){setError(cause instanceof Error?cause.message:'Saved phone state could not load.');}finally{busyRef.current=false;setConfirming(false);}};
  return <View style={{gap:8}}>
    {dirty?<Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>Save your profile changes before verifying the phone.</Text>:null}
    {uncertain?<><Notice tone="warning" message="The verification result is unconfirmed. Inspect saved state before trying again; the code is not retained or repeated."/><ControlButton title="Check saved phone status" busy={confirming} onPress={()=>void inspect()}/></>:challenge?<><Text style={{color:colors.muted,fontSize:14,lineHeight:21}}>Enter the six-digit code sent to {challenge.destination}. It expires in 10 minutes.</Text><Field label="SMS verification code" value={code} onChangeText={value=>setCode(value.replace(/\D/g,'').slice(0,6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} editable={!locked&&!dirty}/><ControlButton title="Verify phone" busy={confirming} disabled={dirty||code.length!==6||locked} onPress={()=>void confirm()}/><ControlButton title="Start a new verification" disabled={locked} onPress={()=>{setChallenge(null);setCode('');}}/></>:<ControlButton title="Send verification code" busy={command.busy} disabled={dirty||locked} onPress={()=>void request()}/>}
    {error?<Notice tone="warning" message={error}/>:null}
    <AccountCommandFeedback command={command} refresh={refresh} allowNewChoice/>
  </View>;
}

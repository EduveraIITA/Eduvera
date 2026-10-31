/** Native temporal fields are explicitly labelled in the device's timezone. */
export const resourceInputTime=(value:string|Date,precision:"minute"|"instant"="minute")=>{
  const date=new Date(value);
  const local=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString();
  return precision==="instant" ? local.slice(0,-1) : local.slice(0,16);
};
export const resourceInputZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
export const resourceInputInstant=(value:string)=>{
  const date=new Date(value);
  if(!value || !Number.isFinite(date.getTime()))throw new Error("Choose a valid date and time.");
  return date.toISOString();
};

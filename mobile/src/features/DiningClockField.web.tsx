import { createElement } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../ui/theme';
export function DiningClockField({label,value,onChange,disabled,rowLabel}:{label:string;value:string;onChange(value:string):void;disabled?:boolean;rowLabel?:string}){const{colors}=useTheme();return <View style={{gap:8}}><Text style={{color:colors.muted}}>{rowLabel??label}</Text>{createElement('input',{type:'time',value,disabled,'aria-label':label,onChange:(e:{target:{value:string}})=>onChange(e.target.value),style:{font:'inherit',padding:'12px',border:`1px solid ${colors.border}`,background:colors.surface,color:colors.ink,borderRadius:10,minHeight:44,boxSizing:'border-box'}})}</View>;}

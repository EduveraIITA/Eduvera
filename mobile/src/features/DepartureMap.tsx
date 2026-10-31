import { useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Platform, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';
import type { LocationPoint, MapConfig } from '../../../packages/contracts/src/wire/features/departure/api';
import { ControlButton } from '../ui/DomainControls';
import { Notice } from '../ui/components';
import { useTheme } from '../ui/theme';
import { departureCoordinates } from './DepartureJourneyPolicy';
import { departureMapFrame, departurePointOnMap, fitDepartureMap, projectDeparturePoint, unprojectDeparturePoint, type DepartureMapPoint, type DepartureMapViewport } from './DepartureMapPolicy';

export type DepartureMapStop=DepartureMapPoint&{id:string;name:string;sequence:number};
export function DepartureMap({point,map,fresh,stops=[],selectedStopId,onSelectStop}:{point:LocationPoint;map:MapConfig;fresh:boolean;stops?:DepartureMapStop[];selectedStopId?:string;onSelectStop?:(id:string)=>void}) {
  const coordinates=departureCoordinates(point),focused=useIsFocused(),{colors}=useTheme();
  const [width,setWidth]=useState(320),[view,setView]=useState<DepartureMapViewport>({center:coordinates??{latitude:0,longitude:0},zoom:15}),[follow,setFollow]=useState(true),[tileError,setTileError]=useState(false),[retry,setRetry]=useState(0);
  const height=300,visible={...view,center:follow&&coordinates?coordinates:view.center};
  const frame=useMemo(()=>departureMapFrame(visible,width,height,map.tile_url),[visible.center.latitude,visible.center.longitude,visible.zoom,width,map.tile_url]);
  const latest=useRef({view:visible,frame}),initial=useRef({view:visible,distance:0,touches:0,dx:0,dy:0});latest.current={view:visible,frame};
  const pan=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:event=>event.nativeEvent.touches.length>1,
    onMoveShouldSetPanResponder:(event,gesture)=>event.nativeEvent.touches.length>1||Math.abs(gesture.dx)+Math.abs(gesture.dy)>8,
    onPanResponderGrant:event=>{const touches=event.nativeEvent.touches;initial.current={view:latest.current.view,distance:touches.length>1?Math.hypot(touches[0]!.pageX-touches[1]!.pageX,touches[0]!.pageY-touches[1]!.pageY):0,touches:touches.length,dx:0,dy:0};setView(latest.current.view);setFollow(false);},
    onPanResponderMove:(event,gesture)=>{const touches=event.nativeEvent.touches,distance=touches.length>1?Math.hypot(touches[0]!.pageX-touches[1]!.pageX,touches[0]!.pageY-touches[1]!.pageY):0;
      if(touches.length!==initial.current.touches){initial.current={view:latest.current.view,distance,touches:touches.length,dx:gesture.dx,dy:gesture.dy};return;}
      const zoom=Math.max(0,Math.min(19,Math.round(initial.current.view.zoom+(distance&&initial.current.distance?Math.log2(distance/initial.current.distance):0)))),center=projectDeparturePoint(initial.current.view.center,zoom);
      setView({zoom,center:unprojectDeparturePoint(center.x-(gesture.dx-initial.current.dx),center.y-(gesture.dy-initial.current.dy),zoom)});
    },onPanResponderTerminationRequest:()=>true,
  }),[]);
  if(!coordinates)return <Notice message="The shared location has no usable coordinates. Journey records remain available."/>;
  const marker=departurePointOnMap(coordinates,frame),accuracy=Number(point.accuracy_metres),metresPerPixel=156543.03392*Math.max(.001,Math.cos(coordinates.latitude*Math.PI/180))/2**frame.zoom;
  const radius=Number.isFinite(accuracy)&&accuracy>0?Math.min(2000,accuracy/metresPerPixel):0;
  const selected=stops.find(stop=>stop.id===selectedStopId);
  return <View style={{gap:8}}>
    <View {...pan.panHandlers} onLayout={event=>setWidth(Math.max(160,Math.min(2048,event.nativeEvent.layout.width)))} accessibilityLabel="Journey map with attendant phone location and authorized route stops" style={{height,overflow:'hidden',borderRadius:18,backgroundColor:colors.row}}>
      {focused?frame.tiles.map(tile=><Image key={`${retry}:${tile.key}`} source={{uri:tile.url,...(Platform.OS==='web'?{}:{headers:{'User-Agent':'ThatCampus (app.thatcampus.mobile)'}})}} onError={()=>setTileError(true)} accessible={false} style={{position:'absolute',left:tile.x,top:tile.y,width:256,height:256}}/>):null}
      <Svg width={width} height={height} style={{position:'absolute',left:0,top:0}}>
        {stops.map(stop=>{const p=departurePointOnMap(stop,frame),chosen=stop.id===selectedStopId;return <G key={stop.id} onPress={()=>onSelectStop?.(stop.id)} accessibilityLabel={`Stop ${stop.sequence}: ${stop.name}`}><Circle cx={p.x} cy={p.y} r={chosen?18:15} fill={chosen?colors.action:colors.surface} stroke={colors.action} strokeWidth={2}/><SvgText x={p.x} y={p.y+5} fontSize={13} fontWeight="700" textAnchor="middle" fill={chosen?colors.onAction:colors.ink}>{stop.sequence}</SvgText></G>;})}
        {radius?<Circle cx={marker.x} cy={marker.y} r={radius} fill={colors.action} fillOpacity={.1} stroke={colors.action} strokeOpacity={.4}/>:null}
        <Circle cx={marker.x} cy={marker.y} r={9} fill={colors.action} stroke={colors.surface} strokeWidth={3}/>
      </Svg>
    </View>
    <Text style={{color:colors.muted,fontSize:12,lineHeight:18}}>{map.attribution.replace(/<[^>]*>/g,'')} · Phone observation, not a road route or ETA.</Text>
    <Text style={{color:fresh?colors.ink:colors.muted,fontSize:14,lineHeight:21}}>{fresh?'Recent phone location':'Location delayed'} · {new Date(point.observed_at).toLocaleTimeString()} · ±{Math.round(accuracy)} m</Text>
    {tileError||!frame.tiles.length?<><Notice tone="warning" message="Map tiles are unavailable. The phone observation, stop markers and journey records remain available."/><ControlButton title="Retry map tiles" onPress={()=>{setTileError(false);setRetry(value=>value+1);}}/></>:null}
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><ControlButton title="Zoom in" disabled={frame.zoom>=19} onPress={()=>setView({...visible,zoom:frame.zoom+1})}/><ControlButton title="Zoom out" disabled={frame.zoom<=0} onPress={()=>setView({...visible,zoom:frame.zoom-1})}/><ControlButton title="Recenter on phone" onPress={()=>{setView({...visible,center:coordinates});setFollow(true);}}/>{stops.length?<ControlButton title="Show route stops" onPress={()=>{const fit=fitDepartureMap([coordinates,...stops],width,height);if(fit){setView(fit);setFollow(false);}}}/>:null}{selected?<ControlButton title={`Show ${selected.name}`} onPress={()=>{setView({...visible,center:selected});setFollow(false);}}/>:null}</View>
  </View>;
}

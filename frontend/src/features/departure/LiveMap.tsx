import L from "leaflet";
import { LocateFixed } from "lucide-react";
import { useEffect,useRef,useState } from "react";
import "leaflet/dist/leaflet.css";

export interface MapStop { id: string; latitude: number; longitude: number; name: string; sequence: number; focused?: boolean }
export function LiveMap({latitude,longitude,accuracy,tileUrl,attribution,stops,label="Attendant phone location"}:{latitude:number;longitude:number;accuracy?:number;tileUrl:string;attribution:string;stops?:MapStop[];label?:string}) {
  const host=useRef<HTMLDivElement>(null);
  const initial=useRef({latitude,longitude});
  const point=useRef({latitude,longitude});
  const map=useRef<L.Map|null>(null);
  const marker=useRef<L.Marker|null>(null);
  const circle=useRef<L.Circle|null>(null);
  const tiles=useRef<L.TileLayer|null>(null);
  const stopLayer=useRef<L.LayerGroup|null>(null);
  const follow=useRef(true);
  const [tilesUnavailable,setTilesUnavailable]=useState(false);
  useEffect(()=>{
    if(!host.current)return;
    const instance=L.map(host.current,{zoomControl:false,attributionControl:true,scrollWheelZoom:false}).setView([initial.current.latitude,initial.current.longitude],15);
    map.current=instance;
    stopLayer.current=L.layerGroup().addTo(instance);
    L.control.zoom({position:"bottomright"}).addTo(instance);
    tiles.current=L.tileLayer(tileUrl,{maxZoom:19,attribution}).addTo(instance);
    tiles.current.on("tileerror",()=>setTilesUnavailable(true));
    const icon=L.divIcon({className:"departure-map-marker",html:'<span aria-hidden="true">●</span>',iconSize:[28,28],iconAnchor:[14,14]});
    marker.current=L.marker([initial.current.latitude,initial.current.longitude],{icon,keyboard:false}).addTo(instance);
    circle.current=L.circle([initial.current.latitude,initial.current.longitude],{radius:0,color:"#1d4ed8",weight:1,fillOpacity:.08}).addTo(instance);
    instance.on("dragstart",()=>{follow.current=false;});
    const observer=new ResizeObserver(()=>instance.invalidateSize({pan:false}));
    observer.observe(host.current);
    return()=>{observer.disconnect();instance.remove();map.current=null;marker.current=null;circle.current=null;tiles.current=null;stopLayer.current=null;};
  },[tileUrl,attribution]);
  useEffect(()=>{
    point.current={latitude,longitude};
    marker.current?.setLatLng([latitude,longitude]);
    circle.current?.setLatLng([latitude,longitude]).setRadius(accuracy&&Number.isFinite(accuracy)?accuracy:0);
    if(follow.current)map.current?.panTo([latitude,longitude],{animate:false});
  },[latitude,longitude,accuracy,tileUrl,attribution]);
  useEffect(()=>{
    stopLayer.current?.clearLayers();
    for(const stop of stops??[]) {
      const content=document.createElement("span");content.textContent=String(stop.sequence);
      const tooltip=document.createElement("span");tooltip.textContent=stop.name;
      const icon=L.divIcon({className:`departure-stop-marker${stop.focused?" is-focused":""}`,html:content,iconSize:[28,28],iconAnchor:[14,14]});
      const pin=L.marker([stop.latitude,stop.longitude],{icon,title:stop.name,alt:stop.name}).bindTooltip(tooltip);
      if(stopLayer.current)pin.addTo(stopLayer.current);
    }
  },[stops,tileUrl,attribution]);
  return <div className="ride-map-container">
    <div ref={host} className="departure-map" role="region" aria-label={label}/>
    <button type="button" className="ride-map-recenter" aria-label="Recenter on attendant location" onClick={()=>{follow.current=true;map.current?.setView([point.current.latitude,point.current.longitude],map.current.getZoom(),{animate:false});}}><LocateFixed size={20}/></button>
    {tilesUnavailable?<div className="ride-map-error" role="status"><span>Map tiles unavailable. Journey records still work.</span><button type="button" onClick={()=>{setTilesUnavailable(false);tiles.current?.redraw();}}>Retry map</button></div>:null}
  </div>;
}

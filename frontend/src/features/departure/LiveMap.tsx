import L from "leaflet";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export function LiveMap({latitude,longitude,accuracy,tileUrl,attribution,label="Current bus location"}:{latitude:number;longitude:number;accuracy?:number;tileUrl:string;attribution:string;label?:string}) {
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!host.current)return;
    const map=L.map(host.current,{zoomControl:true,attributionControl:true}).setView([latitude,longitude],15);
    L.tileLayer(tileUrl,{maxZoom:19,attribution}).addTo(map);
    const icon=L.divIcon({className:"departure-map-marker",html:'<span aria-hidden="true">●</span>',iconSize:[28,28],iconAnchor:[14,14]});
    L.marker([latitude,longitude],{icon,title:label}).addTo(map);
    if(accuracy&&Number.isFinite(accuracy))L.circle([latitude,longitude],{radius:accuracy,color:"#1d4ed8",weight:1,fillOpacity:.08}).addTo(map);
    window.setTimeout(()=>map.invalidateSize(),0);
    return()=>{ map.remove(); };
  },[latitude,longitude,accuracy,tileUrl,attribution,label]);
  return <div ref={host} className="departure-map" role="img" aria-label={label}/>;
}

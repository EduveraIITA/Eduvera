import { Clock3,MapPin } from "lucide-react";
import type { LocationPoint,MapConfig } from "./api";
import { LiveMap, type MapStop } from "./LiveMap";

export function RideMapPanel({location,map,fresh,stops}:{location:LocationPoint;map:MapConfig;fresh:boolean;stops?:MapStop[]}) {
  return <div className="ride-map-panel">
    <LiveMap latitude={Number(location.latitude)} longitude={Number(location.longitude)} accuracy={Number(location.accuracy_metres)} stops={stops} tileUrl={map.tile_url} attribution={map.attribution} label="Attendant phone location"/>
    <div className={`ride-location-caption ${fresh?"":"is-delayed"}`}>
      {fresh?<MapPin size={16}/>:<Clock3 size={16}/>}
      <strong>{fresh?"Recent phone location":"Location delayed"}</strong>
      <span>{new Date(location.observed_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} · ±{Math.round(Number(location.accuracy_metres))} m</span>
    </div>
  </div>;
}

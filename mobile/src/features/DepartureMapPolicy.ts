export type DepartureMapPoint={latitude:number;longitude:number};
export type DepartureMapViewport={center:DepartureMapPoint;zoom:number};
export function projectDeparturePoint(point:DepartureMapPoint,zoom:number) {
  const latitude=Math.max(-85.05112878,Math.min(85.05112878,point.latitude))*Math.PI/180,world=256*2**zoom;
  return {x:(point.longitude+180)/360*world,y:(1-Math.log(Math.tan(latitude)+1/Math.cos(latitude))/Math.PI)/2*world};
}
export function unprojectDeparturePoint(x:number,y:number,zoom:number):DepartureMapPoint {
  const world=256*2**zoom,normalized=((x%world)+world)%world;
  return {longitude:normalized/world*360-180,latitude:Math.atan(Math.sinh(Math.PI*(1-2*Math.max(0,Math.min(world,y))/world)))*180/Math.PI};
}
export function departureMapTileUrl(template:string,z:number,x:number,y:number) {
  if(template.length>2048||!['{z}','{x}','{y}'].every(key=>template.includes(key))||!Number.isInteger(z)||z<0||z>19)return null;
  const n=2**z;if(!Number.isInteger(x)||!Number.isInteger(y)||y<0||y>=n)return null;
  const rendered=template.replaceAll('{z}',String(z)).replaceAll('{x}',String(((x%n)+n)%n)).replaceAll('{y}',String(y)).replaceAll('{s}','a').replaceAll('{r}','');
  try{const parsed=new URL(rendered);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password?parsed.href:null;}catch{return null;}
}
export function departureMapFrame(view:DepartureMapViewport,width:number,height:number,template:string) {
  const zoom=Math.max(0,Math.min(19,Math.round(view.zoom))),center=projectDeparturePoint(view.center,zoom),left=center.x-width/2,top=center.y-height/2;
  const tiles:Array<{key:string;url:string;x:number;y:number}>=[];
  for(let x=Math.floor(left/256);x<=Math.floor((left+width)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+height)/256);y++){
    const url=departureMapTileUrl(template,zoom,x,y);if(url&&tiles.length<64)tiles.push({key:`${zoom}:${x}:${y}`,url,x:x*256-left,y:y*256-top});
  }
  return {zoom,center,left,top,width,height,tiles};
}
export function departurePointOnMap(point:DepartureMapPoint,frame:ReturnType<typeof departureMapFrame>) {
  const projected=projectDeparturePoint(point,frame.zoom),world=256*2**frame.zoom;
  const x=projected.x+Math.round((frame.center.x-projected.x)/world)*world;
  return {x:x-frame.left,y:projected.y-frame.top};
}
export function fitDepartureMap(points:readonly DepartureMapPoint[],width:number,height:number):DepartureMapViewport|null {
  if(!points.length)return null;
  const first=projectDeparturePoint(points[0]!,0),projected=points.map(point=>{const p=projectDeparturePoint(point,0);return{x:p.x+Math.round((first.x-p.x)/256)*256,y:p.y};});
  const minX=Math.min(...projected.map(p=>p.x)),maxX=Math.max(...projected.map(p=>p.x)),minY=Math.min(...projected.map(p=>p.y)),maxY=Math.max(...projected.map(p=>p.y));
  const scale=Math.min(Math.max(1,width-72)/Math.max(.001,maxX-minX),Math.max(1,height-72)/Math.max(.001,maxY-minY));
  return {center:unprojectDeparturePoint((minX+maxX)/2,(minY+maxY)/2,0),zoom:Math.max(0,Math.min(17,Math.floor(Math.log2(scale))))};
}

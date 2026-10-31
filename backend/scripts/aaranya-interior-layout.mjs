/**
 * Owner-requested fictional Aaranya interiors. All coordinates are authored in
 * each retained building's local basis, then clipped to its actual footprint.
 * This module is pure: it creates no people, facts, places or resource records.
 */
export const AARANYA = Object.freeze({
  school: '5ee339b2-4900-44cc-b1a9-22717c28ab88',
  campus: '9af3ca14-0096-4b41-b36b-0e7bbfaf4480',
  admin: 'f6b941a0-07dd-41f9-b51f-53515c591e6f',
  computing: 'b7a42c31-2549-491b-8f1c-fc91c80a79a8',
  teaching: '7b4b7727-2212-41a5-8c79-10c31847490c',
  existingRooms: ['6c10079c-c280-4ed5-99b8-9c149989d9bc', '8b54fd9f-30a3-4cf6-be8d-ed55a70d8680', '97c44494-8174-4463-9f63-9e1f5b873b20'],
});
export const PREFIX = 'aaranya_int_';
const EPS = 1e-7;
const round = n => Math.round(n * 1e6) / 1e6;
export const point = (x, y) => ({ x: round(x), y: round(y) });
const cross = (a, b, c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export const area = p => Math.abs(p.reduce((s,a,i) => { const b=p[(i+1)%p.length]; return s+a.x*b.y-b.x*a.y; },0))/2;
const signedArea = p => p.reduce((s,a,i) => {const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2;
function clean(poly) {
  let p=poly.filter((a,i)=>i===0||Math.hypot(a.x-poly[i-1].x,a.y-poly[i-1].y)>EPS);
  if(p.length>1&&Math.hypot(p[0].x-p.at(-1).x,p[0].y-p.at(-1).y)<EPS)p.pop();
  for(let changed=true;changed&&p.length>3;){changed=false;p=p.filter((a,i)=>{const prev=p[(i+p.length-1)%p.length],next=p[(i+1)%p.length];if(Math.abs(cross(prev,a,next))<EPS){changed=true;return false;}return true;});}
  return p;
}
export function inside(p, poly, boundary=true) {
  let hit=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[j],b=poly[i];
    if(Math.abs(cross(a,b,p))/Math.hypot(b.x-a.x,b.y-a.y)<1e-5&&p.x>=Math.min(a.x,b.x)-1e-5&&p.x<=Math.max(a.x,b.x)+1e-5&&p.y>=Math.min(a.y,b.y)-1e-5&&p.y<=Math.max(a.y,b.y)+1e-5)return boundary;
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
  }
  return hit;
}
function triangleContains(p,a,b,c){return cross(a,b,p)>=-EPS&&cross(b,c,p)>=-EPS&&cross(c,a,p)>=-EPS;}
function triangulate(poly){
  const points=signedArea(poly)<0?[...poly].reverse():[...poly],indices=points.map((_,i)=>i),triangles=[];
  for(let attempts=0;indices.length>3&&attempts<poly.length*poly.length;attempts++){
    let removed=false;
    for(let i=0;i<indices.length;i++){
      const ia=indices[(i+indices.length-1)%indices.length],ib=indices[i],ic=indices[(i+1)%indices.length],a=points[ia],b=points[ib],c=points[ic];
      if(cross(a,b,c)<=EPS||indices.some(j=>j!==ia&&j!==ib&&j!==ic&&triangleContains(points[j],a,b,c)))continue;
      triangles.push([a,b,c]);indices.splice(i,1);removed=true;break;
    }
    if(!removed)throw new Error('Footprint triangulation failed; review its geometry.');
  }
  if(indices.length===3)triangles.push(indices.map(i=>points[i]));
  return triangles;
}
function halfPlane(poly,{a,b,c}){
  const out=[];
  for(let i=0;i<poly.length;i++){
    const from=poly[i],to=poly[(i+1)%poly.length],d0=a*from.x+b*from.y-c,d1=a*to.x+b*to.y-c;
    if(d0<=EPS)out.push(from);
    if((d0>EPS)!==(d1>EPS)){const t=d0/(d0-d1);out.push({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t});}
  }
  return clean(out);
}
/** Triangle clipping avoids the fake bridges a concave Sutherland clip creates. */
export function clippedRegions(poly, cuts){
  const edges=new Map(),key=p=>`${round(p.x)},${round(p.y)}`;
  for(const triangle of triangulate(poly)){
    const clipped=cuts.reduce((p,cut)=>p.length?halfPlane(p,cut):p,triangle);
    if(clipped.length<3||area(clipped)<EPS)continue;
    for(let i=0;i<clipped.length;i++){
      const a=clipped[i],b=clipped[(i+1)%clipped.length],direct=`${key(a)}|${key(b)}`,reverse=`${key(b)}|${key(a)}`;
      if(edges.has(reverse))edges.delete(reverse);else edges.set(direct,[point(a.x,a.y),point(b.x,b.y)]);
    }
  }
  const loops=[];
  while(edges.size){
    const [first,[start,next]]=edges.entries().next().value;edges.delete(first);const loop=[start];let current=next;
    for(let i=0;key(current)!==key(start)&&i<1000;i++){
      loop.push(current);const found=[...edges.entries()].find(([,edge])=>key(edge[0])===key(current));
      if(!found)throw new Error('Unclosed clipped footprint; review coordinate precision.');
      edges.delete(found[0]);current=found[1][1];
    }
    const result=clean(loop);if(result.length>=3&&area(result)>1e-5)loops.push(result);
  }
  return loops.sort((a,b)=>area(b)-area(a));
}
const rect=(x0,y0,x1,y1)=>[{a:-1,b:0,c:-x0},{a:1,b:0,c:x1},{a:0,b:-1,c:-y0},{a:0,b:1,c:y1}];
const centre=poly=>{
  const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y),mid=point((Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2);
  if(inside(mid,poly,false))return mid;
  const triangle=triangulate(poly).sort((a,b)=>area(b)-area(a))[0];return point(triangle.reduce((s,p)=>s+p.x,0)/3,triangle.reduce((s,p)=>s+p.y,0)/3);
};
function nearestBoundary(p,poly){let result,best=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));const q=point(a.x+t*dx,a.y+t*dy),distance=Math.hypot(p.x-q.x,p.y-q.y);if(distance<best){best=distance;result=q;}}return result;}
function transform(origin,angle){const c=Math.cos(angle),s=Math.sin(angle);return {angle:angle*180/Math.PI,local:p=>point((p.x-origin.x)*c+(p.y-origin.y)*s,-(p.x-origin.x)*s+(p.y-origin.y)*c),world:p=>point(origin.x+p.x*c-p.y*s,origin.y+p.x*s+p.y*c)};}
const room=(name,kind='office',capacity=12,style='office')=>({name,kind,capacity,style});
const adminNames=[
  [room('Admissions & scholarships','office',24),room('Visitor reception & enquiry','office',24,'reception'),room('Student services','office',24),room('Academic registry','office',18),room('Examinations office','office',16),room('Finance & accounts','office',16),room('Accessible washrooms','other',4,'washroom'),room('Records & archives','other',8,'archive'),room('Human resources','office',16),room('Procurement & estates','office',16),room('Campus operations','office',16),room('Senate meeting room','office',24,'meeting'),room('Staff pantry','staff_room',12,'pantry'),room('Washrooms','other',6,'washroom')],
  [room('Director’s office','office',8,'director'),room('Director’s secretariat','office',12),room('Dean of academics','office',8),room('Dean of research','office',8),room('Registrar’s office','office',10),room('Boardroom','office',24,'meeting'),room('Accessible washrooms','other',4,'washroom'),room('Planning & quality office','office',12),room('Research & innovation office','office',16),room('International relations','office',12),room('Conference room','office',18,'meeting'),room('Legal & governance office','office',10),room('Staff lounge & pantry','staff_room',16,'pantry'),room('Washrooms','other',6,'washroom')],
];
const computingNames=[
 [room('Programming laboratory','laboratory',24,'lab'),room('Digital learning laboratory','laboratory',20,'lab'),room('Networks teaching laboratory','laboratory',20,'lab'),room('Server & network operations','laboratory',6,'server'),room('Technical support & issue desk','office',10,'reception'),room('Hardware systems laboratory','laboratory',16,'lab'),room('Electronics project workshop','workshop',16,'lab'),room('Faculty discussion room','office',8,'meeting'),room('Equipment store','other',4,'archive'),room('Accessible washrooms','other',4,'washroom'),room('Washrooms','other',6,'washroom')],
 [room('Lecture Room B201','classroom',28,'classroom'),room('Lecture Room B202','classroom',28,'classroom'),room('Lecture Room B203','classroom',28,'classroom'),room('Postgraduate seminar room','classroom',18,'meeting'),room('Faculty common room','staff_room',10,'pantry'),room('Machine learning laboratory','laboratory',20,'lab'),room('Data engineering laboratory','laboratory',20,'lab'),room('Faculty workroom 201','office',12),room('Research lockers & equipment store','other',4,'archive'),room('Accessible washrooms','other',4,'washroom'),room('Washrooms','other',6,'washroom')],
 [room('Cybersecurity research laboratory','laboratory',20,'lab'),room('Intelligent systems laboratory','laboratory',20,'lab'),room('Embedded systems laboratory','laboratory',16,'lab'),room('Doctoral research studio','laboratory',16,'lab'),room('Research reading room','library',12,'archive'),room('Software engineering laboratory','laboratory',20,'lab'),room('Collaborative project studio','workshop',16,'lab'),room('Faculty workroom 301','office',12),room('Project equipment store','other',4,'archive'),room('Accessible washrooms','other',4,'washroom'),room('Washrooms','other',6,'washroom')],
];
export function createInteriorPlan(scene){
 const plan={version:1,fixture:'aaranya-building-interiors-20261027',buildings:[],spaces:[],elements:[],resources:[],limits:['Fictional author-designed interiors; not a surveyed floor plan or certified escape plan.','Furniture symbols are illustrative; only explicitly tagged resources are operational holdings.']};
 for(const {tag,id,angle,count,names} of [{tag:'ADM',id:AARANYA.admin,angle:.45,count:2,names:adminNames},{tag:'CC2',id:AARANYA.computing,angle:.81,count:3,names:computingNames}]){
  const building=scene.elements.find(e=>e.kind==='building'&&e.space_id===id);if(!building)throw new Error(`Missing exact ${tag} building.`);
  const basis=transform(building.geometry.points[0],angle),outline=building.geometry.points.map(basis.local),record={tag,id,element:building,basis,outline,floors:[]};plan.buildings.push(record);
  if(tag==='ADM'){
   const candidates=[];for(let i=0;i<outline.length;i++){const p=outline[i],q=outline[(i+1)%outline.length];if(Math.min(p.x,q.x)<=-80&&Math.max(p.x,q.x)>=-80&&Math.abs(p.x-q.x)>EPS)candidates.push(point(-80,p.y+(q.y-p.y)*(-80-p.x)/(q.x-p.x)));}
   record.entry=candidates.sort((p,q)=>p.y-q.y)[0];
   const approach=scene.elements.find(e=>e.id==='journey_walk_osm_way_667927769');
   if(!approach?.navigation||approach.geometry.points[0].x!==387.094||approach.geometry.points[0].y!==275.815)throw new Error('The exact reviewed Administration approach junction changed.');
   record.approach=approach.geometry.points[0];
  }
  for(let level=0;level<count;level++){
   const floorKey=`${tag}_F${level}`,floor={key:floorKey,name:level===0?'Ground floor':level===1?(tag==='CC2'?'Teaching floor':'First floor'):'Second floor',code:`AIT-INT-${tag}-F${level}`,kind:'floor',parent:id,id:tag==='CC2'&&level===1?AARANYA.teaching:undefined,rooms:[],level};plan.spaces.push(floor);record.floors.push(floor);
   const addRoom=(index,cuts,door)=>{
    const parts=clippedRegions(outline,cuts);if(parts.length!==1||area(parts[0])<5)throw new Error(`${floorKey}/${index} needs a single useful room region (${parts.length}).`);
    const spec=names[level][index],local=parts[0],actualDoor=inside(door,local)?door:nearestBoundary(point(-17,0),local),r={...spec,key:`${floorKey}_R${String(index+1).padStart(2,'0')}`,code:`AIT-INT-${tag}-${level}${String(index+1).padStart(2,'0')}`,parent:floorKey,polygon:local.map(basis.world),local,centre:centre(local),door:actualDoor,rotation:basis.angle,id:tag==='CC2'&&level===1&&index<3?AARANYA.existingRooms[index]:undefined};
    floor.rooms.push(r);plan.spaces.push(r);return r;
   };
   if(tag==='ADM'){
    const xs=[-108,-89,-71,-53,-35,-17,1,20];
    for(let side=0;side<2;side++)for(let i=0;i<7;i++){const door=point((xs[i]+xs[i+1])/2,side===0?19:40);addRoom(side*7+i,rect(xs[i],side===0?-10:40,xs[i+1],side===0?19:70),door);}
    floor.halls=clippedRegions(outline,rect(-110,19,22,40));floor.junctions=[point(-101,29),...xs.slice(0,-1).map((x,i)=>point((x+xs[i+1])/2,29)),point(15,29)];
    floor.connectors={stairs:[point(-94,29),point(8,29)],lift:point(-78,29)};
   }else{
    const c=Math.cos(.585),s=Math.sin(.585),u=p=>(p.x+17)*c+p.y*s,v=p=>-(p.x+17)*s+p.y*c;
    const west={a:c,b:s,c:-17*c},east={a:-c,b:-s,c:17*c},xs=[-62,-46,-31,-16,5];
    for(let i=0;i<4;i++)addRoom(i,[...rect(xs[i],-25,xs[i+1],-2),west],point((xs[i]+xs[i+1])/2,-2));
    addRoom(4,[...rect(-62,2,-16,8),west],point(-39,2));
    const uv=(a,b)=>point(-17+a*c-b*s,a*s+b*c),us=[0,16,32,44];
    for(let side=0;side<2;side++)for(let i=0;i<3;i++){
      const vlo=side===0?-30:2,vhi=side===0?-2:30;
      const cuts=[east,{a:-c,b:-s,c:17*c-us[i]},{a:c,b:s,c:us[i+1]-17*c},{a:s,b:-c,c:-vlo-17*s},{a:-s,b:c,c:vhi+17*s}];
      addRoom(5+side*3+i,cuts,uv((us[i]+us[i+1])/2,side===0?-2:2));
    }
    floor.halls=[...clippedRegions(outline,[...rect(-62,-2,5,2),west]),...clippedRegions(outline,[east,{a:s,b:-c,c:2-17*s},{a:-s,b:c,c:2+17*s},{a:c,b:s,c:44-17*c}]),...clippedRegions(outline,[{a:-c,b:-s,c:17*c-44}])];floor.junctions=[point(-57,0),point(-46,0),point(-31,0),point(-17,0),uv(8,0),uv(24,0),uv(38,0),uv(44,0)];
    floor.connectors={stairs:[point(-52,0),uv(38,0)],lift:point(-25,0)};floor.uv=uv;floor.u=u;floor.v=v;
   }
  }
 }
 return plan;
}

export const resourceTypes=Object.freeze({
 computer:{code:'AIT-INT-COMPUTERS',name:'Computers & workstations',category:'computer',tracking_mode:'individual',unit_label:'computer'},
 printer:{code:'AIT-INT-PRINTERS',name:'Printers & document equipment',category:'other',tracking_mode:'individual',unit_label:'printer'},
 projector:{code:'AIT-INT-PROJECTORS',name:'Teaching & meeting projectors',category:'display',tracking_mode:'individual',unit_label:'projector'},
 server_rack:{code:'AIT-INT-SERVERS',name:'Server & network racks',category:'network',tracking_mode:'individual',unit_label:'rack'},
 fire_extinguisher:{code:'AIT-INT-FIRE',name:'Fire extinguishers',category:'safety',tracking_mode:'individual',unit_label:'extinguisher'},
 first_aid:{code:'AIT-INT-FIRST-AID',name:'First-aid cabinets',category:'safety',tracking_mode:'individual',unit_label:'cabinet'},
 water_point:{code:'AIT-INT-WATER',name:'Indoor drinking-water stations',category:'other',tracking_mode:'individual',unit_label:'station'},
 desk:{code:'AIT-INT-DESKS',name:'Office & laboratory desks',category:'furniture',tracking_mode:'pooled',unit_label:'desk'},
 chair:{code:'AIT-INT-CHAIRS',name:'Office & visitor chairs',category:'furniture',tracking_mode:'pooled',unit_label:'chair'},
 cabinet:{code:'AIT-INT-CABINETS',name:'Storage & filing cabinets',category:'furniture',tracking_mode:'pooled',unit_label:'cabinet'},
 meeting_table:{code:'AIT-INT-TABLES',name:'Meeting & shared work tables',category:'furniture',tracking_mode:'pooled',unit_label:'table'},
 lift:{code:'AIT-INT-LIFTS',name:'Indoor passenger lifts',category:'other',tracking_mode:'individual',unit_label:'lift'},
});

/** Resolve keys to canonical IDs only after ordinary topology commands succeed. */
export function materializeInteriorPlan(plan,ids={}){
 const elements=[],resources=[],spaces=[...plan.spaces],resolve=key=>ids[key]??key;
 const fixture=(b,f,r,key,asset,p,width,depth,height,rotation,tracked=false,resourceType=asset)=>{
  const id=PREFIX+key,spaceKey=r?.key??`${f.key}_HALL`,item={id,kind:'fixture',label:`${r?.name??f.name} · ${asset.replaceAll('_',' ')}`,geometry:{type:'point',points:[b.basis.world(p)]},space_id:resolve(spaceKey),floor_id:resolve(f.key),parent_element_id:b.element.id,asset_key:asset,width,depth,height,rotation_deg:round(rotation),material:['desk','chair','meeting_table','cabinet'].includes(asset)?'wood':'metal',review_state:'reviewed'};
  if(tracked){const tag=`AIT-INT-${key.replaceAll('_','-')}`;resources.push({key,space:spaceKey,type:resourceType,name:item.label,quantity:1,asset_tag:tag});item.holding_id=resolve(`holding:${key}`);}
  elements.push(item);return item;
 };
 const path=(b,f,key,points,end=null)=>{if(points.length<2)return;elements.push({id:PREFIX+key,kind:'path',label:`${f.name} corridor`,geometry:{type:'polyline',points:points.map(b.basis.world)},space_id:null,floor_id:resolve(f.key),parent_element_id:b.element.id,asset_key:'paving',width:2.4,material:'paving',review_state:'reviewed',navigation:{walkable:true,accessible:true,status:'open',start_space_id:null,end_space_id:end?resolve(end):null}});};
 for(const b of plan.buildings)for(const f of b.floors){
  const hallKey=`${f.key}_HALL`,hallName=b.tag==='ADM'?(f.level===0?'Reception & public concourse':'Administration gallery'):'Circulation & lift lobby';
  spaces.push({key:hallKey,code:`AIT-INT-${b.tag}-F${f.level}-HALL`,parent:f.key,name:hallName,kind:'other',capacity:null});
  f.halls.forEach((poly,index)=>elements.push({id:PREFIX+`${hallKey}_${index}`,kind:'room',label:hallName,geometry:{type:'polygon',points:poly.map(b.basis.world)},space_id:resolve(hallKey),floor_id:resolve(f.key),parent_element_id:b.element.id,material:'paving',review_state:'reviewed'}));
  const nodes=[...f.junctions,...f.connectors.stairs,f.connectors.lift];
  const counts=new Map();
  for(const [index,r]of f.rooms.entries()){
   elements.push({id:r.id?`journey_room_${r.id}`:PREFIX+r.key,kind:'room',label:r.name,geometry:{type:'polygon',points:r.polygon},space_id:resolve(r.key),floor_id:resolve(f.key),parent_element_id:b.element.id,asset_key:['lab','server'].includes(r.style)?'laboratory':r.style==='classroom'?'academic':'generic',material:r.style==='washroom'?'concrete':'neutral',review_state:'reviewed'});
   const eastBay=(index-5)%3;
   const junction=b.tag==='ADM'?point(r.door.x,29):index<5?(index===3?point(-17,0):point(r.door.x,0)):f.uv([8,24,38][eastBay],0);
   nodes.push(junction);
   const dx=r.centre.x-r.door.x,dy=r.centre.y-r.door.y,length=Math.hypot(dx,dy),inner=point(r.door.x+dx/length*.8,r.door.y+dy/length*.8);
   path(b,f,`${r.key}_access`,[junction,r.door,inner],r.key);
   const rotation=b.basis.angle+(b.tag==='CC2'&&index>=5?.585*180/Math.PI:0),a=(rotation-b.basis.angle)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),local=p=>point(p.x*c+p.y*s,-p.x*s+p.y*c),back=p=>point(p.x*c-p.y*s,p.x*s+p.y*c),poly=r.local.map(local),xs=poly.map(p=>p.x),ys=poly.map(p=>p.y);
   fixture(b,f,r,`${r.key}_DOOR`,'door',r.door,1.4,.16,2.2,rotation);
   const add=(asset,p,w,d,h=.8,tracked=false)=>{const key=`${r.key}_${asset.toUpperCase()}${String(elements.filter(e=>e.id.startsWith(PREFIX+r.key+'_'+asset.toUpperCase())).length+1).padStart(2,'0')}`;const item=fixture(b,f,r,key,asset,back(p),w,d,h,rotation,tracked);if(resourceTypes[asset]?.tracking_mode==='pooled')counts.set(`${r.key}|${asset}`,(counts.get(`${r.key}|${asset}`)??0)+1);return item;};
   const footprintFits=(p,w,d)=>[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].every(([x,y])=>inside(point(p.x+x,p.y+y),poly,false));
   const candidates=[],compact=['washroom','archive','server'].includes(r.style),baseWidth=compact?1.2:2.2,baseDepth=compact?1.4:2.8;
   for(let y=Math.min(...ys)+baseDepth/2+.2;y<Math.max(...ys)-.5;y+=compact?2.4:3.3)for(let x=Math.min(...xs)+baseWidth/2+.2;x<Math.max(...xs)-.5;x+=compact?2.2:3.2){const p=point(x,y),q=back(p);if(footprintFits(p,baseWidth,baseDepth)&&Math.hypot(q.x-r.door.x,q.y-r.door.y)>(r.style==='washroom'?1.2:2.5)&&!(b.tag==='ADM'&&f.level===0&&index===1&&Math.abs(q.x+80)<2.3))candidates.push(p);}
   const middle=local(r.centre);candidates.sort((p,q)=>Math.hypot(p.x-middle.x,p.y-middle.y)-Math.hypot(q.x-middle.x,q.y-middle.y));
   const selected=[],take=(max,w=2.2,d=2.6)=>{for(const p of candidates){if(selected.length>=max)break;if(footprintFits(p,w,d)&&selected.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>3))selected.push(p);}return selected;};
   if(r.style==='washroom'){
    for(const p of take(Math.min(4,r.capacity),1.2,1.4)){add('toilet',p,.7,1.1,.5);const basin=point(p.x+.9,p.y);if(footprintFits(basin,.6,.6))add('washbasin',basin,.6,.6,.8);}
   }else if(r.style==='server'){
    for(const p of take(4,1.2,1.2))add('server_rack',p,.8,1.1,2.1,true);
    const p=candidates.find(p=>selected.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>2));if(p){add('desk',p,1.6,.8);add('computer',point(p.x,p.y-.05),.7,.35,1.1,true);add('chair',point(p.x,p.y+1),.65,.65,.85);}
   }else if(r.style==='archive'){
    for(const p of take(8,1.3,1.1))add('cabinet',p,1.2,.55,1.8);
   }else if(r.style==='meeting'||r.style==='pantry'){
    const full=candidates.find(p=>footprintFits(p,5,3.6)),p=full??candidates.find(p=>footprintFits(p,3.2,2.8));if(p){add('meeting_table',p,full?4:2.5,full?1.8:1.1);for(const x of(full?[-1.4,0,1.4]:[-.8,.8]))for(const y of(full?[-1.5,1.5]:[-1.05,1.05])){const q=point(p.x+x,p.y+y);if(footprintFits(q,.65,.65))add('chair',q,.65,.65,.85);}if(r.style==='meeting')add('projector',p,.45,.35,2.7,true);}
    const p2=candidates.find(q=>!p||Math.hypot(q.x-p.x,q.y-p.y)>6);if(p2)add('cabinet',p2,1.2,.55,1.3);
   }else{
    const max=r.style==='classroom'?14:r.style==='lab'?8:r.style==='director'?2:r.style==='reception'?4:b.tag==='ADM'?6:4;
    for(const p of take(max)){
      add('desk',p,1.8,.85);
      if(r.style==='classroom'){add('chair',point(p.x-.45,p.y+1.05),.65,.65,.85);add('chair',point(p.x+.45,p.y+1.05),.65,.65,.85);}else add('chair',point(p.x,p.y+1.05),.65,.65,.85);
      if(r.style!=='classroom')add('computer',point(p.x,p.y-.08),.7,.35,1.1,true);
    }
    if(r.style==='lab'||r.style==='classroom'){const p=candidates.find(p=>selected.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>2.5));if(p){add('whiteboard',p,2.2,.16,1.8);add('projector',point(p.x,p.y+.45),.45,.35,2.7,true);}}
    if(['office','reception','director'].includes(r.style)){const p=candidates.find(p=>selected.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>2.5));if(p)add('cabinet',p,1.2,.55,1.8);}
    if(['office','reception'].includes(r.style)&&index%3===0){const p=candidates.find(p=>selected.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>3.3));if(p)add('printer',p,.65,.6,.9,true);}
   }
   // Exterior glazing follows real footprint edges; no windows on party walls.
   let windows=0;
   for(let edge=0;edge<r.local.length&&windows<2;edge++){
    const p=r.local[edge],q=r.local[(edge+1)%r.local.length],mid=point((p.x+q.x)/2,(p.y+q.y)/2),outer=nearestBoundary(mid,b.outline);
    if(Math.hypot(mid.x-outer.x,mid.y-outer.y)>.001||Math.hypot(p.x-q.x,p.y-q.y)<3)continue;
    fixture(b,f,r,`${r.key}_WINDOW${++windows}`,'window',mid,Math.min(4,Math.hypot(p.x-q.x,p.y-q.y)-1),.15,1.5,b.basis.angle+Math.atan2(q.y-p.y,q.x-p.x)*180/Math.PI);
   }
  }
  // Every branch shares an exact corridor vertex; no proximity snapping.
  const unique=nodes.filter((p,i)=>nodes.findIndex(q=>q.x===p.x&&q.y===p.y)===i);
  if(b.tag==='ADM')path(b,f,`${f.key}_spine`,unique.sort((p,q)=>p.x-q.x));
  else{const west=unique.filter(p=>p.y===0&&p.x<=-17).sort((p,q)=>p.x-q.x),east=unique.filter(p=>!(p.y===0&&p.x<=-17)).sort((p,q)=>f.u(p)-f.u(q));path(b,f,`${f.key}_spine`,[...west,...east]);}
  for(const [key,quantity]of counts){const [space,type]=key.split('|');resources.push({key:`${space}_POOL_${type.toUpperCase()}`,space,type,name:`${f.rooms.find(r=>r.key===space).name} · ${resourceTypes[type].name.toLowerCase()}`,quantity,asset_tag:null});}
  if(b.tag==='ADM'){
   const hallCounts={chair:0,meeting_table:0};let group=0;
   for(const x of[-65,-42,-20])for(const y of[24,35]){
    fixture(b,f,null,`${f.key}_WAIT_TABLE${++group}`,'meeting_table',point(x,y),1.2,.8,.65,b.basis.angle);hallCounts.meeting_table++;
    for(const [seat,[dx,dy]]of [[-1.1,0],[1.1,0],[0,-1.1],[0,1.1]].entries()){fixture(b,f,null,`${f.key}_WAIT_CHAIR${group}_${seat}`,'chair',point(x+dx,y+dy),.65,.65,.85,b.basis.angle);hallCounts.chair++;}
   }
   for(const [type,quantity]of Object.entries(hallCounts))resources.push({key:`${hallKey}_POOL_${type.toUpperCase()}`,space:hallKey,type,name:`${hallName} · ${resourceTypes[type].name.toLowerCase()}`,quantity,asset_tag:null});
  }
  const equipment=b.tag==='ADM'?[['fire_extinguisher',point(-94,23)],['fire_extinguisher',point(8,35)],['first_aid',point(-75,23)],['water_point',point(-75,35)]]:[['fire_extinguisher',point(-51,1.5)],['fire_extinguisher',f.uv(38,1.5)],['first_aid',point(-25,-1.5)],['water_point',point(-23,1.5)]];
  for(const [index,[asset,p]]of equipment.entries())fixture(b,f,null,`${f.key}_SAFETY${index+1}`,asset,p,.55,.45,asset==='water_point'?1.2:.8,b.basis.angle,true);
  if(b.tag==='CC2'){
    const entry=b.basis.local(b.element.geometry.points[12]);path(b,f,`${f.key}_entry`,[f.uv(44,0),entry]);
    if(f.level===0)elements.push({id:PREFIX+`${b.tag}_ENTRANCE`,kind:'fixture',label:`${b.element.label} main entrance`,geometry:{type:'point',points:[b.basis.world(entry)]},space_id:null,floor_id:null,parent_element_id:b.element.id,asset_key:'door',width:1.8,depth:.2,rotation_deg:b.basis.angle,review_state:'reviewed',navigation_connector:{kind:'entrance',status:'open',accessible:true,from_floor_id:null,to_floor_id:resolve(f.key)}});
  }
  if(b.tag==='ADM'&&f.level===0){
   const junction=point(-80,29);path(b,f,`${f.key}_reception_entry`,[b.entry,point(-80,19),junction]);
   // Add the reception's exact junction to the existing authored spine.
   const spine=elements.find(e=>e.id===PREFIX+`${f.key}_spine`),entryJunction=b.basis.world(junction);if(!spine.geometry.points.some(p=>p.x===entryJunction.x&&p.y===entryJunction.y))spine.geometry.points.push(entryJunction);spine.geometry.points.sort((p,q)=>b.basis.local(p).x-b.basis.local(q).x);
   const entry=b.basis.world(b.entry);
   elements.push({id:PREFIX+`${b.tag}_approach`,kind:'path',label:'Administration reception approach',geometry:{type:'polyline',points:[b.approach,entry]},space_id:null,floor_id:null,parent_element_id:b.element.id,asset_key:'paving',width:2.4,material:'paving',review_state:'reviewed',navigation:{walkable:true,accessible:true,status:'open',start_space_id:null,end_space_id:b.id}});
   elements.push({id:PREFIX+`${b.tag}_ENTRANCE`,kind:'fixture',label:'Administration reception entrance',geometry:{type:'point',points:[entry]},space_id:null,floor_id:null,parent_element_id:b.element.id,asset_key:'door',width:1.8,depth:.2,rotation_deg:b.basis.angle,review_state:'reviewed',navigation_connector:{kind:'entrance',status:'open',accessible:true,from_floor_id:null,to_floor_id:resolve(f.key)}});
  }
  if(f.level===0){
   const lift=fixture(b,f,null,`${b.tag}_PASSENGER_LIFT`,'equipment',f.connectors.lift,2.1,2.1,2.4,b.basis.angle,true,'lift');
   lift.label=`${b.element.label} passenger lift`;resources.at(-1).name=lift.label;
   lift.navigation_connector={kind:'lift',status:'open',accessible:true,from_floor_id:resolve(f.key),to_floor_id:resolve(b.floors[1].key)};
  }else if(f.level===2){
   const shaft=fixture(b,f,null,`${f.key}_LIFT_SHAFT`,'equipment',f.connectors.lift,2.1,2.1,2.4,b.basis.angle);shaft.label='Lift shaft · floor connection not mapped';
  }
  for(const [index,p]of f.connectors.stairs.entries())if(f.level<b.floors.length-1)elements.push({id:PREFIX+`${f.key}_STAIR${index+1}`,kind:'fixture',label:`${index===0?'West':'East'} stairs`,geometry:{type:'point',points:[b.basis.world(p)]},space_id:null,floor_id:resolve(f.key),parent_element_id:b.element.id,asset_key:'equipment',width:2.2,depth:3.8,rotation_deg:b.basis.angle,review_state:'reviewed',navigation_connector:{kind:'stairs',status:'open',accessible:false,from_floor_id:resolve(f.key),to_floor_id:resolve(b.floors[f.level+1].key)}});
 }
 return {spaces,elements,resources};
}

import type { CampusSceneElement } from './types';
import type { SceneLighting } from './sceneLighting';
import { SCENE_PLANE_TRANSFORM, type SceneViewMode } from './sceneGeometry';
import { sceneIndoorDimensions } from './sceneIndoorAssets';

/** Authored floor-plan symbols, independent of campus and resource identity. */
export function SceneIndoorFixture({element,mode,unit,lighting}:{element:CampusSceneElement;mode:SceneViewMode;unit:number;lighting:SceneLighting}) {
  const p=element.geometry.points[0]; if(!p) return null;
  const {width:w,depth:d,rotation}=sceneIndoorDimensions(element,unit), x=-w/2,y=-d/2;
  const night=lighting==='night', ink=night?'#c2cfd1':'#5d6b70', soft=night?'#33454e':'#e8ece9', white=night?'#697c83':'#fcfbf7', wood=night?'#8d806d':'#d3b58a', blue=night?'#6e9aa8':'#93b8c4';
  const sw=Math.min(w,d)*.035, key=element.asset_key;
  const body=(fill:string,rx=.06)=> <rect x={x} y={y} width={w} height={d} rx={Math.min(w,d)*rx} fill={fill} stroke={ink} strokeWidth={sw}/>;
  let drawing;
  switch(key) {
    case 'desk': drawing=<>{body(wood)}<path d={`M ${x+w*.07} ${y+d*.12} H ${x+w*.93} M ${x+w*.08} ${y+d*.83} H ${x+w*.92}`} fill="none" stroke={white} strokeOpacity=".35" strokeWidth={sw}/>{[.12,.88].flatMap(a=>[.15,.85].map(b=><circle key={`${a}-${b}`} cx={x+w*a} cy={y+d*b} r={Math.min(w,d)*.035} fill={ink}/>))}</>; break;
    case 'chair': drawing=<><path d={`M ${-w*.35} ${d*.3} L ${w*.35} ${-d*.2} M ${w*.35} ${d*.3} L ${-w*.35} ${-d*.2}`} stroke={ink} strokeWidth={sw*1.7}/><rect x={-w*.36} y={-d*.22} width={w*.72} height={d*.61} rx={w*.12} fill={blue} stroke={ink} strokeWidth={sw}/><rect x={x} y={y} width={w} height={d*.24} rx={d*.1} fill={ink}/></>; break;
    case 'computer': drawing=<><rect x={-w*.1} y={-d*.2} width={w*.2} height={d*.65} rx={sw} fill={ink}/><rect x={-w*.23} y={d*.22} width={w*.46} height={d*.15} rx={sw} fill={soft}/><rect x={x} y={y} width={w} height={d*.55} rx={sw*2} fill={ink}/><rect x={x+w*.055} y={y+d*.06} width={w*.89} height={d*.4} rx={sw} fill={blue}/><path d={`M ${-w*.37} ${d*.43} H ${w*.37}`} stroke={ink} strokeWidth={d*.1}/></>; break;
    case 'meeting_table': drawing=<>{body(wood,.35)}<rect x={x+w*.05} y={y+d*.12} width={w*.9} height={d*.76} rx={d*.3} fill="none" stroke={white} strokeOpacity=".4" strokeWidth={sw}/><circle r={d*.035} fill={ink}/></>; break;
    case 'cabinet': drawing=<>{body(wood)}<path d={`M 0 ${y} V ${-y} M ${-w*.08} ${-d*.12} V ${d*.12} M ${w*.08} ${-d*.12} V ${d*.12}`} stroke={ink} strokeWidth={sw}/></>; break;
    case 'server_rack': drawing=<>{body(night?'#293b44':'#536a76')}{Array.from({length:6},(_,i)=><g key={i}><rect x={x+w*.1} y={y+d*(.08+i*.14)} width={w*.8} height={d*.1} rx={sw} fill={ink}/><path d={`M ${-w*.27} ${y+d*(.13+i*.14)} H ${w*.18}`} stroke={soft} strokeWidth={sw}/><circle cx={w*.29} cy={y+d*(.13+i*.14)} r={sw} fill="#d7b85e"/></g>)}</>; break;
    case 'printer': drawing=<>{body(white)}<rect x={-w*.32} y={-d*.25} width={w*.64} height={d*.28} rx={sw} fill={blue} stroke={ink} strokeWidth={sw}/><rect x={-w*.3} y={d*.12} width={w*.6} height={d*.22} fill={soft}/><path d={`M ${-w*.24} ${d*.2} H ${w*.24}`} stroke={ink} strokeWidth={sw}/></>; break;
    case 'fire_extinguisher': drawing=<><rect x={x} y={y} width={w} height={d} rx={Math.min(w,d)*.22} fill="#b85447" stroke={night?'#e4b8a9':'#803c34'} strokeWidth={sw}/><path d={`M ${-w*.25} ${y} V ${y-d*.2} H ${w*.18} L ${w*.45} ${y+d*.3}`} fill="none" stroke={ink} strokeWidth={sw*2}/><rect x={-w*.22} y={-d*.15} width={w*.44} height={d*.3} fill="#f3e5d2"/></>; break;
    case 'first_aid': drawing=<>{body(white)}<path d={`M ${-w*.25} 0 H ${w*.25} M 0 ${-d*.3} V ${d*.3}`} stroke="#498b72" strokeWidth={Math.min(w,d)*.15}/></>; break;
    case 'toilet': drawing=<><rect x={-w*.42} y={y} width={w*.84} height={d*.27} rx={sw*2} fill={white} stroke={ink} strokeWidth={sw}/><ellipse cx={0} cy={d*.12} rx={w*.4} ry={d*.35} fill={white} stroke={ink} strokeWidth={sw}/><ellipse cx={0} cy={d*.12} rx={w*.23} ry={d*.21} fill={soft} stroke={ink} strokeWidth={sw*.7}/></>; break;
    case 'washbasin': drawing=<>{body(white,.15)}<ellipse rx={w*.32} ry={d*.28} fill={soft} stroke={ink} strokeWidth={sw}/><circle r={sw} fill={ink}/><path d={`M 0 ${y} V ${y+d*.23}`} stroke={ink} strokeWidth={sw*2}/></>; break;
    case 'door': drawing=<><path d={`M ${x} ${y} H ${-x}`} stroke={night?'#2c3740':'#fffdf7'} strokeWidth={unit*.5}/><path d={`M ${x} ${y} V ${y+w} A ${w} ${w} 0 0 0 ${x+w} ${y}`} fill="none" stroke={ink} strokeWidth={sw}/><path d={`M ${x} ${y} V ${y+w}`} stroke={wood} strokeWidth={sw*3}/></>; break;
    case 'window': drawing=<>{body(blue,0)}<path d={`M 0 ${y} V ${-y} M ${x} 0 H ${-x}`} stroke={white} strokeWidth={sw*2}/></>; break;
    case 'projector': drawing=<>{body(white,.2)}<circle cx={w*.23} r={d*.22} fill={blue} stroke={ink} strokeWidth={sw}/><path d={`M ${-w*.3} ${-d*.12} H ${-w*.05} M ${-w*.3} ${d*.12} H ${-w*.05}`} stroke={ink} strokeWidth={sw}/></>; break;
    case 'whiteboard': drawing=<>{body(white,0)}<path d={`M ${-w*.42} ${d*.4} H ${w*.42}`} stroke={ink} strokeWidth={sw*2}/></>; break;
    default:return null;
  }
  return <g data-indoor-fixture={key} transform={mode==='2.5d'?SCENE_PLANE_TRANSFORM:undefined}><g transform={`translate(${p.x} ${p.y}) rotate(${rotation})`} strokeLinejoin="round" strokeLinecap="round">{drawing}</g></g>;
}

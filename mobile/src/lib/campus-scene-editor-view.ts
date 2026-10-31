import type { CampusSceneDocument } from '../../../packages/contracts/src/campus-scenes/types';
import { sceneVisibleElements } from '../../../packages/contracts/src/campus-scenes/sceneGeometry';
/** A reviewed floor proposal may not yet have a canonical floor ID. Its exact
 * local element set supplies the interior; outdoor geometry is never borrowed. */
export function nativeEditorVisibleElements(scene:CampusSceneDocument,floorId:string|null,proposalIds?:readonly string[]){
 if(!proposalIds)return sceneVisibleElements(scene.elements,floorId);
 const ids=new Set(proposalIds);return scene.elements.filter(e=>ids.has(e.id)||(floorId!==null&&e.floor_id===floorId));
}

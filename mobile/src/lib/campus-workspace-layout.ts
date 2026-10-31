/** Frame intersection handles iOS overlay keyboards and Android resize equally. */
export function campusKeyboardOverlap(frame:{y:number;height:number},keyboardTop:number|null):number{
  if(keyboardTop===null||![frame.y,frame.height,keyboardTop].every(Number.isFinite)||frame.height<=0)return 0;
  return Math.max(0,Math.min(frame.height,frame.y+frame.height-keyboardTop));
}
export function campusPanelHeight(height:number,expanded:boolean,keyboardVisible:boolean,interior=false,bottomOverlap=0):number{
  const frame=Math.max(0,Number.isFinite(height)?height:0);
  // A floating dock is outside the usable details viewport. Reserving it only
  // inside ScrollView content leaves a resting floor panel almost entirely
  // covered, even though its last row can technically be scrolled into view.
  const bottom=keyboardVisible?0:Math.min(frame,Math.max(0,Number.isFinite(bottomOverlap)?bottomOverlap:0));
  const available=frame-bottom;
  if(keyboardVisible)return Math.max(0,available-Math.min(64,available*.24));
  // A floor is the current destination. Its resting sheet leaves the drawing
  // usable below both toolbar rows; expanded details remain scrollable beside it.
  if(interior){const resting=Math.min(170,available*.28);return bottom+(expanded?Math.max(resting,Math.min(available*.43,available-Math.min(380,available*.6))):resting);}
  return bottom+Math.min(available,Math.max(170,available*(expanded?.64:.43)));
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { iosDockGeometry } from '../src/lib/dock-geometry';

test('a phone dock has equal visible edge spacing while every control remains inside the native bottom safe boundary',()=>{
  for(const bottom of [0,21,34,48])for(const width of [320,360,375,393,402,430])for(const count of [4,5]){
    const dock=iosDockGeometry({width,bottom,count});
    assert.ok(dock.itemWidth>=44,`${width}/${bottom}/${count} preserves a full touch target`);
    const nativeReservation=Math.max(bottom,dock.bottomPadding)+dock.surfaceBottomMargin;
    assert.equal(nativeReservation,dock.visibleBottomGap);
    assert.ok(nativeReservation+dock.interior>=bottom,'glass may enter the safe strip; the actual Pressable never does');
    if(dock.horizontal===dock.visibleBottomGap)assert.equal(dock.horizontal,nativeReservation);
    else assert.equal(dock.itemWidth,44,'only minimum target pressure relaxes equal margins');
  }
  const ordinary=iosDockGeometry({width:393,bottom:34,count:5});
  assert.equal(ordinary.horizontal,28);assert.equal(ordinary.visibleBottomGap,28);
});
test('concentric radii follow measured glass and uniform inset, with bounded curvature when a tall accessibility target is narrower',()=>{
  for(const height of [64,65,80,96]){
    const dock=iosDockGeometry({width:768,height,bottom:20,count:4});
    assert.equal(dock.surfaceRadius,height/2);assert.equal(dock.selectionRadius+dock.interior,dock.surfaceRadius);
  }
  const tall=iosDockGeometry({width:320,height:120,bottom:34,count:5});
  assert.ok(tall.selectionRadius<=tall.itemWidth/2);assert.ok(tall.itemWidth>=44);
});
test('landscape side obstructions are combined once and the centered width cap belongs to the same shape and row',()=>{
  const dock=iosDockGeometry({width:844,bottom:21,left:59,right:59,count:5});
  assert.equal(dock.horizontal,16);assert.equal(dock.surfaceWidth,560);
  assert.ok(dock.surfaceWidth<=844-Math.max(59,dock.horizontal)*2);
  assert.equal(dock.itemWidth*5+dock.gap*4+dock.interior*2,dock.surfaceWidth);
});
test('a stacked iPad app pane adds no physical-home clearance at its divider; invalid measurements never invent negative geometry',()=>{
  const dock=iosDockGeometry({width:600,bottom:34,count:5,physicalBottom:false});
  assert.equal(dock.bottomPadding,0);assert.equal(dock.surfaceBottomMargin,0);assert.equal(dock.visibleBottomGap,0);
  for(const width of [0,NaN,-5]){
    const unknown=iosDockGeometry({width,height:NaN,bottom:NaN,count:0});
    for(const value of Object.values(unknown))assert.ok(Number.isFinite(value)&&value>=0||value===-6);
  }
});

test('four full-size tabs and a separate Assistant circle share one width budget before relaxing edge gutters',()=>{
  for(const width of [320,360,375,393,402,430,600,768])for(const bottom of [0,21,34,48])for(const height of [64,65,80,96,120]){
    const dock=iosDockGeometry({width,bottom,height,count:4,assistantBubble:true});
    assert.ok(dock.itemWidth>=44-1e-8,`${width}/${bottom}/${height}: main labels retain their full touch width`);
    assert.ok(dock.bubbleSize-dock.interior*2>=44,'the round action retains its own full target inside glass');
    assert.ok(dock.bubbleSize<=height,'the round action never protrudes above the measured main dock');
    assert.ok(dock.controlGap>=4&&dock.controlGap<=8);
    assert.equal(dock.surfaceWidth+dock.bubbleSize+dock.controlGap,dock.rowWidth);
    assert.ok(dock.rowWidth+2*dock.horizontal<=width+1e-8);
    assert.ok(dock.rowWidth<=dock.maximumWidth);
    assert.ok(dock.visibleBottomGap+dock.interior>=bottom);
  }
  const ordinary=iosDockGeometry({width:393,bottom:34,count:4,assistantBubble:true});
  assert.equal(ordinary.horizontal,ordinary.visibleBottomGap,'ordinary phones retain concentric outer spacing for the whole row');
  const narrow=iosDockGeometry({width:320,bottom:34,count:4,assistantBubble:true});
  assert.equal(narrow.itemWidth,44);assert.equal(narrow.horizontal,24,'only the outer gutter adapts before shrinking a main control');
});

test('asymmetric safe edges are budgeted before the equal gutter, including a tall accessibility dock',()=>{
  for(const [left,right] of [[20,0],[0,20],[35,0],[10,10],[59,59]]){
    const width=left===59?844:320,dock=iosDockGeometry({width,height:120,bottom:34,left,right,count:4,assistantBubble:true});
    assert.ok(dock.itemWidth>=44-1e-8,`${left}/${right} keeps safe side obstruction and touch widths`);
    assert.ok(dock.rowWidth+Math.max(left,dock.horizontal)+Math.max(right,dock.horizontal)<=width+1e-8);
  }
  const off=iosDockGeometry({width:320,bottom:34,count:4});
  assert.equal(off.bubbleSize,0);assert.equal(off.controlGap,0);assert.equal(off.surfaceWidth,off.rowWidth,'Pro off reserves no invisible fifth slot');
  const stacked=iosDockGeometry({width:320,bottom:34,count:4,assistantBubble:true,physicalBottom:false});
  assert.equal(stacked.bottomPadding,0);assert.equal(stacked.surfaceBottomMargin,0);assert.ok(stacked.itemWidth>=44);
});

test('the same maximum-edge row budget includes browser material borders without reducing any touch target',()=>{
  for(const border of [0,1])for(const height of [64,80,120]){
    const dock=iosDockGeometry({width:320,height,bottom:34,count:4,assistantBubble:true,border});
    const actualRowWidth=320-Math.max(0,dock.horizontal)*2;
    const actualControlWidth=(actualRowWidth-dock.bubbleSize-dock.controlGap-2*(dock.interior+border)-3*dock.gap)/4;
    assert.ok(actualControlWidth>=44-1e-8);
    assert.ok(dock.bubbleSize-2*(dock.interior+border)>=44);
    assert.equal(dock.itemWidth,actualControlWidth);
  }
});

/** Code-generated, rights-owned atlas. Anonymous wardrobe/skin choices are visual
 * variation only; they never infer personal appearance, role or identity. */
export const PEOPLE_ATLAS = { cellWidth: 32, cellHeight: 48, feetY: 43, columns: 24, width: 768, height: 912 } as const;
export function peopleAtlasCell(wardrobe: number, direction: number, step: number) {
  'worklet';
  const index = wardrobe === 6 ? 432 + direction : wardrobe * 72 + direction * 9 + step;
  return { x: index % PEOPLE_ATLAS.columns * PEOPLE_ATLAS.cellWidth, y: Math.floor(index / PEOPLE_ATLAS.columns) * PEOPLE_ATLAS.cellHeight };
}
export function campusPeopleAtlasSvg(night: boolean, selfColor?: string): string {
  const shirts = night ? ['#9bbde7', '#b4c2ab', '#d0b185', '#af9bc0', '#afbbc2', '#c68f83'] : ['#347bba', '#667951', '#ae7952', '#79719d', '#537c8d', '#a9635b'];
  if (selfColor) shirts[0] = selfColor;
  const pants = ['#293743', '#343a3e', '#343e50', '#42423f', '#353e3b', '#3c3848'];
  const skins = ['#ce9c75', '#a87550', '#d3ab86', '#b68060', '#e0b692', '#8b6048'];
  const cells: string[] = [];
  for (let wardrobe = 0; wardrobe < 6; wardrobe++) for (let direction = 0; direction < 8; direction++) for (let step = 0; step < 9; step++) {
    const cell = peopleAtlasCell(wardrobe, direction, step), angle = direction * Math.PI / 4;
    const stride = step ? Math.sin((step - 1) * Math.PI / 4) : 0, bob = step ? Math.abs(stride) * .6 : 0;
    const side = Math.abs(Math.cos(angle)), front = Math.sin(angle) > .2, back = Math.sin(angle) < -.2;
    const torsoWidth = 4.4 - side * 1.2, faceX = Math.cos(angle) * 1.7, skin = skins[wardrobe]!, shirt = shirts[wardrobe]!, pant = pants[wardrobe]!;
    const left = 16 - torsoWidth * .68, right = 16 + torsoWidth * .68;
    const travelX = Math.cos(angle), travelY = Math.sin(angle) * .6;
    const legOne = `${left - stride * travelX * 2.8} ${41 - stride * travelY * 2.8}`, legTwo = `${right + stride * travelX * 2.8} ${41 + stride * travelY * 2.8}`;
    const armOne = `${left - 2.4 + stride * travelX * 1.5} ${30 + stride * travelY * 1.5}`, armTwo = `${right + 2.4 - stride * travelX * 1.5} ${30 - stride * travelY * 1.5}`;
    cells.push(`<g transform="translate(${cell.x} ${cell.y})"><ellipse cx="16.8" cy="43" rx="6" ry="1.6" fill="#132c2b" opacity="${night ? .35 : .2}"/><g transform="translate(0 ${-bob})" stroke-linecap="round" stroke-linejoin="round"><path d="M ${left} 30 Q ${left - stride} 35 ${legOne}" fill="none" stroke="${pant}" stroke-width="3.1"/><path d="M ${right} 30 Q ${right + stride} 35 ${legTwo}" fill="none" stroke="${pant}" stroke-width="3.1"/><path d="M ${legOne} l ${Math.cos(angle) * 2.4} .5 M ${legTwo} l ${Math.cos(angle) * 2.4} .5" stroke="#202b2d" stroke-width="2.1"/><path d="M ${left} 20 Q ${left - 2} 25 ${armOne} M ${right} 20 Q ${right + 2} 25 ${armTwo}" fill="none" stroke="${skin}" stroke-width="2.5"/><path d="M ${16 - torsoWidth} 19 Q 16 16.8 ${16 + torsoWidth} 19 L ${16 + torsoWidth * .85} 30 Q 16 32 ${16 - torsoWidth * .85} 30 Z" fill="${shirt}"/><path d="M ${16 + torsoWidth * .7} 20 L ${16 + torsoWidth * .65} 29" stroke="#122b32" stroke-width=".65" opacity=".25"/><path d="M 14.7 16 L 14.7 18.2 Q 16 19.5 17.3 18.2 L 17.3 16" fill="${skin}"/><ellipse cx="16" cy="12.9" rx="3.2" ry="4.1" fill="${skin}"/><path d="M 12.8 13 Q 11.9 8.6 15.8 8.4 Q 20 8.2 19.2 13.2 L 18.4 10.7 Q 16 11.1 13.5 10.6 Z" fill="${wardrobe % 3 === 1 ? '#383129' : '#252d2d'}"/>${back ? '<path d="M 13 11 Q 16 8.2 19 11 L 18.8 15 Q 16 16.8 13.2 14.8 Z" fill="#29302c"/>' : `<path d="M ${16 + faceX} 12.7 l ${Math.cos(angle) * .8} 1.3 -.6 .5" fill="none" stroke="#6c4938" stroke-width=".5"/>${front ? '<circle cx="14.9" cy="12.8" r=".35" fill="#2a2b28"/><circle cx="17.1" cy="12.8" r=".35" fill="#2a2b28"/>' : ''}`}${wardrobe % 3 === 2 && back ? `<path d="M 13.5 20 Q 16 18.5 18.5 20 L 18.5 27 Q 16 29 13.5 27 Z" fill="#6b5948"/><path d="M 14 21 H 18" stroke="#c6ab83" stroke-width=".6"/>` : ''}${wardrobe === 0 && front ? '<path d="M 14 19 L 16 23 L 18 19" fill="none" stroke="#d9e7e4" stroke-width=".6"/>' : ''}</g></g>`);
  }
  for (let dimension = 0; dimension < 2; dimension++) {
    const cell = peopleAtlasCell(6, dimension, 0), color = dimension ? night ? '#c6c7cf' : '#697584' : night ? '#8ed4b9' : '#39816a';
    cells.push(`<g transform="translate(${cell.x} ${cell.y})" fill="none" stroke="${color}" stroke-width="2.1"><circle cx="16" cy="24" r="10.2" opacity=".7"/>${dimension ? '<path d="m 11 24 3.2 3.3 6.8 -7"/>' : '<ellipse cx="16" cy="24" rx="5.2" ry="3.4"/><circle cx="16" cy="24" r="1.2" fill="' + color + '"/>'}</g>`);
    const wave = peopleAtlasCell(6, dimension + 2, 0);
    cells.push(`<g transform="translate(${wave.x} ${wave.y})" fill="none" stroke="${color}" stroke-width="1.8"><circle cx="16" cy="24" r="10.2"/></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PEOPLE_ATLAS.width}" height="${PEOPLE_ATLAS.height}" viewBox="0 0 ${PEOPLE_ATLAS.width} ${PEOPLE_ATLAS.height}">${cells.join('')}</svg>`;
}

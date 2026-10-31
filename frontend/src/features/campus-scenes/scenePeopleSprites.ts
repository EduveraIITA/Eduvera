import type { SceneLighting } from "./sceneLighting";

const cellWidth = 24, cellHeight = 40, directions = 8, phases = 4, variants = 4;
export interface ScenePeopleSpritePalette { action: string; outline: string; ink: string }
export interface ScenePeopleSpriteAtlas { canvas: HTMLCanvasElement; dpr: number; key: string }

const hash = (value: string) => { let result = 7; for (let index = 0; index < value.length; index++) result = (result * 31 + value.charCodeAt(index)) >>> 0; return result; };
export function scenePeopleDirection(heading: number) { return Number.isFinite(heading) ? ((Math.round(heading / (Math.PI / 4)) % directions) + directions) % directions : 0; }
export function scenePeopleSpriteFrame(phase: number, moving: boolean) { const cycle = phase / (Math.PI * 2); return moving && Number.isFinite(cycle) ? Math.floor(((cycle % 1) + 1) % 1 * phases) : 0; }

/** A bounded procedural atlas, regenerated only for a changed palette/lighting/DPR. */
export function createScenePeopleSpriteAtlas(palette: ScenePeopleSpritePalette, lighting: SceneLighting, pixelRatio: number): ScenePeopleSpriteAtlas | null {
  const dpr = Math.max(1, Math.min(2, pixelRatio)), canvas = document.createElement("canvas");
  canvas.width = cellWidth * directions * phases * dpr; canvas.height = cellHeight * variants * dpr;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(dpr, dpr);
  const garments = lighting === "night" ? ["#94b2bd", "#acb494", "#bd9c8b", palette.action] : ["#527f91", "#78816a", "#a47d68", palette.action];
  const skin = lighting === "night" ? "#c59d7e" : "#cda17c", trousers = lighting === "night" ? "#687580" : "#364b57";
  for (let variant = 0; variant < variants; variant++) for (let direction = 0; direction < directions; direction++) for (let frame = 0; frame < phases; frame++) {
    context.save(); context.translate((direction * phases + frame) * cellWidth + cellWidth / 2, variant * cellHeight);
    const angle = direction * Math.PI / 4, swing = Math.sin(frame * Math.PI / 2), side = Math.cos(angle), facingBack = Math.sin(angle) < -.2;
    const shoulders = 3.4 + Math.abs(Math.sin(angle)) * .9, gait = swing * 2.8, strideX = side * gait, strideY = Math.sin(angle) * gait * .45;
    context.lineCap = "round"; context.lineJoin = "round";
    // Far arm/leg, torso, then near limbs keep a small readable directional silhouette.
    context.strokeStyle = trousers; context.lineWidth = 2.6;
    context.beginPath(); context.moveTo(-1.5, 24); context.lineTo(-2.2 - strideX, 34 - strideY); context.stroke();
    context.strokeStyle = skin; context.lineWidth = 2.2;
    context.beginPath(); context.moveTo(-shoulders, 16); context.lineTo(-shoulders - .6 + strideX * .7, 24 + strideY); context.stroke();
    context.fillStyle = garments[variant]!;
    context.beginPath(); context.moveTo(-shoulders, 14); context.quadraticCurveTo(0, 11.5, shoulders, 14); context.lineTo(shoulders * .78, 24.5); context.quadraticCurveTo(0, 26, -shoulders * .78, 24.5); context.closePath(); context.fill();
    context.strokeStyle = trousers; context.lineWidth = 2.6;
    context.beginPath(); context.moveTo(1.5, 24); context.lineTo(2.2 + strideX, 34 + strideY); context.stroke();
    context.strokeStyle = skin; context.lineWidth = 2.2;
    context.beginPath(); context.moveTo(shoulders, 16); context.lineTo(shoulders + .6 - strideX * .7, 24 - strideY); context.stroke();
    context.fillStyle = skin; context.beginPath(); context.ellipse(side * .45, 8.4, 3.2, 3.8, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = palette.ink; context.beginPath(); context.ellipse(0, facingBack ? 7.5 : 6.4, 3.3, facingBack ? 3.5 : 2.3, 0, Math.PI, Math.PI * 2); context.fill();
    if (!facingBack) { context.fillStyle = skin; context.beginPath(); context.arc(side * 2.8, 9, .8, 0, Math.PI * 2); context.fill(); }
    if (variant === 3) { context.strokeStyle = palette.outline; context.lineWidth = .8; context.beginPath(); context.moveTo(-shoulders * .7, 15.5); context.lineTo(shoulders * .7, 15.5); context.stroke(); }
    context.restore();
  }
  return { canvas, dpr, key: `${lighting}:${dpr}:${palette.action}:${palette.outline}:${palette.ink}` };
}

export function drawScenePeopleSprite(context: CanvasRenderingContext2D, atlas: ScenePeopleSpriteAtlas, key: string, tone: "self" | "expected", heading: number, phase: number, moving: boolean, x: number, y: number, height: number) {
  const variant = tone === "self" ? 3 : hash(key) % 3, direction = scenePeopleDirection(heading), frame = scenePeopleSpriteFrame(phase, moving);
  const scale = height / 34;
  context.drawImage(atlas.canvas, (direction * phases + frame) * cellWidth * atlas.dpr, variant * cellHeight * atlas.dpr, cellWidth * atlas.dpr, cellHeight * atlas.dpr,
    x - cellWidth / 2 * scale, y - 35 * scale, cellWidth * scale, cellHeight * scale);
}

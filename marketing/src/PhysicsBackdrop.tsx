import { useEffect, useRef } from 'react';

type Variant = 'flow' | 'orbit' | 'grid';
type Props = { variant?: Variant; paused?: boolean; className?: string };
type Point = { x: number; y: number; vx: number; vy: number };
type Controller = { refresh: () => void; dispose: () => void };

const TAU = Math.PI * 2;
const point = (x: number, y: number): Point => ({ x, y, vx: 0, vy: 0 });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// A damped spring, integrated in seconds so motion is independent of refresh rate.
function spring(p: Point, x: number, y: number, dt: number, stiffness = 32) {
  const damping = Math.exp(-Math.sqrt(stiffness) * 1.8 * dt);
  p.vx = (p.vx + (x - p.x) * stiffness * dt) * damping;
  p.vy = (p.vy + (y - p.y) * stiffness * dt) * damping;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

function curve(ctx: CanvasRenderingContext2D, points: Point[], width: number, height: number, offset = 0, move = true) {
  const first = points[0];
  if (move) ctx.moveTo(first.x * width, (first.y + offset) * height);
  else ctx.lineTo(first.x * width, (first.y + offset) * height);
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], next = points[i + 1];
    ctx.quadraticCurveTo(p.x * width, (p.y + offset) * height, (p.x + next.x) * width / 2, (p.y + next.y + offset * 2) * height / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x * width, (last.y + offset) * height);
}

function makeBackdrop(canvas: HTMLCanvasElement, variant: Variant, isPaused: () => boolean): Controller {
  const ctx = canvas.getContext('2d', { alpha: true });
  const parent = canvas.parentElement;
  if (!ctx || !parent) return { refresh() {}, dispose() {} };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const pointer = point(0.5, 0.5);
  const target = { x: 0.5, y: 0.5, active: false };
  let width = 0, height = 0, pixelRatio = 1;
  let frame = 0, lastFrame = 0, elapsed = 0, visible = false, disposed = false;

  const ribbons = Array.from({ length: 7 }, (_, layer) =>
    Array.from({ length: 29 }, (_, i) => {
      const x = i / 28 * 1.3 - 0.15;
      return point(x, flowY(x, layer, 0));
    }),
  );
  const reversedRibbons = ribbons.map(ribbon => [...ribbon].reverse());
  const mesh = Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 12 }, (_, col) => point(gridX(col, row), gridY(row))),
  );
  const orbitNodes = Array.from({ length: 9 }, (_, i) => point(...orbitPosition(i, 0)));
  const orbitPaths = Array.from({ length: 3 }, (_, ring) =>
    Array.from({ length: 81 }, (_, i) => point(...ellipsePosition(ring, i / 80 * TAU))),
  );

  function flowY(x: number, layer: number, time: number) {
    return 0.46 + (layer - 3) * 0.072 - (x - 0.5) * 0.27
      + Math.sin(x * 4.2 + layer * 0.2 - time * 0.18) * 0.12;
  }
  function gridX(col: number, row: number) { return 0.04 + col / 11 * 0.88 + row / 7 * 0.04; }
  function gridY(row: number) { return 0.08 + row / 7 * 0.84; }
  function orbitPosition(index: number, time: number): [number, number] {
    const ring = index % 3;
    const angle = index / 9 * TAU + time * (0.08 + ring * 0.015);
    return ellipsePosition(ring, angle);
  }
  function ellipsePosition(ring: number, angle: number): [number, number] {
    const radiusX = 0.27 + ring * 0.105;
    const radiusY = 0.12 + ring * 0.095;
    const rotation = -0.38 + ring * 0.24;
    const x = Math.cos(angle) * radiusX, y = Math.sin(angle) * radiusY;
    return [0.5 + x * Math.cos(rotation) - y * Math.sin(rotation), 0.51 + x * Math.sin(rotation) + y * Math.cos(rotation)];
  }

  function step(dt: number) {
    elapsed += dt;
    spring(pointer, target.x, target.y, dt, 24);
    if (variant === 'flow') {
      ribbons.forEach((ribbon, layer) => ribbon.forEach(p => {
        const distance = p.x - pointer.x;
        const touch = target.active ? Math.exp(-distance * distance * 9) * (pointer.y - 0.5) * 0.2 : 0;
        spring(p, p.x, flowY(p.x, layer, elapsed) + touch, dt, 24 + layer * 2);
      }));
    } else if (variant === 'grid') {
      mesh.forEach((row, r) => row.forEach((p, c) => {
        const x = gridX(c, r), y = gridY(r);
        const dx = x - pointer.x, dy = y - pointer.y;
        const force = target.active ? Math.exp(-(dx * dx + dy * dy) * 14) * 0.22 : 0;
        spring(p, x + dx * force, y + dy * force + Math.sin(c * 0.42 + r * 0.52 - elapsed * 0.35) * 0.009, dt, 40);
      }));
    } else {
      orbitNodes.forEach((p, index) => {
        const [x, y] = orbitPosition(index, elapsed);
        spring(p, x, y, dt, 30);
      });
    }
  }

  function drawFlow() {
    if (!ctx) return;
    ribbons.forEach((ribbon, layer) => {
      const gradient = ctx.createLinearGradient(0, height * 0.8, width, height * 0.2);
      const alpha = dark.matches ? 0.16 + layer * 0.016 : 0.09 + layer * 0.014;
      gradient.addColorStop(0, `rgba(0, 78, 235, ${alpha})`);
      gradient.addColorStop(0.5, `rgba(30, 139, 255, ${alpha * 0.85})`);
      gradient.addColorStop(1, `rgba(30, 200, 222, ${alpha * 0.5})`);
      ctx.beginPath();
      curve(ctx, ribbon, width, height);
      curve(ctx, reversedRibbons[layer], width, height, 0.065, false);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.beginPath();
      curve(ctx, ribbon, width, height);
      ctx.strokeStyle = dark.matches ? 'rgba(114, 207, 255, 0.22)' : 'rgba(70, 153, 242, 0.18)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });
  }

  function drawOrbit() {
    if (!ctx) return;
    const shiftX = (pointer.x - 0.5) * width * 0.055;
    const shiftY = (pointer.y - 0.5) * height * 0.055;
    ctx.save();
    ctx.translate(shiftX, shiftY);
    for (const path of orbitPaths) {
      ctx.beginPath();
      curve(ctx, path, width, height);
      ctx.closePath();
      ctx.strokeStyle = dark.matches ? 'rgba(117, 183, 255, 0.24)' : 'rgba(35, 112, 220, 0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    orbitNodes.forEach((p, index) => {
      const radius = index % 3 === 0 ? 5 : 3.5;
      const x = p.x * width, y = p.y * height;
      ctx.beginPath(); ctx.arc(x, y, radius * 3, 0, TAU);
      ctx.fillStyle = dark.matches ? 'rgba(76, 170, 255, 0.09)' : 'rgba(25, 135, 235, 0.055)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU);
      ctx.fillStyle = index % 2 ? (dark.matches ? '#70d6e9' : '#40a9c6') : (dark.matches ? '#70a8ff' : '#548de0'); ctx.fill();
    });
    ctx.restore();
  }

  function drawGrid() {
    if (!ctx) return;
    ctx.lineWidth = 1;
    ctx.strokeStyle = dark.matches ? 'rgba(111, 177, 255, 0.2)' : 'rgba(76, 131, 207, 0.16)';
    mesh.forEach(row => { ctx.beginPath(); curve(ctx, row, width, height); ctx.stroke(); });
    for (let col = 0; col < mesh[0].length; col++) {
      ctx.beginPath(); curve(ctx, mesh.map(row => row[col]), width, height); ctx.stroke();
    }
    [[1, 2], [3, 7], [5, 4]].forEach(([row, col], index) => {
      const corners = [mesh[row][col], mesh[row][col + 2], mesh[row + 1][col + 2], mesh[row + 1][col]];
      ctx.beginPath();
      corners.forEach((p, i) => i ? ctx.lineTo(p.x * width, p.y * height) : ctx.moveTo(p.x * width, p.y * height));
      ctx.closePath();
      ctx.fillStyle = index === 1 ? (dark.matches ? 'rgba(62, 191, 207, 0.2)' : 'rgba(62, 191, 207, 0.13)') : (dark.matches ? 'rgba(65, 137, 255, 0.24)' : 'rgba(65, 137, 255, 0.13)');
      ctx.fill();
      ctx.strokeStyle = dark.matches ? 'rgba(112, 179, 255, 0.35)' : 'rgba(65, 137, 255, 0.25)'; ctx.stroke();
    });
  }

  function draw() {
    if (!ctx || !width || !height || disposed) return;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (variant === 'flow') drawFlow(); else if (variant === 'orbit') drawOrbit(); else drawGrid();
  }
  function shouldAnimate() { return visible && !document.hidden && !isPaused() && !reduced.matches && width > 0 && height > 0; }
  function tick(timestamp: number) {
    frame = 0;
    if (!shouldAnimate() || disposed) return;
    if (!lastFrame || timestamp - lastFrame >= 1000 / 30) {
      step(lastFrame ? Math.min((timestamp - lastFrame) / 1000, 0.05) : 1 / 30);
      lastFrame = timestamp;
      draw();
    }
    frame = window.requestAnimationFrame(tick);
  }
  function refresh() {
    if (disposed) return;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0; lastFrame = 0;
    draw();
    if (shouldAnimate()) frame = window.requestAnimationFrame(tick);
  }
  function resize() {
    width = canvas.clientWidth; height = canvas.clientHeight;
    if (!width || !height) { refresh(); return; }
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1_600_000 / (width * height)));
    canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
    refresh();
  }
  function onPointer(event: PointerEvent) {
    if (!fine.matches || event.pointerType === 'touch' || reduced.matches || isPaused()) return;
    const rect = parent!.getBoundingClientRect();
    target.x = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    target.y = clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
    target.active = true;
  }
  function resetPointer() { target.x = 0.5; target.y = 0.5; target.active = false; }
  const resizeObserver = new ResizeObserver(resize);
  const intersectionObserver = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); refresh(); });
  resizeObserver.observe(canvas); intersectionObserver.observe(canvas);
  parent.addEventListener('pointermove', onPointer, { passive: true });
  parent.addEventListener('pointerleave', resetPointer, { passive: true });
  document.addEventListener('visibilitychange', refresh);
  reduced.addEventListener('change', refresh); dark.addEventListener('change', refresh); fine.addEventListener('change', resetPointer);
  resize();
  return { refresh, dispose() {
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    resizeObserver.disconnect(); intersectionObserver.disconnect();
    parent.removeEventListener('pointermove', onPointer); parent.removeEventListener('pointerleave', resetPointer);
    document.removeEventListener('visibilitychange', refresh);
    reduced.removeEventListener('change', refresh); dark.removeEventListener('change', refresh); fine.removeEventListener('change', resetPointer);
  } };
}

/** Decorative only. Place in a positioned, clipped preview container behind its content. */
export function PhysicsBackdrop({ variant = 'flow', paused = false, className = '' }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<Controller | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; controller.current?.refresh(); }, [paused]);
  useEffect(() => {
    if (!canvas.current) return;
    const engine = makeBackdrop(canvas.current, variant, () => pausedRef.current);
    controller.current = engine;
    return () => { engine.dispose(); controller.current = null; };
  }, [variant]);
  return <canvas ref={canvas} className={`physics-backdrop ${className}`.trim()} aria-hidden="true"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', display: 'block' }} />;
}

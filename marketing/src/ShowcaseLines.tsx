import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import './ShowcaseLines.css';

/** Flowing strands inspired by the owner's reference; no circular geometry. */
export function ShowcaseLines({ paused = false, dark = false }: { paused?: boolean; dark?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const theme = window.matchMedia('(prefers-color-scheme: dark)');
    let width = 0, height = 0, frame = 0, previous = 0;
    let visible = false;
    const still = paused || !!reduced;
    const point = (x: number, strand: number, time: number) => {
      const spread = strand - 0.5;
      const wave = Math.sin(x * Math.PI * 2 - time * 0.35);
      const fold = Math.cos(x * Math.PI * 2.5 + time * 0.22);
      return height * (0.5 + wave * 0.15 + spread * (0.35 + fold * 0.27)
        + Math.sin(x * Math.PI * 3 + strand * 2 + time * 0.18) * 0.035);
    };
    const draw = () => {
      if (!width || !height) return;
      const night = dark || theme.matches;
      ctx.clearRect(0, 0, width, height);
      const count = width < 500 ? 28 : 38;
      const path = new Path2D();
      for (let line = 0; line < count; line++) {
        const strand = line / (count - 1);
        for (let step = 0; step <= 64; step++) {
          const x = step / 64;
          const y = point(x, strand, phase.current);
          if (step === 0) path.moveTo(x * width, y);
          else path.lineTo(x * width, y);
        }
      }
      const colors = ctx.createLinearGradient(0, 0, width, height * 0.35);
      colors.addColorStop(0, night ? '#4f7cff' : '#315deb');
      colors.addColorStop(0.45, night ? '#8bc4ff' : '#438af4');
      colors.addColorStop(1, night ? '#7364ed' : '#6558db');
      ctx.strokeStyle = colors;
      ctx.lineWidth = night ? 1 : 0.9;
      ctx.globalAlpha = night ? 0.85 : 0.65;
      ctx.shadowColor = night ? '#4f8cff' : '#427cff';
      ctx.shadowBlur = night ? 12 : 5;
      ctx.stroke(path);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = night ? 0.65 : 0.7;
      ctx.lineWidth = 0.55;
      ctx.stroke(path);
      // Small highlights travel along the same strands rather than flashing.
      for (let i = 0; i < 5; i++) {
        const x = (0.12 + i * 0.193 + phase.current * 0.018) % 1;
        const y = point(x, (i + 0.5) / 5, phase.current);
        ctx.globalAlpha = Math.sin(x * Math.PI) * (night ? 0.95 : 0.65);
        ctx.fillStyle = night ? '#b7dcff' : '#2668e8';
        ctx.shadowColor = '#528fff';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(x * width, y, night ? 1.7 : 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    };
    const tick = (now: number) => {
      if (!visible || document.hidden || still) { frame = 0; return; }
      if (!previous) previous = now;
      if (now - previous >= 32) {
        phase.current += Math.min((now - previous) / 1000, 0.1);
        previous = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (visible && !document.hidden) {
        draw();
        if (!still) frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      const dpr = Math.min(window.devicePixelRatio || 1, width < 500 ? 1.25 : 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sync();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(canvas);
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    theme.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      sizeObserver.disconnect();
      theme.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [paused, dark, reduced]);

  return <div className="showcase-lines" aria-hidden="true"><canvas ref={canvasRef} /></div>;
}

import { useEffect, useRef } from "react";
import "./Threads.css";

// Instanced ribbon strips, adapted from the supplied React Bits Threads shaders.
const vertex = `#version 300 es
precision highp float;
in vec2 aPoint;
uniform vec2 uResolution;
uniform float uTime;
out float vEdge;
out float vAlpha;
out float vIndex;
float noise(vec2 P) {
  vec2 Pi = floor(P);
  vec4 Pf = P.xyxy - vec4(Pi, Pi + 1.0);
  vec4 Pt = vec4(Pi.xy, Pi.xy + 1.0);
  Pt -= floor(Pt / 71.0) * 71.0;
  Pt += vec2(26.0, 161.0).xyxy;
  Pt *= Pt;
  Pt = Pt.xzxz * Pt.yyww;
  vec4 gx = fract(Pt / 951.135664) - 0.49999;
  vec4 gy = fract(Pt / 642.949883) - 0.49999;
  vec4 results = inversesqrt(gx * gx + gy * gy) * (gx * Pf.xzxz + gy * Pf.yyww) * 1.41421356237;
  vec2 b = Pf.xy * Pf.xy * Pf.xy * (Pf.xy * (Pf.xy * 6.0 - 15.0) + 10.0);
  vec4 blend = vec4(b, vec2(1.0 - b));
  return dot(results, blend.zxzx * blend.wwyy);
}
void main() {
  float perc = float(gl_InstanceID) / 110.0;
  float x = aPoint.x;
  float split = 0.04 + perc * 0.5;
  float amp = smoothstep(split, max(0.7, split + 0.2), x) * 0.65;
  float t = uTime / 10.0;
  float n = mix(noise(vec2(t * 2.5, (x * 1.05 + perc) * 2.5)), noise(vec2(t * 3.5, (x * 1.05 + t) * 3.5)) / 1.5, x * 0.3);
  // Spread across the projected viewport, including the corners in landscape.
  float y = 0.5 + (perc - 0.5) * 1.2 + n * 0.5 * amp;
  float c = 0.9063078, s = 0.4226183;
  vec2 frame = vec2(uResolution.x*c + uResolution.y*s, uResolution.x*s + uResolution.y*c) * 1.1;
  vec2 local = (vec2(x,y) - 0.5) * frame;
  local.y += aPoint.y * 1.5;
  vec2 turned = vec2(local.x*c - local.y*s, local.x*s + local.y*c);
  gl_Position = vec4(turned / (uResolution * 0.5), 0.0, 1.0);
  vEdge = aPoint.y;
  vAlpha = (1.0 - smoothstep(0.0, 1.0, pow(perc, 0.3)) * 0.55) * 0.30;
  vIndex = perc;
}`;
const fragment = `#version 300 es
precision highp float;
in float vEdge;
in float vAlpha;
in float vIndex;
out vec4 outColor;
void main() {
  float alpha = (1.0 - smoothstep(0.0, 1.0, abs(vEdge))) * vAlpha;
  vec3 color = mix(vec3(0.30,0.57,0.93), vec3(0.55,0.49,0.85), vIndex);
  outColor = vec4(color * alpha, alpha);
}`;

export default function Threads() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) return; // The CSS background remains available without WebGL.
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    if (!program) return;
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type);
      if (!shader) continue;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      shaders.forEach(shader => gl.deleteShader(shader));
      gl.deleteProgram(program);
      return;
    }
    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const segments = 320;
    const points = new Float32Array((segments + 1) * 4);
    for (let i = 0; i <= segments; i++) points.set([i / segments, -1, i / segments, 1], i * 4);
    gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPoint");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "uResolution");
    const time = gl.getUniformLocation(program, "uTime");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0, previous = 0, elapsed = 0, visible = true, lost = false;
    const draw = () => {
      if (lost) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, elapsed);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (segments + 1) * 2, 110);
    };
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden || lost) { previous = 0; return; }
      if (previous) elapsed += Math.min((now - previous) / 1000, 0.05) * 0.6;
      previous = now;
      draw();
      if (!motion.matches) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      cancelAnimationFrame(raf);
      previous = 0;
      raf = 0;
      if (visible && !document.hidden && !lost) raf = requestAnimationFrame(frame);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2, 1920 / Math.max(rect.width, rect.height, 1));
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      draw();
      wake();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    // Safari rotation and browser chrome changes can precede ResizeObserver.
    window.addEventListener("resize", resize, { passive: true });
    window.visualViewport?.addEventListener("resize", resize, { passive: true });
    window.screen.orientation?.addEventListener("change", resize);
    const intersection = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); wake(); });
    intersection.observe(canvas);
    const onLost = () => { lost = true; cancelAnimationFrame(raf); };
    canvas.addEventListener("webglcontextlost", onLost);
    document.addEventListener("visibilitychange", wake);
    motion.addEventListener("change", wake);
    resize();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.screen.orientation?.removeEventListener("change", resize);
      intersection.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      document.removeEventListener("visibilitychange", wake);
      motion.removeEventListener("change", wake);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      shaders.forEach(shader => gl.deleteShader(shader));
      gl.deleteProgram(program);
    };
  }, []);
  return <canvas ref={canvasRef} className="threads-canvas" aria-hidden="true" />;
}

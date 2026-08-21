"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * Filing Observatory hero backdrop.
 *
 * A light-mode ambient canvas: ticker nodes drift across the hero, nearby
 * nodes link into an evidence graph, pulses travel the links, and pointer
 * movement sends ripples that nudge the constellation.
 *
 * Everything is aria-hidden decoration; reduced-motion renders a single
 * static frame and the loop never starts.
 */

const TICKER_POOL = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA",
  "JPM", "V", "XOM", "UNH", "LLY", "COST", "HD", "MRK",
  "ABBV", "CVX", "PEP", "CRM", "AMD", "NFLX", "INTC", "QCOM",
  "KO", "DIS", "PFE", "T", "BA", "GS",
] as const;

const LINK_DISTANCE = 190;
const MAX_RIPPLES = 6;

interface StarNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  label: string;
  radius: number;
  flash: number;
  phase: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  strength: number;
}

interface Pulse {
  from: number;
  to: number;
  progress: number;
  speed: number;
}

interface ConstellationScene {
  nodes: StarNode[];
  ripples: Ripple[];
  pulses: Pulse[];
  nextPulseAt: number;
  nextRippleAt: number;
  width: number;
  height: number;
}

function buildScene(width: number, height: number): ConstellationScene {
  const density = width < 720 ? 42000 : 34000;
  const count = Math.max(12, Math.min(30, Math.round((width * height) / density)));
  const nodes: StarNode[] = Array.from({ length: count }, (_, index) => ({
    x: 24 + Math.random() * Math.max(1, width - 48),
    y: 24 + Math.random() * Math.max(1, height - 48),
    vx: (Math.random() - 0.5) * 0.14,
    vy: (Math.random() - 0.5) * 0.14,
    label: TICKER_POOL[index % TICKER_POOL.length],
    radius: index % 5 === 2 ? 2.4 : 1.7,
    flash: 0,
    phase: Math.random() * Math.PI * 2,
  }));
  return {
    nodes,
    ripples: [],
    pulses: [],
    nextPulseAt: 900,
    nextRippleAt: 2400,
    width,
    height,
  };
}

function stepScene(
  scene: ConstellationScene,
  dt: number,
  elapsed: number,
): void {
  const { nodes, ripples } = scene;

  for (const node of nodes) {
    node.x += node.vx * dt;
    node.y += node.vy * dt;
    node.phase += 0.0016 * dt;

    if (node.x < 12 || node.x > scene.width - 12) node.vx *= -1;
    if (node.y < 12 || node.y > scene.height - 12) node.vy *= -1;
    if (node.flash > 0) node.flash = Math.max(0, node.flash - 0.02 * dt);

    for (const ripple of ripples) {
      const dx = node.x - ripple.x;
      const dy = node.y - ripple.y;
      const distance = Math.hypot(dx, dy);
      const band = Math.abs(distance - ripple.radius);
      if (band < 36) {
        const push = ((1 - band / 36) * ripple.strength * 0.35 * dt) / 8;
        if (distance > 1) {
          node.x += (dx / distance) * push;
          node.y += (dy / distance) * push;
        }
      }
    }
  }

  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    const ripple = ripples[i];
    ripple.radius += 2.4 * dt;
    ripple.strength *= Math.pow(0.972, dt);
    if (ripple.strength < 0.08 || ripple.radius > Math.max(scene.width, scene.height)) {
      ripples.splice(i, 1);
    }
  }

  if (elapsed > scene.nextPulseAt) {
    const candidates = scene.nodes
      .map((from, fromIndex) => ({
        fromIndex,
        toIndex: scene.nodes.findIndex(
          (to, toIndex) =>
            toIndex !== fromIndex &&
            Math.hypot(to.x - from.x, to.y - from.y) < LINK_DISTANCE,
        ),
      }))
      .filter((pair) => pair.toIndex !== -1);
    const pair = candidates[Math.floor(Math.random() * candidates.length)];
    if (pair) {
      scene.pulses.push({
        from: pair.fromIndex,
        to: pair.toIndex,
        progress: 0,
        speed: 0.006 + Math.random() * 0.004,
      });
    }
    scene.nextPulseAt = elapsed + 1400 + Math.random() * 1800;
  }

  if (elapsed > scene.nextRippleAt) {
    scene.ripples.push({
      x: Math.random() * scene.width,
      y: Math.random() * scene.height,
      radius: 0,
      strength: 1,
    });
    scene.nextRippleAt = elapsed + 4200 + Math.random() * 3200;
  }

  for (let i = scene.pulses.length - 1; i >= 0; i -= 1) {
    const pulse = scene.pulses[i];
    pulse.progress += pulse.speed * dt;
    if (pulse.progress >= 1) {
      const target = scene.nodes[pulse.to];
      if (target) target.flash = 1;
      scene.pulses.splice(i, 1);
    }
  }
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: ConstellationScene,
): void {
  const { nodes, pulses, ripples } = scene;
  ctx.clearRect(0, 0, scene.width, scene.height);

  ctx.lineWidth = 1;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > LINK_DISTANCE) continue;
      const alpha = (1 - distance / LINK_DISTANCE) * 0.13;
      ctx.strokeStyle = `rgba(0, 82, 255, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  for (const ripple of ripples) {
    ctx.strokeStyle = `rgba(0, 82, 255, ${(ripple.strength * 0.16).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const pulse of pulses) {
    const from = nodes[pulse.from];
    const to = nodes[pulse.to];
    if (!from || !to) continue;
    const x = from.x + (to.x - from.x) * pulse.progress;
    const y = from.y + (to.y - from.y) * pulse.progress;
    ctx.fillStyle = "rgba(0, 62, 199, 0.85)";
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font =
    '600 10px var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace)';
  for (const node of nodes) {
    const breathe = 0.5 + Math.sin(node.phase) * 0.5;
    const flashRing = node.flash;

    if (flashRing > 0) {
      ctx.strokeStyle = `rgba(0, 82, 255, ${(flashRing * 0.5).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 6 + (1 - flashRing) * 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(0, 82, 255, ${0.4 + breathe * 0.3})`;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fill();

    const textAlpha = 0.32 + breathe * 0.22 + flashRing * 0.4;
    ctx.fillStyle = `rgba(90, 101, 125, ${Math.min(0.95, textAlpha).toFixed(3)})`;
    ctx.fillText(node.label, node.x + 6, node.y + 3);
  }
}

export function HeroBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const host = canvas.parentElement;
    let scene: ConstellationScene | null = null;
    let frame = 0;
    let running = true;
    let inView = true;
    let lastTime = 0;
    let startedAt = 0;

    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const width = host?.clientWidth ?? window.innerWidth;
      const height = host?.clientHeight ?? window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene = buildScene(width, height);
      if (reducedMotion) drawScene(ctx, scene);
    };

    const render = (time: number) => {
      if (!running || !inView || !scene) return;
      if (!startedAt) startedAt = time;
      const dt = lastTime ? Math.min(3, (time - lastTime) / 16.67) : 1;
      lastTime = time;
      stepScene(scene, dt, time - startedAt);
      drawScene(ctx, scene);
      frame = requestAnimationFrame(render);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion || !scene || scene.ripples.length >= MAX_RIPPLES) return;
      const rect = canvas.getBoundingClientRect();
      scene.ripples.push({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        radius: 0,
        strength: 0.75,
      });
    };

    resize();

    if (reducedMotion) {
      window.addEventListener("resize", resize);
      return () => {
        window.removeEventListener("resize", resize);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        inView = entries[0]?.isIntersecting ?? true;
        if (inView && running && !frame) {
          lastTime = 0;
          frame = requestAnimationFrame(render);
        }
      },
      { threshold: 0 },
    );
    if (host) observer.observe(host);

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (running && inView && !frame) {
        lastTime = 0;
        frame = requestAnimationFrame(render);
      }
    };

    window.addEventListener("resize", resize);
    canvas.addEventListener("pointermove", onPointerMove);
    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(render);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reducedMotion]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* aurora — brand-blue duotone, slow drift */}
      <div className="home-aurora home-aurora-a absolute -top-[18%] left-[-12%] h-[540px] w-[540px] rounded-full bg-[radial-gradient(circle_at_center,rgba(0,82,255,0.16),transparent_65%)] blur-3xl" />
      <div className="home-aurora home-aurora-b absolute right-[-14%] top-[6%] h-[620px] w-[620px] rounded-full bg-[radial-gradient(circle_at_center,rgba(110,86,207,0.13),transparent_65%)] blur-3xl" />
      <div className="home-aurora home-aurora-c absolute bottom-[-26%] left-[22%] h-[560px] w-[720px] rounded-full bg-[radial-gradient(circle_at_center,rgba(0,62,199,0.10),transparent_62%)] blur-3xl" />

      {/* survey grid — fades out toward the fold */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,11,13,0.045)_1px,transparent_1px),linear-gradient(180deg,rgba(10,11,13,0.045)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]" />

      {/* filing constellation — pointer interactive */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full opacity-90 [mask-image:radial-gradient(120%_90%_at_50%_38%,black_55%,transparent_100%)]"
      />
    </div>
  );
}

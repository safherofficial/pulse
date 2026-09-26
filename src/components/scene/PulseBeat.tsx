import { useEffect, useRef } from "react";

/**
 * Continuous ECG-style pulse line for the home hero.
 * Canvas-based, GPU-light, infinite loop.
 */
export function PulseBeat() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth ?? 640;
      const h = parent?.clientHeight ?? 420;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();

    /** Heartbeat waveform: flat → Q → R spike → S → recovery */
    function beatY(phase: number): number {
      // phase 0..1 within one beat cycle
      const p = ((phase % 1) + 1) % 1;
      if (p < 0.12) return 0;
      if (p < 0.18) return -0.15 * ((p - 0.12) / 0.06);
      if (p < 0.22) return -0.15 + 1.15 * ((p - 0.18) / 0.04); // R up
      if (p < 0.28) return 1 - 1.45 * ((p - 0.22) / 0.06); // R down through S
      if (p < 0.36) return -0.45 + 0.45 * ((p - 0.28) / 0.08);
      if (p < 0.5) return 0.12 * Math.sin(((p - 0.36) / 0.14) * Math.PI);
      return 0;
    }

    function frame(now: number) {
      if (!running || !ctx || !canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = (now - start) / 1000;

      ctx.clearRect(0, 0, w, h);

      // Soft radial glow
      const glow = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.55);
      glow.addColorStop(0, "rgba(61, 224, 245, 0.08)");
      glow.addColorStop(0.45, "rgba(255, 77, 154, 0.04)");
      glow.addColorStop(1, "rgba(5, 7, 11, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = "rgba(29, 44, 58, 0.55)";
      ctx.lineWidth = 1;
      const step = 36;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const midY = h * 0.52;
      const amp = h * 0.22;
      const cyclesVisible = 3.2;
      const speed = reduce ? 0.15 : 0.55; // beats travel left→right scroll
      const scroll = t * speed;

      // Trail layers for glow
      const layers = [
        { width: 10, alpha: 0.08, color: "#3de0f5" },
        { width: 5, alpha: 0.2, color: "#3de0f5" },
        { width: 2.2, alpha: 0.95, color: "#e8f6f8" },
      ];

      for (const layer of layers) {
        ctx.beginPath();
        const samples = Math.max(180, Math.floor(w / 2));
        for (let i = 0; i <= samples; i += 1) {
          const x = (i / samples) * w;
          const phase = (i / samples) * cyclesVisible + scroll;
          const y = midY - beatY(phase) * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = layer.color;
        ctx.globalAlpha = layer.alpha;
        ctx.lineWidth = layer.width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = "#3de0f5";
        ctx.shadowBlur = layer.width > 3 ? 18 : 8;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Scanning head (bright node)
      const headPhase = (scroll + cyclesVisible) % 1;
      // place head near right third
      const headX = w * 0.78;
      const headY = midY - beatY(scroll + cyclesVisible * 0.78) * amp;
      const pulse = 0.6 + Math.sin(t * 6) * 0.4;
      const grd = ctx.createRadialGradient(headX, headY, 0, headX, headY, 28 * pulse);
      grd.addColorStop(0, "rgba(198, 245, 78, 0.9)");
      grd.addColorStop(0.35, "rgba(61, 224, 245, 0.45)");
      grd.addColorStop(1, "rgba(61, 224, 245, 0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(headX, headY, 28 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Baseline
      ctx.strokeStyle = "rgba(61, 224, 245, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      aria-hidden
    />
  );
}

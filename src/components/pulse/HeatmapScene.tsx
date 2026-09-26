import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { usePulseStore } from "@/lib/xpulse/store";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_TICKS = [0, 6, 12, 18];
const COLS = 7;
const ROWS = 24;
const COL_GAP = 1.15;
const ROW_GAP = 0.42;
const MAX_HEIGHT = 4.2;

const BG = "#07090d";
const LOW = new THREE.Color("#1a212b");
const MID = new THREE.Color("#3d6b66");
const HIGH = new THREE.Color("#9fd4cb");
const PEAK = new THREE.Color("#e7edf4");

type HoverInfo = { col: number; row: number; intensity: number } | null;

function cellColor(intensity: number, hovered: boolean, isPeak: boolean) {
  const color = LOW.clone();
  if (intensity < 0.55) color.lerp(MID, intensity / 0.55);
  else color.copy(MID).lerp(HIGH, (intensity - 0.55) / 0.45);
  if (isPeak) color.lerp(PEAK, 0.35);
  if (hovered) color.lerp(PEAK, 0.5);
  return color;
}

function TerrainMesh({
  heatmap,
  reducedMotion,
}: {
  heatmap: number[][];
  reducedMotion: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const setHover = usePulseStore((s) => s.setHover);
  const hover = usePulseStore((s) => s.hover);
  const hoverId = hover ? hover.day * 24 + hover.hour : -1;
  const scales = useRef(new Float32Array(168).fill(0.04));

  const { peakCol, peakRow, peakValue } = useMemo(() => {
    let bestCol = 0;
    let bestRow = 0;
    let bestValue = 0;
    heatmap.forEach((line, col) => {
      line.forEach((value, row) => {
        if (value > bestValue) {
          bestValue = value;
          bestCol = col;
          bestRow = row;
        }
      });
    });
    return { peakCol: bestCol, peakRow: bestRow, peakValue: bestValue };
  }, [heatmap]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();
    let index = 0;
    for (let col = 0; col < COLS; col += 1) {
      for (let row = 0; row < ROWS; row += 1) {
        const intensity = heatmap[col]?.[row] ?? 0;
        const isPeak = peakValue > 0 && col === peakCol && row === peakRow;
        const hovered = index === hoverId;
        const wave = reducedMotion ? 0 : Math.sin(t * 1.4 + intensity * 6 + col) * 0.03 * intensity;
        const target = Math.max(0.05, intensity * MAX_HEIGHT + wave + (isPeak && !reducedMotion ? Math.sin(t * 2.2) * 0.12 : 0));
        scales.current[index] += (target - scales.current[index]) * 0.12;
        const h = scales.current[index];
        const x = (col - (COLS - 1) / 2) * COL_GAP;
        const z = (row - (ROWS - 1) / 2) * ROW_GAP;
        dummy.position.set(x, h / 2, z);
        const fat = hovered ? 1.35 : 1;
        dummy.scale.set(fat, h, fat);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        color.copy(cellColor(intensity, hovered, isPeak));
        mesh.setColorAt(index, color);
        index += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, 168]}
      count={168}
      onPointerMove={(event) => {
        event.stopPropagation();
        const id = event.instanceId;
        if (id == null) return;
        const col = Math.floor(id / ROWS);
        const row = id % ROWS;
        setHover({ day: col, hour: row, value: heatmap[col]?.[row] ?? 0 });
      }}
      onPointerOut={() => setHover(null)}
    >
      <boxGeometry args={[0.72, 1, 0.28]} />
      <meshStandardMaterial
        roughness={0.28}
        metalness={0.18}
        emissive="#9fd4cb"
        emissiveIntensity={0.22}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function EmberField({ heatmap }: { heatmap: number[][] }) {
  const count = 80;
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      arr[i * 3] = (Math.random() - 0.5) * 14;
      arr[i * 3 + 1] = Math.random() * 6 + 0.4;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 14;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    const pts = ref.current;
    if (!pts) return;
    pts.rotation.y += delta * 0.02;
    const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i += 1) {
      pos.array[i * 3 + 1] += delta * 0.12;
      if (pos.array[i * 3 + 1] > 7) pos.array[i * 3 + 1] = 0.2;
    }
    pos.needsUpdate = true;
  });

  const peak = heatmap.flat().reduce((a, b) => a + b, 0);
  if (peak <= 0) return null;

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#9fd4cb" size={0.035} transparent opacity={0.45} depthWrite={false} />
    </points>
  );
}

function Scene({ heatmap, reducedMotion }: { heatmap: number[][]; reducedMotion: boolean }) {
  const [autoRotate, setAutoRotate] = useState(!reducedMotion);

  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 10, 26]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 10, 4]} intensity={1.35} color="#e7edf4" />
      <pointLight position={[0, 6, 0]} intensity={1.4} color="#9fd4cb" distance={18} />
      <pointLight position={[-6, 3, -4]} intensity={0.4} color="#5b7c9a" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[18, 64]} />
        <meshStandardMaterial color="#0b0e13" roughness={1} metalness={0} />
      </mesh>

      <gridHelper args={[16, 24, "#2a3340", "#161b22"]} position={[0, 0, 0]} />

      <TerrainMesh heatmap={heatmap} reducedMotion={reducedMotion} />
      {!reducedMotion ? <EmberField heatmap={heatmap} /> : null}

      {DAY_LABELS.map((day, col) => {
        const x = (col - (COLS - 1) / 2) * COL_GAP;
        const z = ((ROWS - 1) / 2) * ROW_GAP + 1.15;
        return (
          <Html key={day} position={[x, 0.08, z]} center style={{ pointerEvents: "none" }}>
            <span className="font-mono text-[10px] tracking-widest text-subtle">{day}</span>
          </Html>
        );
      })}

      {HOUR_TICKS.map((hour) => {
        const z = (hour - (ROWS - 1) / 2) * ROW_GAP;
        const x = -((COLS - 1) / 2) * COL_GAP - 1.15;
        return (
          <Html key={hour} position={[x, 0.08, z]} center style={{ pointerEvents: "none" }}>
            <span className="font-mono text-[10px] text-subtle">{String(hour).padStart(2, "0")}h</span>
          </Html>
        );
      })}

      <OrbitControls
        autoRotate={autoRotate}
        autoRotateSpeed={0.28}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={6}
        maxDistance={16}
        minPolarAngle={0.55}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 1.1, 0]}
        onStart={() => setAutoRotate(false)}
      />
    </>
  );
}

export function HeatmapScene({
  heatmap,
  label,
}: {
  heatmap: number[][];
  label?: string;
}) {
  const hover = usePulseStore((s) => s.hover);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
  }, []);

  const hasData = useMemo(() => heatmap.some((line) => line.some((value) => value > 0)), [heatmap]);

  if (!hasData) {
    return (
      <div className="grid h-full min-h-[320px] place-items-center bg-bg">
        <p className="max-w-sm px-6 text-center text-sm text-muted">
          No activity yet. Paste a link from X to start mapping your week.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden bg-bg">
      <Canvas
        camera={{ position: [9.5, 7.2, 9.2], fov: 38, near: 0.1, far: 50 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <Scene heatmap={heatmap} reducedMotion={reducedMotion} />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-bg/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-bg to-transparent" />

      <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
        <p className="font-mono text-xs text-subtle">{label ?? "When attention lands."}</p>
        <p className="font-mono text-xs text-fg">
          {hover
            ? `${DAY_LABELS[hover.day]} · ${String(hover.hour).padStart(2, "0")}:00 · ${Math.round(hover.value * 100)}%`
            : "Drag to explore"}
        </p>
      </div>
    </div>
  );
}

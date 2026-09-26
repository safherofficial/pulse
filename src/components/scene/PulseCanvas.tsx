import { useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, OrbitControls, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { formatCompact, formatPct } from "@/lib/xpulse/format";
import { engagementRate, publicMetricsEngagement, writingSignals } from "@/lib/xpulse/metrics";
import type { PublicCompareResult, PublicXMetrics, PulseModel, PulsePost, WritingSignals } from "@/lib/xpulse/types";

const SIGNALS: (keyof WritingSignals)[] = [
  "hook",
  "clarity",
  "curiosity",
  "specificity",
  "emotion",
  "shareability",
  "readability",
  "structure",
];

const SIGNAL_LABELS: Record<keyof WritingSignals, string> = {
  hook: "HOOK",
  clarity: "CLEAR",
  curiosity: "CURIOUS",
  specificity: "SPECIFIC",
  emotion: "EMOTION",
  shareability: "SHARE",
  readability: "READ",
  structure: "FORM",
};

const REFERENCE = "#d7e4ee";
const TARGET = "#3de0f5";
const GAP = "#ff6b7d";
const QUIET = "#6d8092";
const VOID = "#05070b";
const FLARE = "#ff4d9a";
const SIGNAL = "#c6f54e";

type ColumnSpec = {
  key: string;
  label: string;
  height: number;
  display: string;
  color: string;
  ghost?: number;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function pairHeight(value: number, max: number) {
  if (max <= 0) return 0.04;
  return clamp01(Math.log1p(Math.max(0, value)) / Math.log1p(max));
}

function rateHeight(rate: number | null) {
  if (rate == null) return 0.04;
  return clamp01(rate / 0.08);
}

function rowX(index: number, count: number, gap: number) {
  return (index - (count - 1) / 2) * gap;
}

function selectedColumns(post: PulsePost): { signals: ColumnSpec[]; metrics: ColumnSpec[] } {
  const signals = writingSignals(post.text);
  const metrics = post.metrics;
  const counts = [
    { key: "views", label: "VIEWS", value: metrics.impressions, display: formatCompact(metrics.impressions) },
    { key: "likes", label: "LIKES", value: metrics.likes, display: formatCompact(metrics.likes) },
    { key: "reposts", label: "REPOSTS", value: metrics.reposts, display: formatCompact(metrics.reposts) },
    { key: "replies", label: "REPLIES", value: metrics.replies, display: formatCompact(metrics.replies) },
    { key: "bookmarks", label: "SAVES", value: metrics.bookmarks, display: formatCompact(metrics.bookmarks) },
  ];
  if (metrics.detailExpands != null) {
    counts.push({
      key: "opens",
      label: "OPENS",
      value: metrics.detailExpands,
      display: formatCompact(metrics.detailExpands),
    });
  }
  if (metrics.profileClicks > 0) {
    counts.push({
      key: "profile",
      label: "PROFILE",
      value: metrics.profileClicks,
      display: formatCompact(metrics.profileClicks),
    });
  }
  const max = Math.max(...counts.map((item) => item.value), 1);
  const engagement = engagementRate(metrics);
  return {
    signals: SIGNALS.map((key) => {
      const score = signals[key];
      return {
        key,
        label: SIGNAL_LABELS[key],
        height: clamp01(score / 100),
        display: String(score),
        color: score < 45 ? QUIET : score >= 70 ? SIGNAL : TARGET,
      };
    }),
    metrics: [
      {
        key: "engagement",
        label: "ENGAGE",
        height: rateHeight(engagement),
        display: formatPct(engagement),
        color: TARGET,
      },
      ...counts.map((item) => ({
        key: item.key,
        label: item.label,
        height: pairHeight(item.value, max),
        display: item.display,
        color: TARGET,
      })),
    ],
  };
}

function countValue(metrics: PublicXMetrics, field: "views" | "likes" | "reposts" | "replies" | "bookmarks") {
  return metrics[field];
}

function compareColumns(result: PublicCompareResult) {
  const deficitKeys = new Set(result.deficits.map((item) => item.key));
  const gapBySignal = new Map(result.gaps.map((gap) => [gap.signal, gap.gap]));
  const signals = SIGNALS.map((key) => {
    const viralScore = result.viral.signals[key];
    const targetScore = result.target.signals[key];
    const behind = (gapBySignal.get(key) ?? 0) >= 5;
    return {
      label: SIGNAL_LABELS[key],
      viral: column(`v-${key}`, SIGNAL_LABELS[key], clamp01(viralScore / 100), String(viralScore), REFERENCE),
      target: column(
        `t-${key}`,
        SIGNAL_LABELS[key],
        clamp01(targetScore / 100),
        String(targetScore),
        behind ? GAP : TARGET,
        viralScore > targetScore ? clamp01(viralScore / 100) : undefined,
      ),
    };
  });

  const pairs: {
    key: string;
    label: string;
    viral: number | null;
    target: number | null;
    kind: "rate" | "count";
  }[] = [
    {
      key: "engagement",
      label: "ENGAGE",
      viral: publicMetricsEngagement(result.viral.metrics),
      target: publicMetricsEngagement(result.target.metrics),
      kind: "rate",
    },
    {
      key: "views",
      label: "VIEWS",
      viral: countValue(result.viral.metrics, "views"),
      target: countValue(result.target.metrics, "views"),
      kind: "count",
    },
    {
      key: "likes",
      label: "LIKES",
      viral: countValue(result.viral.metrics, "likes"),
      target: countValue(result.target.metrics, "likes"),
      kind: "count",
    },
    {
      key: "reposts",
      label: "REPOSTS",
      viral: countValue(result.viral.metrics, "reposts"),
      target: countValue(result.target.metrics, "reposts"),
      kind: "count",
    },
    {
      key: "replies",
      label: "REPLIES",
      viral: countValue(result.viral.metrics, "replies"),
      target: countValue(result.target.metrics, "replies"),
      kind: "count",
    },
    {
      key: "bookmarks",
      label: "SAVES",
      viral: countValue(result.viral.metrics, "bookmarks"),
      target: countValue(result.target.metrics, "bookmarks"),
      kind: "count",
    },
  ];

  const metrics = pairs.map((pair) => {
    const viralValue = pair.viral ?? 0;
    const targetValue = pair.target ?? 0;
    const max = Math.max(viralValue, targetValue, pair.kind === "rate" ? 0.08 : 1);
    const viralHeight = pair.kind === "rate" ? rateHeight(pair.viral) : pairHeight(viralValue, max);
    const targetHeight = pair.kind === "rate" ? rateHeight(pair.target) : pairHeight(targetValue, max);
    const behind = deficitKeys.has(pair.key);
    const display = (value: number | null) => {
      if (value == null) return "n/a";
      return pair.kind === "rate" ? formatPct(value) : formatCompact(value);
    };
    return {
      label: pair.label,
      viral: column(`v-${pair.key}`, pair.label, viralHeight, display(pair.viral), REFERENCE),
      target: column(
        `t-${pair.key}`,
        pair.label,
        targetHeight,
        display(pair.target),
        behind ? GAP : TARGET,
        behind && viralHeight > targetHeight ? viralHeight : undefined,
      ),
    };
  });

  return { signals, metrics };
}

function column(
  key: string,
  label: string,
  height: number,
  display: string,
  color: string,
  ghost?: number,
): ColumnSpec {
  return { key, label, height, display, color, ghost };
}

function Column({
  spec,
  x,
  z,
  lift,
  reduce,
  showValue,
  hero = false,
}: {
  spec: ColumnSpec;
  x: number;
  z: number;
  lift: number;
  reduce: boolean;
  showValue: boolean;
  hero?: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const current = useRef(0.08);
  const ghost = spec.ghost ?? 0;
  const ghostHeight = 0.08 + ghost * lift;
  const radius = hero ? 0.16 : 0.14;

  useFrame(({ clock }, delta) => {
    if (!mesh.current) return;
    const target = 0.08 + spec.height * lift;
    current.current = reduce ? target : THREE.MathUtils.damp(current.current, target, 6, Math.min(delta, 0.05));
    mesh.current.scale.y = current.current;
    mesh.current.position.y = current.current / 2;
    if (core.current) {
      core.current.scale.y = current.current * 0.92;
      core.current.position.y = current.current / 2;
    }
    if (material.current) {
      if (spec.color === GAP && !reduce) {
        material.current.emissiveIntensity = 0.35 + Math.sin(clock.elapsedTime * 3.2) * 0.18;
      } else if (hero && !reduce) {
        material.current.emissiveIntensity =
          (spec.color === SIGNAL ? 0.55 : 0.38) + Math.sin(clock.elapsedTime * 2.1 + x) * 0.12;
      }
    }
  });

  return (
    <group position={[x, 0, z]}>
      {ghost > spec.height + 0.04 ? (
        <mesh position={[0, ghostHeight / 2, 0]} scale={[1, ghostHeight, 1]}>
          <cylinderGeometry args={[radius * 1.05, radius * 1.05, 1, 12]} />
          <meshBasicMaterial color={GAP} wireframe transparent opacity={0.5} />
        </mesh>
      ) : null}

      {/* Soft glow shell */}
      {hero ? (
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[radius * 1.35, radius * 1.35, 1, 16]} />
          <meshBasicMaterial color={spec.color} transparent opacity={0.08} depthWrite={false} />
        </mesh>
      ) : null}

      <mesh ref={mesh} position={[0, 0.04, 0]}>
        <cylinderGeometry args={[radius, radius * 0.92, 1, hero ? 20 : 12]} />
        <meshStandardMaterial
          ref={material}
          color={spec.color}
          roughness={hero ? 0.18 : 0.28}
          metalness={hero ? 0.55 : 0.42}
          emissive={spec.color}
          emissiveIntensity={spec.color === GAP ? 0.4 : hero ? 0.45 : 0.22}
        />
      </mesh>

      {/* Inner bright core */}
      {hero ? (
        <mesh ref={core} position={[0, 0.04, 0]}>
          <cylinderGeometry args={[radius * 0.35, radius * 0.28, 1, 10]} />
          <meshBasicMaterial color="#e8f6f8" transparent opacity={0.35} />
        </mesh>
      ) : null}

      {/* Cap */}
      <mesh position={[0, 0.08 + spec.height * lift, 0]}>
        <sphereGeometry args={[radius * (hero ? 1.05 : 0.95), 12, 12]} />
        <meshStandardMaterial
          color={spec.color}
          emissive={spec.color}
          emissiveIntensity={hero ? 0.7 : 0.35}
          roughness={0.2}
          metalness={0.5}
        />
      </mesh>

      {showValue ? (
        <LabelSprite position={[0, 0.32 + spec.height * lift, 0]} text={spec.display} color="#e8f6f8" scale={0.72} />
      ) : null}
    </group>
  );
}

function Floor({ hero = false }: { hero?: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!hero) return;
    if (ring.current) {
      ring.current.rotation.z = clock.elapsedTime * 0.15;
      const s = 1 + Math.sin(clock.elapsedTime * 0.6) * 0.02;
      ring.current.scale.set(s, s, s);
    }
    if (ring2.current) {
      ring2.current.rotation.z = -clock.elapsedTime * 0.08;
    }
  });

  return (
    <>
      <color attach="background" args={[VOID]} />
      <fog attach="fog" args={[VOID, hero ? 12 : 10, hero ? 28 : 22]} />
      <ambientLight intensity={hero ? 0.28 : 0.4} />
      <directionalLight position={[4, 8, 5]} intensity={hero ? 1.35 : 1.15} color="#d0e8f0" />
      <pointLight position={[-3.6, 3.4, 2]} intensity={hero ? 1.6 : 1.15} color={TARGET} />
      <pointLight position={[3.4, 2.1, 1.2]} intensity={hero ? 0.55 : 0.22} color={FLARE} />
      {hero ? <pointLight position={[0, 5, 0]} intensity={0.5} color={SIGNAL} /> : null}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0.4]} receiveShadow>
        <circleGeometry args={[hero ? 7.2 : 6.4, 96]} />
        <meshStandardMaterial
          color={hero ? "#070c12" : "#0a1016"}
          roughness={0.85}
          metalness={hero ? 0.35 : 0}
        />
      </mesh>

      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0.4]}>
        <ringGeometry args={[2.05, 2.12, 96]} />
        <meshBasicMaterial color={TARGET} transparent opacity={hero ? 0.65 : 0.45} />
      </mesh>

      {hero ? (
        <mesh ref={ring2} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0.4]}>
          <ringGeometry args={[3.4, 3.45, 96]} />
          <meshBasicMaterial color={FLARE} transparent opacity={0.28} />
        </mesh>
      ) : null}

      <gridHelper
        args={[14, hero ? 36 : 24, hero ? "#1e4055" : "#1a3344", "#0d141c"]}
        position={[0, -0.012, 0.4]}
      />
    </>
  );
}

function labelTexture(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = "500 46px 'IBM Plex Mono', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function LabelSprite({
  position,
  text,
  color = "#7f8b9a",
  scale = 0.9,
}: {
  position: [number, number, number];
  text: string;
  color?: string;
  scale?: number;
}) {
  const texture = useMemo(() => labelTexture(text, color), [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[scale * 2.1, scale * 0.52, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

/** Beams that pulse between writing-signal row and performance row. */
function SignalBridges({
  signals,
  metrics,
  reduce,
}: {
  signals: ColumnSpec[];
  metrics: ColumnSpec[];
  reduce: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const count = Math.min(signals.length, metrics.length, 6);

  useFrame(({ clock }) => {
    if (!group.current || reduce) return;
    const t = clock.elapsedTime;
    group.current.children.forEach((child, i) => {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat) mat.opacity = 0.12 + Math.sin(t * 1.8 + i * 0.7) * 0.1;
    });
  });

  return (
    <group ref={group}>
      {Array.from({ length: count }).map((_, i) => {
        const sx = rowX(i, signals.length, 0.72);
        const mx = rowX(i, metrics.length, 0.78);
        const sh = 0.08 + signals[i]!.height * 2.5;
        const mh = 0.08 + metrics[i]!.height * 2.35;
        const start = new THREE.Vector3(sx, sh * 0.55, -0.35);
        const end = new THREE.Vector3(mx, mh * 0.55, 1.55);
        const mid = start.clone().lerp(end, 0.5);
        mid.y += 0.55;
        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const tube = new THREE.TubeGeometry(curve, 24, 0.012, 6, false);
        return (
          <mesh key={i} geometry={tube}>
            <meshBasicMaterial color={TARGET} transparent opacity={0.18} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function SelectedScene({
  post,
  reduce,
  detailed,
  hero,
}: {
  post: PulsePost;
  reduce: boolean;
  detailed: boolean;
  hero?: boolean;
}) {
  const columns = useMemo(() => selectedColumns(post), [post]);
  return (
    <>
      <Floor hero={hero} />
      {columns.signals.map((spec, index) => (
        <Column
          key={spec.key}
          spec={spec}
          x={rowX(index, columns.signals.length, hero ? 0.78 : 0.72)}
          z={-0.35}
          lift={hero ? 2.85 : 2.5}
          reduce={reduce}
          showValue={detailed}
          hero={hero}
        />
      ))}
      {columns.metrics.map((spec, index) => (
        <Column
          key={spec.key}
          spec={spec}
          x={rowX(index, columns.metrics.length, hero ? 0.85 : 0.78)}
          z={1.55}
          lift={hero ? 2.65 : 2.35}
          reduce={reduce}
          showValue={detailed}
          hero={hero}
        />
      ))}
      {hero ? <SignalBridges signals={columns.signals} metrics={columns.metrics} reduce={reduce} /> : null}
      {detailed
        ? columns.signals.map((spec, index) => (
            <LabelSprite
              key={`${spec.key}-label`}
              position={[rowX(index, columns.signals.length, 0.72), -0.34, -0.35]}
              text={spec.label}
            />
          ))
        : null}
      {detailed
        ? columns.metrics.map((spec, index) => (
            <LabelSprite
              key={`${spec.key}-label`}
              position={[rowX(index, columns.metrics.length, 0.78), -0.34, 1.55]}
              text={spec.label}
            />
          ))
        : null}
      {detailed ? <LabelSprite position={[0, 2.45, 0.2]} text="THIS LINK ONLY" color={TARGET} scale={1.15} /> : null}
      {!hero ? (
        <OrbitControls
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={5}
          maxDistance={12}
          minPolarAngle={0.7}
          maxPolarAngle={1.35}
          target={[0, 0.7, 0.45]}
          enabled={detailed}
        />
      ) : null}
    </>
  );
}

function CompareScene({
  result,
  reduce,
  detailed,
}: {
  result: PublicCompareResult;
  reduce: boolean;
  detailed: boolean;
}) {
  const columns = useMemo(() => compareColumns(result), [result]);
  return (
    <>
      <Floor />
      {columns.signals.map((pair, index) => {
        const x = rowX(index, columns.signals.length, 0.78);
        return (
          <group key={pair.label}>
            <Column spec={pair.viral} x={x - 0.16} z={-0.55} lift={2.15} reduce={reduce} showValue={false} />
            <Column
              spec={pair.target}
              x={x + 0.16}
              z={-0.15}
              lift={2.15}
              reduce={reduce}
              showValue={detailed}
            />
            {detailed ? <LabelSprite position={[x, -0.38, -0.15]} text={pair.label} /> : null}
          </group>
        );
      })}
      {columns.metrics.map((pair, index) => {
        const x = rowX(index, columns.metrics.length, 0.9);
        return (
          <group key={pair.label}>
            <Column spec={pair.viral} x={x - 0.16} z={1.25} lift={2.05} reduce={reduce} showValue={false} />
            <Column
              spec={pair.target}
              x={x + 0.16}
              z={1.65}
              lift={2.05}
              reduce={reduce}
              showValue={detailed}
            />
            {detailed ? <LabelSprite position={[x, -0.38, 1.65]} text={pair.label} /> : null}
          </group>
        );
      })}
      {detailed ? (
        <LabelSprite position={[0, 2.5, 0.2]} text="REFERENCE · TO IMPROVE · GAP" color="#e8f6f8" scale={1.35} />
      ) : null}
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={5.4}
        maxDistance={13}
        minPolarAngle={0.7}
        maxPolarAngle={1.35}
        target={[0, 0.65, 0.4]}
        enabled={detailed}
      />
    </>
  );
}

function HeroOrbits({ reduce }: { reduce: boolean }) {
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (reduce) return;
    const t = clock.elapsedTime;
    if (outer.current) outer.current.rotation.y = t * 0.12;
    if (inner.current) {
      inner.current.rotation.y = -t * 0.22;
      inner.current.rotation.x = Math.sin(t * 0.35) * 0.15;
    }
  });

  return (
    <>
      <group ref={outer} position={[0, 1.4, 0.4]}>
        <mesh rotation={[Math.PI / 2.4, 0.2, 0]}>
          <torusGeometry args={[3.6, 0.012, 8, 128]} />
          <meshBasicMaterial color={TARGET} transparent opacity={0.35} />
        </mesh>
        <mesh rotation={[Math.PI / 3, -0.4, 0.3]}>
          <torusGeometry args={[2.9, 0.008, 8, 96]} />
          <meshBasicMaterial color={FLARE} transparent opacity={0.22} />
        </mesh>
      </group>

      <Float speed={reduce ? 0 : 1.6} rotationIntensity={0.4} floatIntensity={0.6}>
        <group ref={inner} position={[-3.1, 2.1, -1.2]}>
          <mesh>
            <icosahedronGeometry args={[0.38, 1]} />
            <meshStandardMaterial
              color={TARGET}
              emissive={TARGET}
              emissiveIntensity={0.55}
              roughness={0.25}
              metalness={0.6}
              wireframe
            />
          </mesh>
          <mesh>
            <icosahedronGeometry args={[0.22, 0]} />
            <meshBasicMaterial color="#e8f6f8" transparent opacity={0.5} />
          </mesh>
        </group>
      </Float>

      <Float speed={reduce ? 0 : 1.2} rotationIntensity={0.3} floatIntensity={0.5}>
        <mesh position={[3.25, 1.85, -1.0]}>
          <octahedronGeometry args={[0.28, 0]} />
          <meshStandardMaterial
            color={FLARE}
            emissive={FLARE}
            emissiveIntensity={0.6}
            roughness={0.2}
            metalness={0.5}
            wireframe
          />
        </mesh>
      </Float>

      <Sparkles
        count={reduce ? 12 : 64}
        scale={[9, 5, 6]}
        size={2.2}
        speed={0.35}
        opacity={0.55}
        color={TARGET}
        position={[0, 1.6, 0.3]}
      />
      <Sparkles
        count={reduce ? 6 : 28}
        scale={[7, 4, 5]}
        size={1.6}
        speed={0.25}
        opacity={0.35}
        color={FLARE}
        position={[0, 1.2, 0.5]}
      />
    </>
  );
}

function HeroCameraRig({ reduce }: { reduce: boolean }) {
  const { camera } = useThree();
  useFrame(({ clock }) => {
    if (reduce) return;
    const t = clock.elapsedTime * 0.18;
    const r = 8.4;
    camera.position.x = Math.sin(t) * r * 0.22;
    camera.position.y = 2.35 + Math.sin(t * 0.7) * 0.18;
    camera.position.z = 8.2 + Math.cos(t * 0.5) * 0.35;
    camera.lookAt(0, 0.85, 0.45);
  });
  return null;
}

function Drift({ active, reduce, children }: { active: boolean; reduce: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current || !active || reduce) return;
    ref.current.rotation.y = Math.sin(clock.elapsedTime * 0.22) * 0.08;
    ref.current.position.y = Math.sin(clock.elapsedTime * 0.35) * 0.05;
  });
  return <group ref={ref}>{children}</group>;
}

function Scene({
  post,
  compare,
  reduce,
  detailed,
  atmosphere,
}: {
  post?: PulsePost;
  compare?: PublicCompareResult | null;
  reduce: boolean;
  detailed: boolean;
  atmosphere: boolean;
}) {
  if (compare) return <CompareScene result={compare} reduce={reduce} detailed={detailed} />;
  if (post) {
    return (
      <>
        {atmosphere ? <HeroOrbits reduce={reduce} /> : null}
        {atmosphere ? <HeroCameraRig reduce={reduce} /> : null}
        <Drift active={atmosphere} reduce={reduce}>
          <SelectedScene post={post} reduce={reduce} detailed={detailed} hero={atmosphere} />
        </Drift>
      </>
    );
  }
  return (
    <>
      <Floor hero={atmosphere} />
      {atmosphere ? <HeroOrbits reduce={reduce} /> : null}
      <LabelSprite position={[0, 0.8, 0]} text="Select one link" color="#93a6b8" scale={1.2} />
    </>
  );
}

export function PulseCanvas({
  model,
  selectedPost,
  compare,
  mode,
}: {
  model: Pick<PulseModel, "posts">;
  selectedPost?: PulsePost;
  compare?: PublicCompareResult | null;
  mode: "hero" | "chamber";
}) {
  const reduce = useReducedMotion() ?? false;
  const [mounted, setMounted] = useState(false);
  const [fine, setFine] = useState(true);
  useEffect(() => {
    setMounted(true);
    const query = window.matchMedia("(max-width: 860px)");
    const apply = () => setFine(!query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  const post = selectedPost ?? (mode === "hero" ? model.posts[0] : undefined);
  if (!mounted) return <div className="h-full w-full bg-bg" />;
  return (
    <Canvas
      className={mode === "hero" ? "pointer-events-none" : undefined}
      dpr={[1, fine ? (mode === "hero" ? 1.75 : 1.5) : 1.15]}
      camera={{
        position: [0, fine ? 2.25 : 2.55, mode === "hero" ? (fine ? 8.4 : 7.2) : fine ? 8.1 : 6.4],
        fov: fine ? 38 : 50,
        near: 0.1,
        far: 50,
      }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: mode === "hero" ? 1.15 : 1,
      }}
    >
      <Scene
        post={compare ? undefined : post}
        compare={compare}
        reduce={reduce}
        detailed={mode === "chamber"}
        atmosphere={mode === "hero"}
      />
    </Canvas>
  );
}

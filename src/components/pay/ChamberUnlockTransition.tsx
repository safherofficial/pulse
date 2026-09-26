import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const DURATION_MS = 2400;

function ChamberCore({ accent }: { accent: string }) {
  const group = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);

  const points = useMemo(() => {
    const result: THREE.Vector3[] = [];
    const count = 72;
    for (let i = 0; i < count; i += 1) {
      const t = (i / count) * Math.PI * 2;
      const radius = 1.75 + (i % 5) * 0.075;
      result.push(
        new THREE.Vector3(
          Math.cos(t) * radius,
          Math.sin(t * 1.75) * 0.18,
          Math.sin(t) * radius,
        ),
      );
    }
    return result;
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.04);
    if (group.current) {
      group.current.rotation.y += dt * 0.42;
      group.current.rotation.x = Math.sin(performance.now() * 0.00055) * 0.08;
    }
    if (ringA.current) {
      ringA.current.rotation.z += dt * 0.9;
      ringA.current.scale.setScalar(1 + Math.sin(performance.now() * 0.0035) * 0.05);
    }
    if (ringB.current) {
      ringB.current.rotation.x -= dt * 0.65;
      ringB.current.rotation.y += dt * 0.55;
      ringB.current.scale.setScalar(1 + Math.sin(performance.now() * 0.0026 + 1) * 0.04);
    }
    if (core.current) {
      const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.08;
      core.current.scale.setScalar(pulse);
    }
  });

  const accentColor = new THREE.Color(accent);
  const softAccent = accentColor.clone().lerp(new THREE.Color("#ffffff"), 0.35);

  return (
    <group ref={group}>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.42, 2]} />
        <meshBasicMaterial color={softAccent} transparent opacity={0.94} wireframe />
      </mesh>

      <mesh ref={ringA}>
        <torusGeometry args={[1.0, 0.012, 8, 128]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.95} />
      </mesh>

      <mesh ref={ringB} rotation={[Math.PI / 2, 0.25, 0]}>
        <torusGeometry args={[1.42, 0.009, 8, 128]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.55} />
      </mesh>

      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.82, 0.006, 6, 128]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.32} />
      </mesh>

      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array(points.flatMap((point) => [point.x, point.y, point.z])), 3]}
          />
        </bufferGeometry>
        <pointsMaterial color={accentColor} size={0.025} sizeAttenuation transparent opacity={0.72} />
      </points>

      {[0, 1, 2, 3].map((index) => (
        <mesh
          key={index}
          rotation={[
            index * 0.62,
            index * 0.45,
            index * 0.78,
          ]}
          scale={1 + index * 0.12}
        >
          <boxGeometry args={[2.05, 0.008, 0.008]} />
          <meshBasicMaterial color={softAccent} transparent opacity={0.16} />
        </mesh>
      ))}
    </group>
  );
}

export function ChamberUnlockTransition({ onComplete }: { onComplete: () => void }) {
  const [accent, setAccent] = useState("#9EE7FF");

  useEffect(() => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim();
    if (value) setAccent(value);

    const timer = window.setTimeout(onComplete, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <main className="fixed inset-0 z-[100] overflow-hidden bg-bg text-fg">
      <div className="absolute inset-0">
        <Canvas
          dpr={[1, 1.75]}
          camera={{ position: [0, 0.2, 5.2], fov: 46 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        >
          <color attach="background" args={["#050708"]} />
          <ambientLight intensity={0.3} />
          <pointLight position={[0, 1, 3]} intensity={1.4} color={accent} />
          <ChamberCore accent={accent} />
        </Canvas>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_22%,rgba(5,7,8,0.35)_58%,rgba(5,7,8,0.92)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/10" />

      <div className="relative z-10 flex min-h-dvh items-center justify-center px-6 text-center">
        <div className="max-w-xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
            Wallet verified
          </p>
          <h1 className="mt-4 text-4xl font-medium tracking-tight sm:text-6xl">
            Your chamber is open.
          </h1>
          <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-muted sm:text-base">
            Ownership confirmed. Initializing your private XPulse chamber…
          </p>
          <div className="mx-auto mt-8 h-px w-40 overflow-hidden bg-white/10">
            <div
              className="h-full origin-left bg-accent"
              style={{ animation: `chamber-progress ${DURATION_MS}ms cubic-bezier(.22,1,.36,1) forwards` }}
            />
          </div>
          <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.24em] text-subtle">
            wallet → entitlement → chamber
          </p>
        </div>
      </div>

      <style>{`
        @keyframes chamber-progress {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
      `}</style>
    </main>
  );
}

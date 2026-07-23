"use client";

import { ContactShadows, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import * as THREE from "three";

export type CharacterMood = "idle" | "thinking" | "talking";

const CREAM = "#faf9f5";
const INK = "#3d3929";
const RUST = "#d97757";

function Automaton({ mood }: { mood: CharacterMood }) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const antennaTip = useRef<THREE.Mesh>(null);
  const armLeft = useRef<THREE.Group>(null);
  const armRight = useRef<THREE.Group>(null);
  const [waveUntil, setWaveUntil] = useState(0);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // gentle idle bob
    if (root.current) {
      root.current.position.y = Math.sin(t * 1.6) * 0.06 - 0.15;
    }

    // head follows the pointer
    if (head.current) {
      const nod = mood === "talking" ? Math.sin(t * 8) * 0.06 : 0;
      head.current.rotation.y = THREE.MathUtils.lerp(
        head.current.rotation.y,
        state.pointer.x * 0.55,
        0.1
      );
      head.current.rotation.x = THREE.MathUtils.lerp(
        head.current.rotation.x,
        -state.pointer.y * 0.35 + nod,
        0.1
      );
    }

    // mouth chatters while talking
    if (mouth.current) {
      const target = mood === "talking" ? 1 + Math.abs(Math.sin(t * 12)) * 2 : 1;
      mouth.current.scale.y = THREE.MathUtils.lerp(
        mouth.current.scale.y,
        target,
        0.25
      );
    }

    // antenna glows while thinking
    if (antennaTip.current) {
      const mat = antennaTip.current.material as THREE.MeshStandardMaterial;
      const target = mood === "thinking" ? 1.6 + Math.sin(t * 9) * 1.2 : 0.25;
      mat.emissiveIntensity = THREE.MathUtils.lerp(
        mat.emissiveIntensity,
        target,
        0.12
      );
    }

    // arms: subtle sway, or a wave when clicked
    const waving = Date.now() < waveUntil;
    if (armRight.current) {
      const target = waving
        ? Math.PI * 0.85 + Math.sin(t * 14) * 0.35
        : Math.sin(t * 1.6) * 0.08 + 0.15;
      armRight.current.rotation.z = THREE.MathUtils.lerp(
        armRight.current.rotation.z,
        target,
        0.15
      );
    }
    if (armLeft.current) {
      armLeft.current.rotation.z =
        -Math.sin(t * 1.6) * 0.08 - 0.15;
    }
  });

  return (
    <group
      ref={root}
      onClick={() => setWaveUntil(Date.now() + 1600)}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "auto")}
    >
      {/* body */}
      <RoundedBox args={[1.15, 1.1, 0.85]} radius={0.18} position={[0, -0.7, 0]}>
        <meshStandardMaterial color={CREAM} roughness={0.6} />
      </RoundedBox>
      {/* chest badge */}
      <mesh position={[0, -0.62, 0.44]}>
        <cylinderGeometry args={[0.12, 0.12, 0.04, 24]} />
        <meshStandardMaterial color={RUST} roughness={0.5} />
      </mesh>

      {/* arms */}
      <group ref={armLeft} position={[-0.72, -0.45, 0]}>
        <mesh position={[0, -0.28, 0]}>
          <capsuleGeometry args={[0.11, 0.35, 8, 16]} />
          <meshStandardMaterial color={RUST} roughness={0.55} />
        </mesh>
      </group>
      <group ref={armRight} position={[0.72, -0.45, 0]}>
        <mesh position={[0, -0.28, 0]}>
          <capsuleGeometry args={[0.11, 0.35, 8, 16]} />
          <meshStandardMaterial color={RUST} roughness={0.55} />
        </mesh>
      </group>

      {/* head */}
      <group ref={head} position={[0, 0.35, 0]}>
        <RoundedBox args={[1.35, 1.0, 0.95]} radius={0.22}>
          <meshStandardMaterial color={CREAM} roughness={0.6} />
        </RoundedBox>
        {/* face screen */}
        <RoundedBox args={[0.95, 0.6, 0.1]} radius={0.08} position={[0, -0.02, 0.46]}>
          <meshStandardMaterial color={INK} roughness={0.35} />
        </RoundedBox>
        {/* eyes */}
        <mesh position={[-0.22, 0.06, 0.53]}>
          <sphereGeometry args={[0.075, 24, 24]} />
          <meshStandardMaterial
            color={CREAM}
            emissive={CREAM}
            emissiveIntensity={0.6}
          />
        </mesh>
        <mesh position={[0.22, 0.06, 0.53]}>
          <sphereGeometry args={[0.075, 24, 24]} />
          <meshStandardMaterial
            color={CREAM}
            emissive={CREAM}
            emissiveIntensity={0.6}
          />
        </mesh>
        {/* mouth */}
        <mesh ref={mouth} position={[0, -0.18, 0.53]}>
          <boxGeometry args={[0.28, 0.045, 0.02]} />
          <meshStandardMaterial
            color={RUST}
            emissive={RUST}
            emissiveIntensity={0.5}
          />
        </mesh>
        {/* ears */}
        <mesh position={[-0.72, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.14, 0.14, 0.12, 24]} />
          <meshStandardMaterial color={RUST} roughness={0.55} />
        </mesh>
        <mesh position={[0.72, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.14, 0.14, 0.12, 24]} />
          <meshStandardMaterial color={RUST} roughness={0.55} />
        </mesh>
        {/* antenna */}
        <mesh position={[0, 0.62, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.28, 12]} />
          <meshStandardMaterial color={INK} />
        </mesh>
        <mesh ref={antennaTip} position={[0, 0.8, 0]}>
          <sphereGeometry args={[0.08, 24, 24]} />
          <meshStandardMaterial
            color={RUST}
            emissive={RUST}
            emissiveIntensity={0.25}
          />
        </mesh>
      </group>

      <ContactShadows
        position={[0, -1.35, 0]}
        opacity={0.3}
        scale={4}
        blur={2.4}
      />
    </group>
  );
}

export function CharacterCanvas({ mood }: { mood: CharacterMood }) {
  return (
    <Canvas
      camera={{ position: [0, 0.2, 4.2], fov: 36 }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 4, 5]} intensity={1.4} />
      <directionalLight position={[-3, 2, -2]} intensity={0.4} />
      <Automaton mood={mood} />
    </Canvas>
  );
}

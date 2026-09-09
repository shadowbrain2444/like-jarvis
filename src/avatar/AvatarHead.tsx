/**
 * The avatar itself (spec section 22): a stylized, low-poly female-
 * presenting head/bust rendered procedurally rather than as an imported
 * rigged model. Shipping a licensed/rigged 3D asset is out of scope for
 * this pass — see VEYRA_ARCHITECTURE.md "Avatar model is replaceable" —
 * but every animation hook a real GLTF avatar would need (state-driven
 * material, amplitude-driven mouth open, idle blink/breathe, listening/
 * thinking/speaking reactivity) is implemented for real here against
 * [[avatarRuntime]], so swapping in a rigged model later means replacing
 * this component's geometry, not the animation logic driving it.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { avatarRuntime } from "./avatarRuntime";
import { STATE_VISUALS, AVATAR_COLORS } from "./theme";

export function AvatarHead() {
  const headRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const eyeLRef = useRef<THREE.Mesh>(null);
  const eyeRRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const headMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const groupRef = useRef<THREE.Group>(null);

  const blinkClock = useRef(0);
  const nextBlinkAt = useRef(2 + Math.random() * 3);

  const particles = useMemo(() => {
    const count = 10;
    return new Array(count).fill(0).map((_, i) => ({
      angle: (i / count) * Math.PI * 2,
      radius: 1.6 + (i % 3) * 0.15,
      speed: 0.6 + (i % 4) * 0.15,
      yOffset: Math.sin(i) * 0.3,
    }));
  }, []);
  const particleRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((frameState, delta) => {
    const { state, amplitude } = avatarRuntime.sample();
    const visuals = STATE_VISUALS[state] ?? STATE_VISUALS.SLEEPING;
    const t = frameState.clock.elapsedTime;

    // Idle breathing scale, faster/larger when more "alert".
    if (groupRef.current) {
      const breathe = 1 + Math.sin(t * visuals.breathe) * 0.02;
      const speakingBoost = state === "SPEAKING" ? amplitude * 0.06 : 0;
      groupRef.current.scale.setScalar(breathe + speakingBoost);
      groupRef.current.rotation.y = Math.sin(t * 0.15) * 0.12;
    }

    // Mouth: open proportional to speaking amplitude; closed otherwise.
    if (mouthRef.current) {
      const openAmount = state === "SPEAKING" ? 0.05 + amplitude * 0.35 : 0.04;
      mouthRef.current.scale.y = THREE.MathUtils.lerp(mouthRef.current.scale.y, openAmount, 0.4);
    }

    // Eyes: periodic blink, all states except SLEEPING (which stays closed).
    blinkClock.current += delta;
    const blinkProgress =
      state === "SLEEPING"
        ? 0
        : blinkClock.current > nextBlinkAt.current
          ? Math.max(0, 1 - (blinkClock.current - nextBlinkAt.current) * 10)
          : 1;
    if (blinkClock.current > nextBlinkAt.current + 0.15) {
      blinkClock.current = 0;
      nextBlinkAt.current = 2 + Math.random() * 3;
    }
    const eyeScaleY = state === "SLEEPING" ? 0.05 : Math.max(0.08, blinkProgress);
    if (eyeLRef.current) eyeLRef.current.scale.y = eyeScaleY;
    if (eyeRRef.current) eyeRRef.current.scale.y = eyeScaleY;

    // Activity ring: pulses with listening amplitude, spins while thinking.
    if (ringRef.current) {
      const pulse = state === "LISTENING" ? 1 + amplitude * 0.25 : 1;
      ringRef.current.scale.setScalar(pulse);
      if (state === "THINKING") ringRef.current.rotation.z += delta * 1.2;
      else if (state === "ERROR") ringRef.current.rotation.z += delta * 3;
    }
    if (ringMatRef.current) {
      ringMatRef.current.color.setHex(visuals.ring);
      ringMatRef.current.emissive.setHex(visuals.ring);
      ringMatRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        ringMatRef.current.emissiveIntensity,
        visuals.ringIntensity,
        0.1
      );
    }
    if (headMatRef.current) {
      headMatRef.current.emissive.setHex(visuals.core);
      headMatRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        headMatRef.current.emissiveIntensity,
        0.35,
        0.1
      );
    }

    // Thinking particles orbit the head; otherwise parked invisibly small.
    const showParticles = state === "THINKING";
    particleRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const p = particles[i];
      const angle = p.angle + t * p.speed;
      mesh.position.set(Math.cos(angle) * p.radius, p.yOffset + Math.sin(t + i) * 0.1, Math.sin(angle) * p.radius);
      const targetScale = showParticles ? 1 : 0;
      mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, targetScale, 0.15));
    });
  });

  return (
    <group ref={groupRef}>
      {/* Head */}
      <mesh ref={headRef} castShadow>
        <icosahedronGeometry args={[1, 3]} />
        <meshStandardMaterial
          ref={headMatRef}
          color={AVATAR_COLORS.maroon}
          emissive={AVATAR_COLORS.maroonDeep}
          emissiveIntensity={0.3}
          roughness={0.35}
          metalness={0.4}
        />
      </mesh>

      {/* Eyes */}
      <mesh ref={eyeLRef} position={[-0.32, 0.12, 0.88]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={AVATAR_COLORS.white} emissive={AVATAR_COLORS.white} emissiveIntensity={0.6} />
      </mesh>
      <mesh ref={eyeRRef} position={[0.32, 0.12, 0.88]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={AVATAR_COLORS.white} emissive={AVATAR_COLORS.white} emissiveIntensity={0.6} />
      </mesh>

      {/* Mouth */}
      <mesh ref={mouthRef} position={[0, -0.32, 0.92]}>
        <boxGeometry args={[0.32, 0.08, 0.05]} />
        <meshStandardMaterial color={AVATAR_COLORS.black} />
      </mesh>

      {/* Activity ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[1.55, 0.02, 16, 100]} />
        <meshStandardMaterial
          ref={ringMatRef}
          color={AVATAR_COLORS.maroonBright}
          emissive={AVATAR_COLORS.maroonBright}
          emissiveIntensity={0.5}
          roughness={0.2}
          metalness={0.6}
        />
      </mesh>

      {/* Thinking particles */}
      {particles.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            particleRefs.current[i] = el;
          }}
          scale={0}
        >
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial
            color={AVATAR_COLORS.white}
            emissive={AVATAR_COLORS.maroonBright}
            emissiveIntensity={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}

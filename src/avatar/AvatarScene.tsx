/**
 * Canvas host for [[AvatarHead]] (spec section 22/23). Owns the camera and
 * lighting rig — a maroon key light plus a cool white rim light, on a
 * black void, matching VEYRA's visual identity.
 */

import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { avatarRuntime } from "./avatarRuntime";
import { AvatarHead } from "./AvatarHead";
import { AVATAR_COLORS } from "./theme";

export function AvatarScene() {
  useEffect(() => {
    avatarRuntime.attach();
    return () => avatarRuntime.detach();
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 0, 4.2], fov: 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={[AVATAR_COLORS.black]} />
      <ambientLight intensity={0.25} color={AVATAR_COLORS.whiteDim} />
      <pointLight position={[-3, 2, 3]} intensity={40} color={AVATAR_COLORS.maroonBright} />
      <pointLight position={[3, 1, 2]} intensity={20} color={AVATAR_COLORS.white} />
      <pointLight position={[0, -2, -3]} intensity={12} color={AVATAR_COLORS.maroon} />
      <AvatarHead />
    </Canvas>
  );
}

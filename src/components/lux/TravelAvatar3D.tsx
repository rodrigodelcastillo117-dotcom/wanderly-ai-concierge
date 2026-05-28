import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Float, Stars } from "@react-three/drei";
import * as THREE from "three";

export type AvatarStyle = "foodie" | "adventurer" | "luxury" | "cultural" | "relax" | "nightlife";

const STYLE_COLORS: Record<AvatarStyle, { body: string; accent: string; bg: string }> = {
  foodie:     { body: "#b4513a", accent: "#f5c16c", bg: "#1a0d08" },
  adventurer: { body: "#3a5a3e", accent: "#c9a861", bg: "#0c1a10" },
  luxury:     { body: "#1a1a1a", accent: "#e8c66c", bg: "#0a0a0a" },
  cultural:   { body: "#3a3f6b", accent: "#d4b87c", bg: "#0d0f1c" },
  relax:      { body: "#5a8a8e", accent: "#f0d8a8", bg: "#0a1414" },
  nightlife:  { body: "#3a1a4a", accent: "#e84393", bg: "#0a0410" },
};

function Figure({ style }: { style: AvatarStyle }) {
  const group = useRef<THREE.Group>(null);
  const colors = STYLE_COLORS[style] ?? STYLE_COLORS.cultural;

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.35;
  });

  return (
    <group ref={group} position={[0, -0.6, 0]}>
      {/* Body */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <capsuleGeometry args={[0.45, 0.9, 8, 16]} />
        <meshStandardMaterial color={colors.body} roughness={0.4} metalness={0.2} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.55, 0]} castShadow>
        <sphereGeometry args={[0.38, 32, 32]} />
        <meshStandardMaterial color="#e8c9a0" roughness={0.5} />
      </mesh>
      {/* Eyes */}
      <mesh position={[-0.12, 1.6, 0.34]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
      <mesh position={[0.12, 1.6, 0.34]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
      {/* Arms */}
      <mesh position={[-0.55, 0.7, 0]} rotation={[0, 0, 0.3]}>
        <capsuleGeometry args={[0.12, 0.55, 6, 12]} />
        <meshStandardMaterial color={colors.body} />
      </mesh>
      <mesh position={[0.55, 0.7, 0]} rotation={[0, 0, -0.3]}>
        <capsuleGeometry args={[0.12, 0.55, 6, 12]} />
        <meshStandardMaterial color={colors.body} />
      </mesh>
      {/* Legs */}
      <mesh position={[-0.2, -0.2, 0]}>
        <capsuleGeometry args={[0.14, 0.5, 6, 12]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      <mesh position={[0.2, -0.2, 0]}>
        <capsuleGeometry args={[0.14, 0.5, 6, 12]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>

      {/* Style-specific accessories */}
      {style === "luxury" && (
        <group position={[0, 1.95, 0]}>
          {/* Crown ring */}
          <mesh>
            <torusGeometry args={[0.32, 0.06, 12, 24]} />
            <meshStandardMaterial color={colors.accent} metalness={0.95} roughness={0.15} />
          </mesh>
          {[0, 1, 2, 3, 4, 5].map(i => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.32, 0.1, Math.sin(a) * 0.32]}>
                <coneGeometry args={[0.06, 0.18, 8]} />
                <meshStandardMaterial color={colors.accent} metalness={0.95} roughness={0.15} />
              </mesh>
            );
          })}
        </group>
      )}

      {style === "foodie" && (
        <>
          {/* Chef hat */}
          <mesh position={[0, 2.0, 0]}>
            <cylinderGeometry args={[0.32, 0.32, 0.15, 24]} />
            <meshStandardMaterial color="#f8f8f8" />
          </mesh>
          <mesh position={[0, 2.25, 0]}>
            <sphereGeometry args={[0.38, 24, 24]} />
            <meshStandardMaterial color="#f8f8f8" />
          </mesh>
          {/* Floating fork */}
          <Float speed={2} floatIntensity={0.5} rotationIntensity={0.5}>
            <mesh position={[0.95, 1.2, 0]} rotation={[0, 0, Math.PI / 4]}>
              <cylinderGeometry args={[0.025, 0.025, 0.5, 8]} />
              <meshStandardMaterial color={colors.accent} metalness={0.8} roughness={0.2} />
            </mesh>
          </Float>
        </>
      )}

      {style === "adventurer" && (
        <>
          {/* Backpack */}
          <mesh position={[0, 0.7, -0.45]}>
            <boxGeometry args={[0.55, 0.7, 0.3]} />
            <meshStandardMaterial color={colors.accent} roughness={0.7} />
          </mesh>
          {/* Headband */}
          <mesh position={[0, 1.75, 0]}>
            <torusGeometry args={[0.38, 0.05, 8, 24]} />
            <meshStandardMaterial color={colors.accent} />
          </mesh>
          {/* Floating compass */}
          <Float speed={1.5} floatIntensity={0.4}>
            <mesh position={[-1.0, 1.0, 0]}>
              <cylinderGeometry args={[0.18, 0.18, 0.05, 24]} />
              <meshStandardMaterial color={colors.accent} metalness={0.7} />
            </mesh>
          </Float>
        </>
      )}

      {style === "cultural" && (
        <>
          {/* Beret */}
          <mesh position={[0, 1.9, 0]} rotation={[0.2, 0, 0.1]}>
            <cylinderGeometry args={[0.42, 0.42, 0.1, 24]} />
            <meshStandardMaterial color={colors.body} />
          </mesh>
          {/* Glasses */}
          <mesh position={[-0.12, 1.6, 0.36]}>
            <torusGeometry args={[0.08, 0.015, 8, 16]} />
            <meshStandardMaterial color={colors.accent} metalness={0.8} />
          </mesh>
          <mesh position={[0.12, 1.6, 0.36]}>
            <torusGeometry args={[0.08, 0.015, 8, 16]} />
            <meshStandardMaterial color={colors.accent} metalness={0.8} />
          </mesh>
        </>
      )}

      {style === "relax" && (
        <>
          {/* Flower crown */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
            const a = (i / 8) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * 0.4, 1.85, Math.sin(a) * 0.4]}>
                <sphereGeometry args={[0.08, 12, 12]} />
                <meshStandardMaterial color={i % 2 ? colors.accent : "#f0a0c0"} />
              </mesh>
            );
          })}
          {/* Sun behind */}
          <Float speed={0.8} floatIntensity={0.3}>
            <mesh position={[1.3, 1.8, -0.5]}>
              <sphereGeometry args={[0.25, 24, 24]} />
              <meshStandardMaterial color={colors.accent} emissive={colors.accent} emissiveIntensity={0.6} />
            </mesh>
          </Float>
        </>
      )}

      {style === "nightlife" && (
        <>
          {/* Sunglasses bar */}
          <mesh position={[0, 1.62, 0.36]}>
            <boxGeometry args={[0.45, 0.12, 0.05]} />
            <meshStandardMaterial color="#0a0a0a" metalness={0.9} roughness={0.1} />
          </mesh>
          {/* Neon halo */}
          <mesh position={[0, 1.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.6, 0.025, 8, 48]} />
            <meshStandardMaterial color={colors.accent} emissive={colors.accent} emissiveIntensity={1.2} />
          </mesh>
        </>
      )}
    </group>
  );
}

export const TravelAvatar3D = ({ style }: { style: AvatarStyle }) => {
  const colors = STYLE_COLORS[style] ?? STYLE_COLORS.cultural;
  return (
    <div className="w-full h-[320px] md:h-[420px] rounded-2xl overflow-hidden border border-primary/20 relative" style={{ background: `radial-gradient(ellipse at center, ${colors.bg} 0%, #000 100%)` }}>
      <Canvas shadows camera={{ position: [0, 1.2, 4], fov: 40 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 6, 5]} intensity={1.1} castShadow color={colors.accent} />
        <directionalLight position={[-4, 3, -3]} intensity={0.5} color="#9ab4ff" />
        <Suspense fallback={null}>
          <Stars radius={50} depth={20} count={800} factor={3} fade speed={0.6} />
          <Figure style={style} />
          {/* Floor disc */}
          <mesh position={[0, -1.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[1.4, 48]} />
            <meshStandardMaterial color={colors.accent} transparent opacity={0.12} />
          </mesh>
        </Suspense>
        <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 3} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
      <div className="absolute top-3 left-3 text-[10px] tracking-[0.3em] text-primary uppercase bg-black/50 backdrop-blur px-2 py-1 rounded-full border border-primary/30">
        Estilo · {style}
      </div>
    </div>
  );
};

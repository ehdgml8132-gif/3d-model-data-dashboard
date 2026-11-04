import { useEffect, useState } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { BuildingElement, FloorFilter } from '../data/building'
import { filterBuildingElements } from '../lib/building'

type Props = {
  elements: BuildingElement[]
  selectedId: string
  onSelect: (id: string) => void
  floor: FloorFilter
  resetKey: number
}

const COLORS = { column: '#e2d9c7', beam: '#bc9f78', slab: '#95b5bd', wall: '#d2d6ca' }
const ignoreRaycast = () => undefined

function ElementMesh({
  element,
  selected,
  onSelect,
}: {
  element: BuildingElement
  selected: boolean
  onSelect: Props['onSelect']
}) {
  const [hovered, setHovered] = useState(false)
  const isSlab = element.kind === 'slab'
  const color = selected ? '#63ab8e' : hovered ? '#e0b46e' : COLORS[element.kind]
  useEffect(() => {
    if (hovered) document.body.style.cursor = 'pointer'
    return () => {
      document.body.style.cursor = ''
    }
  }, [hovered])
  const handlers = {
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      onSelect(element.id)
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      setHovered(true)
    },
    onPointerOut: () => setHovered(false),
  }
  return (
    <group position={element.position}>
      <mesh
        {...(!isSlab ? handlers : {})}
        raycast={isSlab ? ignoreRaycast : undefined}
        castShadow={!isSlab}
        receiveShadow
      >
        <boxGeometry args={element.dimensions} />
        <meshStandardMaterial
          color={color}
          roughness={0.75}
          transparent={isSlab}
          opacity={isSlab ? (selected ? 0.55 : 0.22) : 1}
          depthWrite={!isSlab}
        />
        <Edges
          threshold={25}
          color={selected ? '#27684f' : '#7f9287'}
          transparent
          opacity={selected ? 0.9 : 0.45}
          raycast={ignoreRaycast}
        />
      </mesh>
      {isSlab && (
        <mesh position={[0, 0, element.dimensions[2] / 2 - 0.06]} {...handlers}>
          {/* The exposed front edge selects the slab without blocking frame clicks. */}
          <boxGeometry args={[element.dimensions[0], element.dimensions[1] + 0.035, 0.12]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      )}
      {selected && (
        <mesh scale={[1.025, 1.025, 1.025]} raycast={ignoreRaycast}>
          <boxGeometry args={element.dimensions} />
          <meshBasicMaterial visible={false} />
          <Edges
            color="#1d7050"
            transparent
            opacity={0.9}
            depthTest={false}
            raycast={ignoreRaycast}
          />
        </mesh>
      )}
    </group>
  )
}

function SiteTree({ position, size = 1 }: { position: [number, number, number]; size?: number }) {
  return (
    <group position={position} scale={size}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 1, 8]} />
        <meshStandardMaterial color="#9a8c70" />
      </mesh>
      <mesh position={[0, 1.15, 0]} scale={[0.48, 0.7, 0.48]} castShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#8ca68d" roughness={0.95} />
      </mesh>
    </group>
  )
}

function FrameCamera({ floor, resetKey }: { floor: FloorFilter; resetKey: number }) {
  const { camera, controls, size } = useThree()
  useEffect(() => {
    const targetY = floor === 'all' ? 4.4 : (Number.parseInt(floor) - 1) * 3.2 + 1.5
    const orbit =
      controls && 'target' in controls
        ? (controls as unknown as {
            target: THREE.Vector3
            enableDamping: boolean
            update: () => void
          })
        : null
    const damping = orbit?.enableDamping
    if (orbit) {
      // Flush the previous drag/zoom inertia before applying the new framing.
      // Otherwise the next animation frame rotates away from the reset view.
      orbit.enableDamping = false
      orbit.update()
      orbit.target.set(0, targetY, 0)
    }
    camera.position.set(14, targetY + 12, 16)
    camera.lookAt(0, targetY, 0)
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(size.width / 15.2, size.height / (floor === 'all' ? 14.8 : 9.5))
      camera.updateProjectionMatrix()
    }
    if (orbit) {
      orbit.update()
      orbit.enableDamping = damping ?? true
    }
  }, [camera, controls, floor, resetKey, size.width, size.height])
  return null
}

export default function BuildingScene({ elements, selectedId, onSelect, floor, resetKey }: Props) {
  const visible = filterBuildingElements(elements, floor)
  const base = floor === 'all' ? 0 : (Number.parseInt(floor) - 1) * 3.2
  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [14, 16.4, 16], zoom: 28, near: 0.1, far: 120 }}
      gl={{ antialias: true, alpha: true }}
    >
      <color attach="background" args={['#f0f3ef']} />
      <ambientLight intensity={1.6} />
      <hemisphereLight args={['#fff8e8', '#b0beb3', 1]} />
      <directionalLight
        position={[10, 20, 8]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={16}
        shadow-camera-bottom={-10}
        shadow-normalBias={0.035}
      />
      <group position={[0, base, 0]}>
        <mesh position={[0, -0.15, 0]} receiveShadow>
          <boxGeometry args={[10.8, 0.25, 8.8]} />
          <meshStandardMaterial color="#e3e4d9" roughness={0.95} />
        </mesh>
        <gridHelper args={[12, 12, '#ced7cb', '#dde3d8']} position={[0, -0.005, 0]} />
        {floor === 'all' && (
          <>
            <SiteTree position={[-5.05, 0, -3.6]} size={1.25} />
            <SiteTree position={[-5.05, 0, 2.8]} size={0.95} />
            <SiteTree position={[4.9, 0, -3.9]} size={1.05} />
            {/* A 1.7 m scale figure beside the 8 x 6 m structural grid. */}
            <group position={[4.9, 0, 2.65]}>
              <mesh position={[0, 1.5, 0]} castShadow>
                <sphereGeometry args={[0.15, 14, 12]} />
                <meshStandardMaterial color="#647e6c" />
              </mesh>
              <mesh position={[0, 1.02, 0]} castShadow>
                <cylinderGeometry args={[0.13, 0.15, 0.65, 12]} />
                <meshStandardMaterial color="#647e6c" />
              </mesh>
              {[-0.075, 0.075].map((x) => (
                <mesh key={x} position={[x, 0.37, 0]}>
                  <cylinderGeometry args={[0.05, 0.05, 0.7, 8]} />
                  <meshStandardMaterial color="#647e6c" />
                </mesh>
              ))}
            </group>
          </>
        )}
      </group>
      {visible.map((element) => (
        <ElementMesh
          key={element.id}
          element={element}
          selected={selectedId === element.id}
          onSelect={onSelect}
        />
      ))}
      <mesh position={[0, base - 0.285, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial transparent opacity={0.09} />
      </mesh>
      <OrbitControls
        makeDefault
        target={[0, 4.4, 0]}
        enablePan={false}
        minZoom={13}
        maxZoom={100}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.2}
      />
      <FrameCamera floor={floor} resetKey={resetKey} />
    </Canvas>
  )
}

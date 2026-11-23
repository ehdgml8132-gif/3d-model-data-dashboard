import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { BUILDING_ELEMENTS, type BuildingElement, type FloorFilter } from '../data/building'
import { filterBuildingElements } from '../lib/building'
import {
  boundsForSample,
  clippingPlanes,
  sectionBounds,
  sectionRaycast,
  sectionTransform,
  type SectionBoxSettings,
} from '../lib/sectionBox'
import { FrameBoxCamera, SectionBoxVisual } from './SectionBox'
import SectionBoxHandles from './SectionBoxHandles'
import ViewerDirectionCamera, { type ViewerDirectionProps } from './ViewerDirectionCamera'

type Props = ViewerDirectionProps & {
  elements: BuildingElement[]
  selectedId: string
  onSelect: (id: string) => void
  floor: FloorFilter
  resetKey: number
  sectionBox?: SectionBoxSettings | null
  onSectionBoxChange?: (settings: SectionBoxSettings) => void
  sectionBoxSelected?: boolean
  onSectionBoxSelect?: () => void
  onSectionBoxDeselect?: () => void
}

const COLORS = { column: '#e2d9c7', beam: '#bc9f78', slab: '#95b5bd', wall: '#d2d6ca' }
const ignoreRaycast = () => undefined

function ElementMesh({
  element,
  selected,
  onSelect,
  sectionActive,
  raycast,
  planes,
}: {
  element: BuildingElement
  selected: boolean
  onSelect: Props['onSelect']
  sectionActive: boolean
  raycast: THREE.Mesh['raycast']
  planes: THREE.Plane[]
}) {
  const [hovered, setHovered] = useState(false)
  const isSlab = element.kind === 'slab'
  const color = selected ? '#63ab8e' : hovered ? '#e0b46e' : COLORS[element.kind]
  useEffect(() => setHovered(false), [planes])
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
        {...(!isSlab || sectionActive ? handlers : {})}
        raycast={isSlab && !sectionActive ? ignoreRaycast : raycast}
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
          side={sectionActive ? THREE.DoubleSide : THREE.FrontSide}
          clippingPlanes={planes}
          clipShadows
        />
        <Edges
          threshold={25}
          color={selected ? '#27684f' : '#7f9287'}
          transparent
          opacity={selected ? 0.9 : 0.45}
          raycast={ignoreRaycast}
          clippingPlanes={planes}
        />
      </mesh>
      {isSlab && (
        <mesh position={[0, 0, element.dimensions[2] / 2 - 0.06]} {...handlers} raycast={raycast}>
          {/* The exposed front edge selects the slab without blocking frame clicks. */}
          <boxGeometry args={[element.dimensions[0], element.dimensions[1] + 0.035, 0.12]} />
          <meshStandardMaterial
            color={color}
            roughness={0.7}
            clippingPlanes={planes}
            clipShadows
            side={sectionActive ? THREE.DoubleSide : THREE.FrontSide}
          />
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
            clippingPlanes={planes}
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

function SamplePlatform() {
  const platform = useRef<THREE.Mesh>(null)
  const direction = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    // Keep the sample ground above and at the horizon, but reveal the structural underside.
    if (platform.current) platform.current.visible = camera.getWorldDirection(direction).y <= 1e-5
  })

  return (
    <mesh ref={platform} position={[0, -0.15, 0]} receiveShadow>
      <boxGeometry args={[10.8, 0.25, 8.8]} />
      <meshStandardMaterial color="#e3e4d9" roughness={0.95} />
    </mesh>
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
            minZoom: number
            maxZoom: number
            update: () => void
          })
        : null
    orbit?.target.set(0, targetY, 0)
    camera.position.set(14, targetY + 12, 16)
    camera.lookAt(0, targetY, 0)
    if (camera instanceof THREE.OrthographicCamera) {
      camera.near = 0.1
      camera.far = 120
      camera.zoom = Math.min(size.width / 15.2, size.height / (floor === 'all' ? 14.8 : 9.5))
      camera.updateProjectionMatrix()
    }
    if (orbit) {
      orbit.minZoom = 13
      orbit.maxZoom = 100
      orbit.update()
    }
  }, [camera, controls, floor, resetKey, size.width, size.height])
  return null
}

export default function BuildingScene({
  elements,
  selectedId,
  onSelect,
  floor,
  resetKey,
  sectionBox,
  onSectionBoxChange,
  sectionBoxSelected,
  onSectionBoxSelect,
  onSectionBoxDeselect,
  directionControl,
  orientationControl,
  onDirectionChange,
}: Props) {
  const visible = filterBuildingElements(elements, floor)
  const base = floor === 'all' ? 0 : (Number.parseInt(floor) - 1) * 3.2
  const sectionTarget = sectionBox?.targetId
  const sectionRanges = sectionBox?.ranges
  const rotationY = sectionBox?.rotationY ?? 0
  const sectionBase = useMemo(
    () => (sectionTarget === undefined ? null : boundsForSample(BUILDING_ELEMENTS, sectionTarget)),
    [sectionTarget],
  )
  const clipBounds = useMemo(
    () => (sectionBase && sectionRanges ? sectionBounds(sectionBase, sectionRanges) : null),
    [sectionBase, sectionRanges],
  )
  const transform = useMemo(
    () => (sectionBase ? sectionTransform(sectionBase, rotationY) : undefined),
    [sectionBase, rotationY],
  )
  const planes = useMemo(
    () => (clipBounds ? clippingPlanes(clipBounds, transform) : []),
    [clipBounds, transform],
  )
  const raycast = useMemo(() => sectionRaycast(clipBounds, transform), [clipBounds, transform])
  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [14, 16.4, 16], zoom: 28, near: 0.1, far: 120 }}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={onSectionBoxDeselect}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true
        gl.domElement.setAttribute('aria-label', '건물 모델 3D 뷰어')
      }}
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
        <SamplePlatform />
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
          sectionActive={clipBounds !== null}
          raycast={raycast}
          planes={planes}
        />
      ))}
      <mesh position={[0, base - 0.285, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial transparent opacity={0.09} />
      </mesh>
      <OrbitControls
        makeDefault
        enableDamping={false}
        target={[0, 4.4, 0]}
        enablePan={Boolean(sectionBox)}
        minZoom={13}
        maxZoom={100}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
      />
      {sectionBase ? (
        <FrameBoxCamera bounds={sectionBase} resetKey={resetKey} />
      ) : (
        <FrameCamera floor={floor} resetKey={resetKey} />
      )}
      <ViewerDirectionCamera
        directionControl={directionControl}
        orientationControl={orientationControl}
        onDirectionChange={onDirectionChange}
      />
      <SectionBoxVisual
        bounds={clipBounds}
        transform={transform}
        rotationY={rotationY}
        selected={sectionBoxSelected}
        onSelect={onSectionBoxSelect}
      />
      {sectionBoxSelected &&
        sectionBase &&
        clipBounds &&
        transform &&
        sectionBox &&
        onSectionBoxChange && (
          <SectionBoxHandles
            baseBounds={sectionBase}
            bounds={clipBounds}
            transform={transform}
            settings={sectionBox}
            onChange={onSectionBoxChange}
          />
        )}
    </Canvas>
  )
}

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { IfcModel } from '../ifc/types'
import {
  boundsForIfc,
  clippingPlanes,
  sectionBounds,
  sectionRaycast,
  sectionTransform,
  type SectionBoxSettings,
} from '../lib/sectionBox'
import { FrameBoxCamera, SectionBoxVisual } from './SectionBox'
import SectionBoxHandles from './SectionBoxHandles'
import ProjectCameraSync from './ProjectCameraSync'
import ViewerDirectionCamera, { type ViewerDirectionProps } from './ViewerDirectionCamera'
import type { ProjectCamera } from '../projects/types'

type Props = ViewerDirectionProps & {
  model: IfcModel
  transparency: number
  visibleIds: string[]
  selectedId: string
  onSelect: (id: string) => void
  resetKey: number
  sectionBox?: SectionBoxSettings | null
  onSectionBoxChange?: (settings: SectionBoxSettings) => void
  sectionBoxSelected?: boolean
  onSectionBoxSelect?: () => void
  onSectionBoxDeselect?: () => void
  cameraRestore?: ProjectCamera | null
  cameraRestoreKey?: number
  onCameraChange?: (pose: ProjectCamera) => void
  cameraCapture?: MutableRefObject<(() => ProjectCamera) | null>
}

type PlacedMesh = {
  elementId: string
  geometry: THREE.BufferGeometry
  matrix: THREE.Matrix4
  bounds: THREE.Box3
  color: [number, number, number, number]
}

const ignoreRaycast = () => undefined
const VIEW_DPR: [number, number] = [1, 1.6]
const MOTION_DPR_SCALE = 0.7
const VIEW_SETTLE_MS = 180

function prepareModel(model: IfcModel) {
  const geometries = new Map<Float32Array, THREE.BufferGeometry>()
  const meshes: PlacedMesh[] = []
  const bounds = new THREE.Box3()

  for (const source of model.meshes) {
    if (source.positions.length < 9 || source.indices.length < 3) continue
    let geometry = geometries.get(source.positions)
    if (!geometry) {
      geometry = new THREE.BufferGeometry()
      // The worker's typed arrays remain untouched so a model can be reopened.
      // Repeated IFC placements share one GPU geometry and keep their own matrix.
      geometry.setAttribute('position', new THREE.BufferAttribute(source.positions, 3))
      geometry.setIndex(new THREE.BufferAttribute(source.indices, 1))
      if (source.normals.length === source.positions.length) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(source.normals, 3))
      } else {
        geometry.computeVertexNormals()
      }
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      geometries.set(source.positions, geometry)
    }
    const matrix = new THREE.Matrix4().fromArray(source.matrix)
    const meshBounds = geometry.boundingBox!.clone().applyMatrix4(matrix)
    if (meshBounds.isEmpty()) continue
    bounds.union(meshBounds)
    meshes.push({
      elementId: source.elementId,
      geometry,
      matrix,
      bounds: meshBounds,
      color: source.color,
    })
  }

  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1))
  const center = bounds.getCenter(new THREE.Vector3())
  const offset = center.clone().negate()
  for (const mesh of meshes) {
    // web-ifc placement matrices produce Y-up, metre world coordinates. Center
    // only the placements, without converting axes or changing source buffers.
    mesh.matrix.elements[12] -= center.x
    mesh.matrix.elements[13] -= center.y
    mesh.matrix.elements[14] -= center.z
    mesh.bounds.translate(offset)
  }
  bounds.translate(offset)
  return { meshes, geometries: [...geometries.values()], bounds }
}

function IfcMesh({
  mesh,
  selected,
  onSelect,
  raycast,
  planes,
  opacityMultiplier,
}: {
  mesh: PlacedMesh
  selected: boolean
  onSelect: Props['onSelect']
  raycast: THREE.Mesh['raycast']
  planes: THREE.Plane[]
  opacityMultiplier: number
}) {
  const [hovered, setHovered] = useState(false)
  const color = useMemo(() => {
    if (selected) return new THREE.Color('#63ab8e')
    const original = new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2])
    return hovered ? original.lerp(new THREE.Color('#e0b46e'), 0.4) : original
  }, [mesh.color, selected, hovered])
  const baseOpacity = selected ? 0.85 : THREE.MathUtils.clamp(mesh.color[3], 0, 1)
  const opacity = baseOpacity * opacityMultiplier
  const transparent = opacity < 1
  const material = useRef<THREE.MeshStandardMaterial>(null)
  useLayoutEffect(() => {
    // Three uses different shader variants for opaque and translucent surfaces.
    if (material.current) material.current.needsUpdate = true
  }, [transparent])
  useEffect(() => setHovered(false), [planes])

  useEffect(() => {
    if (!hovered) return
    document.body.style.cursor = 'pointer'
    return () => {
      document.body.style.cursor = ''
    }
  }, [hovered])

  return (
    <mesh
      geometry={mesh.geometry}
      matrix={mesh.matrix}
      matrixAutoUpdate={false}
      raycast={raycast}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        onSelect(mesh.elementId)
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
    >
      <meshStandardMaterial
        ref={material}
        color={color}
        opacity={opacity}
        visible={opacity > 0}
        transparent={transparent}
        depthWrite={!transparent}
        side={THREE.DoubleSide}
        roughness={0.76}
        metalness={0.02}
        polygonOffset={selected}
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
        clippingPlanes={planes}
        clipShadows
      />
      {selected && (
        <Edges
          geometry={mesh.geometry}
          threshold={28}
          color="#1d7050"
          transparent
          opacity={0.95}
          depthTest={false}
          raycast={ignoreRaycast}
          clippingPlanes={planes}
        />
      )}
    </mesh>
  )
}

const ModelContents = memo(function ModelContents({
  model,
  transparency,
  visibleIds,
  selectedId,
  onSelect,
  resetKey,
  sectionBox,
  onSectionBoxChange,
  sectionBoxSelected,
  onSectionBoxSelect,
  cameraRestore,
  cameraRestoreKey,
  onCameraChange,
  cameraCapture,
  directionControl,
  onDirectionChange,
}: Props) {
  const opacityMultiplier = 1 - transparency / 100
  const prepared = useMemo(() => prepareModel(model), [model])
  const visibilityKey = visibleIds.join('\u0000')
  const visible = useMemo(() => {
    const ids = new Set(visibilityKey.split('\u0000'))
    return prepared.meshes.filter((mesh) => ids.has(mesh.elementId))
  }, [prepared, visibilityKey])
  const visibleBounds = useMemo(() => {
    const bounds = new THREE.Box3()
    for (const mesh of visible) bounds.union(mesh.bounds)
    return bounds.isEmpty() ? prepared.bounds : bounds
  }, [prepared, visible])
  const sectionTarget = sectionBox?.targetId
  const sectionRanges = sectionBox?.ranges
  const rotationY = sectionBox?.rotationY ?? 0
  const sectionBase = useMemo(
    () =>
      sectionTarget === undefined
        ? null
        : boundsForIfc(prepared.meshes, prepared.bounds, sectionTarget),
    [prepared, sectionTarget],
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
  const ground = useMemo(() => {
    const extent = prepared.bounds.getSize(new THREE.Vector3())
    const size = Math.max(extent.x, extent.z, extent.y * 0.2, 0.1) * 1.35
    return { size, y: prepared.bounds.min.y - size * 0.002 }
  }, [prepared])

  useEffect(
    () => () => {
      // Only these viewer-owned Three objects are disposed. Source IFC arrays
      // are retained by the dashboard for switching between 3D and data views.
      for (const geometry of prepared.geometries) geometry.dispose()
    },
    [prepared],
  )

  return (
    <>
      <gridHelper
        args={[ground.size, 12, '#c8d1c4', '#dce2d6']}
        position={[0, ground.y, 0]}
        raycast={ignoreRaycast}
      />
      {visible.map((mesh, index) => (
        <IfcMesh
          key={`${mesh.elementId}-${index}`}
          mesh={mesh}
          selected={selectedId === mesh.elementId}
          onSelect={onSelect}
          raycast={raycast}
          planes={planes}
          opacityMultiplier={opacityMultiplier}
        />
      ))}
      <FrameBoxCamera bounds={sectionBase ?? visibleBounds} resetKey={resetKey} />
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
      {onCameraChange && cameraCapture && (
        <ProjectCameraSync
          restore={cameraRestore ?? null}
          restoreKey={cameraRestoreKey ?? 0}
          onChange={onCameraChange}
          captureRef={cameraCapture}
        />
      )}
      <ViewerDirectionCamera
        directionControl={directionControl}
        onDirectionChange={onDirectionChange}
      />
    </>
  )
})

export default function IfcScene(props: Props) {
  const [viewMoving, setViewMoving] = useState(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canReduceResolution = props.transparency > 0 && props.transparency < 100
  const handleViewChange = useCallback(() => {
    if (!canReduceResolution) return
    if (settleTimer.current === null) setViewMoving(true)
    else clearTimeout(settleTimer.current)
    // Keep the lower resolution between consecutive camera updates.
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null
      setViewMoving(false)
    }, VIEW_SETTLE_MS)
  }, [canReduceResolution])
  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current)
      settleTimer.current = null
    },
    [],
  )
  const dpr =
    canReduceResolution && viewMoving
      ? THREE.MathUtils.clamp(window.devicePixelRatio, ...VIEW_DPR) * MOTION_DPR_SCALE
      : VIEW_DPR

  return (
    <Canvas
      orthographic
      dpr={dpr}
      camera={{ position: [10, 10, 10], zoom: 1, near: 0.001, far: 1000 }}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={props.onSectionBoxDeselect}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true
        gl.domElement.setAttribute('aria-label', 'IFC 모델 3D 뷰어')
      }}
    >
      <color attach="background" args={['#f0f3ef']} />
      <ambientLight intensity={1.25} />
      <hemisphereLight args={['#fff8e8', '#b0beb3', 1.25]} />
      <directionalLight position={[10, 20, 8]} intensity={2.1} />
      <directionalLight position={[-10, 5, -12]} intensity={0.65} />
      <OrbitControls
        makeDefault
        enablePan
        enableDamping={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI * 0.98}
        onChange={handleViewChange}
      />
      <ModelContents {...props} />
    </Canvas>
  )
}

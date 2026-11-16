import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { SectionBoxSettings } from '../lib/sectionBox'
import {
  dragSectionPercent,
  projectSectionAxis,
  separateSectionHandles,
  setSectionFace,
  type SectionAxis,
  type SectionDragProjection,
} from '../lib/sectionBoxDrag'
import './section-box-handles.css'

type Props = {
  baseBounds: THREE.Box3
  bounds: THREE.Box3
  settings: SectionBoxSettings
  onChange: (next: SectionBoxSettings) => void
}
type Orbit = { enabled: boolean }
type Drag = {
  pointerId: number
  button: HTMLButtonElement
  axis: SectionAxis
  side: 0 | 1
  startX: number
  startY: number
  startValue: number
  projection: SectionDragProjection
  controls: Orbit | null
  previousEnabled: boolean
  hadCursorClass: boolean
}
type Face = { axis: SectionAxis; side: 0 | 1 }
type ScreenFace = {
  x: number
  y: number
  anchorX: number
  anchorY: number
  angle: number
  fallback: boolean
}
type HandleLayout = (camera: THREE.Camera, width: number, height: number) => Map<string, ScreenFace>
const axes: SectionAxis[] = ['x', 'y', 'z']
const faces: Face[] = axes.flatMap((axis) => [
  { axis, side: 0 as const },
  { axis, side: 1 as const },
])
const axisColors = { x: '#b37456', y: '#39826d', z: '#507fa6' }
const dragCursorClass = 'section-handle-dragging'

export default function SectionBoxHandles({ baseBounds, bounds, settings, onChange }: Props) {
  const { camera, controls, size } = useThree()
  const current = useRef({ settings, onChange })
  current.current = { settings, onChange }
  const drag = useRef<Drag | null>(null)
  const [activeFace, setActiveFace] = useState<string | null>(null)
  const layoutCache = useRef<{ key: string; positions: Map<string, ScreenFace> } | null>(null)
  const layout: HandleLayout = useCallback(
    (viewCamera, width, height) => {
      const key = [
        ...viewCamera.matrixWorld.elements,
        ...viewCamera.projectionMatrix.elements,
        ...baseBounds.min.toArray(),
        ...baseBounds.max.toArray(),
        ...bounds.min.toArray(),
        ...bounds.max.toArray(),
        width,
        height,
      ].join(',')
      if (layoutCache.current?.key === key) return layoutCache.current.positions
      const projected = faces.map((face) => {
        const world = bounds.getCenter(new THREE.Vector3())
        world[face.axis] = face.side === 0 ? bounds.min[face.axis] : bounds.max[face.axis]
        const point = world.clone().project(viewCamera)
        const axis = projectSectionAxis(
          viewCamera,
          world,
          face.axis,
          baseBounds.max[face.axis] - baseBounds.min[face.axis],
          width,
          height,
        )
        const sign = face.side === 0 ? -1 : 1
        const length = Math.hypot(axis.x, axis.y) || 1
        const dx = (axis.x / length) * sign
        const dy = (axis.y / length) * sign
        const anchorX = (point.x * 0.5 + 0.5) * width
        const anchorY = (-point.y * 0.5 + 0.5) * height
        return {
          id: `${face.axis}-${face.side}`,
          x: anchorX + dx * 23,
          y: anchorY + dy * 23,
          anchorX,
          anchorY,
          angle: Math.atan2(dy, dx),
          fallback: axis.fallback,
        }
      })
      // A shared layout keeps nearby/back faces individually reachable after
      // orbiting. This clears both 42px touch targets and their lower labels,
      // including diagonally adjacent handles.
      const separated = separateSectionHandles(projected, width, height, 68)
      const positions = new Map(
        separated.map((point, index) => [
          point.id,
          { ...projected[index], x: point.x, y: point.y },
        ]),
      )
      layoutCache.current = { key, positions }
      return positions
    },
    [baseBounds, bounds],
  )

  const finish = useCallback((notify = true) => {
    const previous = drag.current
    if (!previous) return
    // Clear first: releasePointerCapture can synchronously dispatch lostcapture.
    drag.current = null
    if (previous.controls) previous.controls.enabled = previous.previousEnabled
    if (!previous.hadCursorClass) document.body.classList.remove(dragCursorClass)
    try {
      if (previous.button.hasPointerCapture(previous.pointerId))
        previous.button.releasePointerCapture(previous.pointerId)
    } catch {
      // The overlay can have been removed by changing view/model while dragging.
    }
    if (notify) setActiveFace(null)
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = drag.current
      if (!active || event.pointerId !== active.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const value = dragSectionPercent(
        active.startValue,
        event.clientX - active.startX,
        event.clientY - active.startY,
        active.projection,
      )
      const latest = current.current
      const next = setSectionFace(latest.settings, active.axis, active.side, value)
      if (
        next.ranges[active.axis][active.side] !== latest.settings.ranges[active.axis][active.side]
      )
        latest.onChange(next)
    }
    const end = (event: PointerEvent) => {
      if (event.pointerId !== drag.current?.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      finish()
    }
    const blur = () => finish()
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return
      event.preventDefault()
      event.stopPropagation()
      finish()
    }
    window.addEventListener('pointermove', move, { capture: true, passive: false })
    window.addEventListener('pointerup', end, { capture: true, passive: false })
    window.addEventListener('pointercancel', end, { capture: true, passive: false })
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', key, true)
    return () => {
      finish(false)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('keydown', key, true)
    }
  }, [baseBounds, controls, finish])

  const start = (
    event: ReactPointerEvent<HTMLButtonElement>,
    face: Face,
    origin: THREE.Vector3,
  ) => {
    event.stopPropagation()
    if (drag.current || !event.isPrimary || event.button !== 0) return
    event.preventDefault()
    camera.updateMatrixWorld(true)
    const orbit = controls && 'enabled' in controls ? (controls as Orbit) : null
    const previousEnabled = orbit?.enabled ?? false
    if (orbit) orbit.enabled = false
    const button = event.currentTarget
    const hadCursorClass = document.body.classList.contains(dragCursorClass)
    document.body.classList.add(dragCursorClass)
    drag.current = {
      pointerId: event.pointerId,
      button,
      ...face,
      startX: event.clientX,
      startY: event.clientY,
      startValue: current.current.settings.ranges[face.axis][face.side],
      projection: projectSectionAxis(
        camera,
        origin,
        face.axis,
        baseBounds.max[face.axis] - baseBounds.min[face.axis],
        size.width,
        size.height,
      ),
      controls: orbit,
      previousEnabled,
      hadCursorClass,
    }
    setActiveFace(`${face.axis}-${face.side}`)
    button.focus({ preventScroll: true })
    try {
      button.setPointerCapture(event.pointerId)
    } catch {
      // Window capture listeners still finish the interaction if capture is unavailable.
    }
  }

  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, face: Face) => {
    const direction =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    event.stopPropagation()
    if (drag.current) return
    const latest = current.current
    const value =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 100
          : latest.settings.ranges[face.axis][face.side] + direction * (event.shiftKey ? 10 : 1)
    latest.onChange(setSectionFace(latest.settings, face.axis, face.side, value))
  }

  return (
    <>
      {faces.map((face) => (
        <FaceHandle
          key={`${face.axis}-${face.side}`}
          face={face}
          bounds={bounds}
          layout={layout}
          value={settings.ranges[face.axis][face.side]}
          active={activeFace === `${face.axis}-${face.side}`}
          onStart={start}
          onKey={keyboard}
          onFinish={(event) => {
            if (event.pointerId === drag.current?.pointerId) finish()
          }}
        />
      ))}
    </>
  )
}

function FaceHandle({
  face,
  bounds,
  layout,
  value,
  active,
  onStart,
  onKey,
  onFinish,
}: {
  face: Face
  bounds: THREE.Box3
  layout: HandleLayout
  value: number
  active: boolean
  onStart: (event: ReactPointerEvent<HTMLButtonElement>, face: Face, origin: THREE.Vector3) => void
  onKey: (event: KeyboardEvent<HTMLButtonElement>, face: Face) => void
  onFinish: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const arrow = useRef<SVGSVGElement>(null)
  const connector = useRef<SVGLineElement>(null)
  const helpId = useId()
  const origin = bounds.getCenter(new THREE.Vector3())
  origin[face.axis] = face.side === 0 ? bounds.min[face.axis] : bounds.max[face.axis]
  const caption = `${face.axis.toUpperCase()} ${face.side === 0 ? '최소' : '최대'}`

  return (
    <Html
      position={origin.toArray()}
      center
      zIndexRange={[30, 30]}
      style={{ pointerEvents: 'none' }}
      calculatePosition={(_object, camera, size) => {
        const position = layout(camera, size.width, size.height).get(`${face.axis}-${face.side}`)!
        if (arrow.current) arrow.current.style.transform = `rotate(${position.angle}rad)`
        if (button.current)
          button.current.title = `${caption} 면 드래그 · ${value}%${position.fallback ? ' · 이 방향에서는 위아래로 드래그하세요.' : ''}`
        if (connector.current) {
          connector.current.setAttribute('x2', String(position.anchorX - position.x))
          connector.current.setAttribute('y2', String(position.anchorY - position.y))
        }
        return [position.x, position.y]
      }}
    >
      <div
        className="section-face-position"
        style={{ '--section-axis-color': axisColors[face.axis] } as CSSProperties}
      >
        <svg className="section-face-connector" width="1" height="1" aria-hidden="true">
          <line ref={connector} x1="0" y1="0" x2="0" y2="0" />
        </svg>
        <button
          ref={button}
          type="button"
          className="section-face-handle"
          style={{ '--section-axis-color': axisColors[face.axis] } as CSSProperties}
          data-dragging={active ? 'true' : undefined}
          aria-label={`${caption} 단면 이동`}
          aria-describedby={helpId}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End"
          onPointerDown={(event) => onStart(event, face, origin)}
          onLostPointerCapture={onFinish}
          onKeyDown={(event) => onKey(event, face)}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <svg ref={arrow} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12h15M13 5l7 7-7 7" />
          </svg>
          <span className="section-face-label" aria-hidden="true">
            {face.axis.toUpperCase()}
            {face.side === 0 ? '−' : '+'}
          </span>
          <span className="section-face-value" aria-hidden="true">
            {value}%
          </span>
          <span id={helpId} className="sr-only">
            현재 {value}%. 드래그하거나 방향키로 1%씩, Shift와 방향키로 10%씩 조절합니다. Home과
            End는 허용 범위의 양 끝으로 이동합니다.
          </span>
        </button>
      </div>
    </Html>
  )
}

import * as THREE from 'three'
import type { SectionBoxSettings } from './sectionBox'

export type SectionAxis = 'x' | 'y' | 'z'
export type SectionDragProjection = { x: number; y: number; fallback: boolean }
export type SectionHandlePoint = { id: string; x: number; y: number }
type SectionViewport = { left: number; top: number; width: number; height: number }

/** Keep screen-sized face handles apart, including when an axis is edge-on.
 * The final bounded search is only needed when repulsion pins a cluster against
 * a viewport corner. Inputs and their order remain untouched.
 */
export function separateSectionHandles(
  points: readonly SectionHandlePoint[],
  width: number,
  height: number,
  minimumDistance = 60,
): SectionHandlePoint[] {
  const viewportWidth = Number.isFinite(width) && width > 0 ? width : 48
  const viewportHeight = Number.isFinite(height) && height > 0 ? height : 60
  const minX = Math.min(24, viewportWidth / 2)
  const maxX = Math.max(minX, viewportWidth - 24)
  const minY = Math.min(24, viewportHeight / 2)
  const maxY = Math.max(minY, viewportHeight - 36)
  const gap = Number.isFinite(minimumDistance) && minimumDistance > 0 ? minimumDistance : 60
  const clamp = (point: SectionHandlePoint): SectionHandlePoint => ({
    id: point.id,
    x: THREE.MathUtils.clamp(Number.isFinite(point.x) ? point.x : minX, minX, maxX),
    y: THREE.MathUtils.clamp(Number.isFinite(point.y) ? point.y : minY, minY, maxY),
  })
  const desired = points.map(clamp)
  const result = desired.map((point) => ({ ...point }))
  const distance = (a: SectionHandlePoint, b: SectionHandlePoint) =>
    Math.hypot(a.x - b.x, a.y - b.y)
  const separated = (items: SectionHandlePoint[]) =>
    items.every((point, index) =>
      items.slice(index + 1).every((other) => distance(point, other) >= gap - 0.01),
    )
  if (separated(result)) return result

  for (let iteration = 0; iteration < 200; iteration++) {
    for (let index = 0; index < result.length; index++) {
      for (let next = index + 1; next < result.length; next++) {
        const a = result[index]
        const b = result[next]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let length = Math.hypot(dx, dy)
        if (length >= gap) continue
        if (length < 0.0001) {
          const angle = ((index + 1) * 2.399963229728653 + next) % (Math.PI * 2)
          dx = Math.cos(angle)
          dy = Math.sin(angle)
          length = 1
        }
        const movement = (gap - Math.min(length, gap)) / 2 + 0.02
        a.x = THREE.MathUtils.clamp(a.x - (dx / length) * movement, minX, maxX)
        a.y = THREE.MathUtils.clamp(a.y - (dy / length) * movement, minY, maxY)
        b.x = THREE.MathUtils.clamp(b.x + (dx / length) * movement, minX, maxX)
        b.y = THREE.MathUtils.clamp(b.y + (dy / length) * movement, minY, maxY)
      }
    }
    if (separated(result)) return result
  }

  // Six handles fit comfortably at the supported mobile viewport sizes. A
  // deterministic grid also resolves difficult corner clusters without jitter
  // from random starting directions or unbounded solver iterations.
  const placed: SectionHandlePoint[] = []
  const step = Math.max(4, gap / 6)
  const columns = Math.max(1, Math.ceil((maxX - minX) / step))
  const rows = Math.max(1, Math.ceil((maxY - minY) / step))
  for (const point of desired) {
    const valid = (candidate: SectionHandlePoint) =>
      placed.every((other) => distance(candidate, other) >= gap)
    if (valid(point)) {
      placed.push({ ...point })
      continue
    }
    let best: SectionHandlePoint | undefined
    let bestDistance = Infinity
    for (let column = 0; column <= columns; column++) {
      for (let row = 0; row <= rows; row++) {
        const candidate = {
          id: point.id,
          x: minX + ((maxX - minX) * column) / columns,
          y: minY + ((maxY - minY) * row) / rows,
        }
        const displacement = distance(candidate, point)
        if (displacement < bestDistance && valid(candidate)) {
          best = candidate
          bestDistance = displacement
        }
      }
    }
    placed.push(best ?? { ...result[placed.length] })
  }
  return placed
}

/** Screen-pixel displacement for one full base-box extent along an axis.
 * Positive screen Y points downward, as it does in native pointer events.
 */
export function projectSectionAxis(
  camera: THREE.Camera,
  origin: THREE.Vector3,
  axis: SectionAxis,
  extent: number,
  width: number,
  height: number,
  transform?: THREE.Matrix4,
): SectionDragProjection {
  const fallback = (): SectionDragProjection => ({
    x: 0,
    y: -Math.max(80, Number.isFinite(height) && height > 0 ? height * 0.5 : 80),
    fallback: true,
  })
  if (
    !Number.isFinite(extent) ||
    extent <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return fallback()
  const from = origin.clone()
  const to = origin.clone()
  to[axis] += extent
  if (transform) {
    from.applyMatrix4(transform)
    to.applyMatrix4(transform)
  }
  from.project(camera)
  to.project(camera)
  const x = ((to.x - from.x) * width) / 2
  const y = (-(to.y - from.y) * height) / 2
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 12) return fallback()
  return { x, y, fallback: false }
}

/** Pointer motion perpendicular to the projected axis does not move its face. */
export function dragSectionPercent(
  startValue: number,
  deltaX: number,
  deltaY: number,
  projection: SectionDragProjection,
): number {
  const start = Number.isFinite(startValue) ? startValue : 0
  const lengthSquared = projection.x ** 2 + projection.y ** 2
  if (
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    !Number.isFinite(lengthSquared) ||
    lengthSquared < Number.EPSILON
  )
    return start
  const next = start + (100 * (deltaX * projection.x + deltaY * projection.y)) / lengthSquared
  return Number.isFinite(next) ? next : start
}

/** Track angular changes in the box's horizontal plane using the camera at drag start. */
export function projectSectionRotation(
  camera: THREE.Camera,
  pivot: THREE.Vector3,
  { left, top, width, height }: SectionViewport,
  startX: number,
  startY: number,
): (clientX: number, clientY: number) => number {
  let delta = 0
  const horizontalDrag = (clientX: number) => {
    const next = clientX - startX
    if (Number.isFinite(next)) delta = next
    return delta
  }
  if (
    !(camera instanceof THREE.OrthographicCamera || camera instanceof THREE.PerspectiveCamera) ||
    ![left, top, width, height, pivot.x, pivot.y, pivot.z, startX, startY].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    return horizontalDrag

  const view = camera.clone()
  const projected = pivot.clone().project(view)
  const centerX = left + ((projected.x + 1) * width) / 2
  const centerY = top + ((1 - projected.y) * height) / 2
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return horizontalDrag

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -pivot.y)
  const { x: pivotX, z: pivotZ } = pivot
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const hit = new THREE.Vector3()
  const angleAt = (clientX: number, clientY: number) => {
    if (
      !Number.isFinite(clientX) ||
      !Number.isFinite(clientY) ||
      Math.hypot(clientX - centerX, clientY - centerY) < 10
    )
      return null
    pointer.set(((clientX - left) * 2) / width - 1, 1 - ((clientY - top) * 2) / height)
    raycaster.setFromCamera(pointer, view)
    if (Math.abs(raycaster.ray.direction.y) < 0.12 || !raycaster.ray.intersectPlane(plane, hit))
      return null
    const dx = hit.x - pivotX
    const dz = pivotZ - hit.z
    return Number.isFinite(dx) && Number.isFinite(dz) ? Math.atan2(dz, dx) : null
  }
  const initial = angleAt(startX, startY)
  if (initial === null || !Number.isFinite(initial)) return horizontalDrag

  let previous = initial
  return (clientX, clientY) => {
    const angle = angleAt(clientX, clientY)
    if (angle === null || !Number.isFinite(angle)) return delta
    // Use the shortest signed step so crossing ±180° never reverses the drag.
    const step = angle - previous
    delta += THREE.MathUtils.radToDeg(Math.atan2(Math.sin(step), Math.cos(step)))
    previous = angle
    return delta
  }
}

export function normalizeSectionRotation(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  const rounded = Math.round(angle) % 360
  if (rounded > 180) return rounded - 360
  if (rounded < -180) return rounded + 360
  return rounded || 0
}

/** Keep one-percent separation so neither drag nor keyboard input inverts a box. */
export function setSectionFace(
  settings: SectionBoxSettings,
  axis: SectionAxis,
  side: 0 | 1,
  value: number,
): SectionBoxSettings {
  const previous = settings.ranges[axis]
  let minimum = THREE.MathUtils.clamp(
    Number.isFinite(previous[0]) ? Math.round(previous[0]) : 0,
    0,
    99,
  )
  let maximum = THREE.MathUtils.clamp(
    Number.isFinite(previous[1]) ? Math.round(previous[1]) : 100,
    1,
    100,
  )
  if (minimum >= maximum) maximum = minimum + 1
  const next = Number.isFinite(value) ? Math.round(value) : side === 0 ? minimum : maximum
  if (side === 0) minimum = THREE.MathUtils.clamp(next, 0, maximum - 1)
  else maximum = THREE.MathUtils.clamp(next, minimum + 1, 100)
  return { ...settings, ranges: { ...settings.ranges, [axis]: [minimum, maximum] } }
}

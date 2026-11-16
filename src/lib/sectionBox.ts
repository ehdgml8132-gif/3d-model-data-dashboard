import * as THREE from 'three'
import type { BuildingElement } from '../data/building'

export type SectionBoxSettings = {
  /** The selection captured when the section box was enabled; null means the whole model. */
  targetId: string | null
  /** Position of the six faces as percentages of the initial enclosing box. */
  ranges: { x: [number, number]; y: [number, number]; z: [number, number] }
}

function paddedBounds(source: THREE.Box3, selected: boolean) {
  const bounds = source.clone()
  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1))
  const size = bounds.getSize(new THREE.Vector3())
  const extent = Math.max(size.x, size.y, size.z, 0.01)
  // A small margin keeps thin/planar members visible without clipping their own
  // boundary faces. Selection padding also preserves a little spatial context.
  const margin = new THREE.Vector3(
    Math.max(size.x * (selected ? 0.12 : 0.001), extent * 0.002, 0.001),
    Math.max(size.y * (selected ? 0.12 : 0.001), extent * 0.002, 0.001),
    Math.max(size.z * (selected ? 0.12 : 0.001), extent * 0.002, 0.001),
  )
  return bounds.expandByVector(margin)
}

export function boundsForSample(elements: BuildingElement[], targetId: string | null) {
  const selected = targetId ? elements.filter((element) => element.id === targetId) : []
  const targets = selected.length ? selected : elements
  const bounds = new THREE.Box3()
  for (const element of targets) {
    bounds.union(
      new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(...element.position),
        new THREE.Vector3(...element.dimensions),
      ),
    )
  }
  return paddedBounds(bounds, selected.length > 0)
}

/** IFC bounds are already in the viewer's centered, transformed metre coordinates. */
export function boundsForIfc(
  meshes: { elementId: string; bounds: THREE.Box3 }[],
  fullBounds: THREE.Box3,
  targetId: string | null,
) {
  const selected = new THREE.Box3()
  if (targetId)
    for (const mesh of meshes) if (mesh.elementId === targetId) selected.union(mesh.bounds)
  return paddedBounds(selected.isEmpty() ? fullBounds : selected, !selected.isEmpty())
}

export function sectionBounds(base: THREE.Box3, ranges: SectionBoxSettings['ranges']) {
  const result = base.clone()
  for (const axis of ['x', 'y', 'z'] as const) {
    const [from, to] = ranges[axis]
    let minimum = THREE.MathUtils.clamp(Number.isFinite(from) ? from : 0, 0, 100)
    let maximum = THREE.MathUtils.clamp(Number.isFinite(to) ? to : 100, 0, 100)
    if (minimum >= maximum) {
      minimum = Math.min(minimum, 99)
      maximum = minimum + 1
    }
    const extent = base.max[axis] - base.min[axis]
    result.min[axis] = base.min[axis] + (extent * minimum) / 100
    result.max[axis] = base.min[axis] + (extent * maximum) / 100
  }
  return result
}

/** Three clips negative plane distances, so all six positive halfspaces are retained. */
export function clippingPlanes(bounds: THREE.Box3) {
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -bounds.min.x),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), bounds.max.x),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -bounds.min.y),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), bounds.max.y),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -bounds.min.z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), bounds.max.z),
  ]
}

/** Filter before R3F dispatches pointer events: clipped foreground faces must
 * never stop a click that belongs to a visible member farther along the ray. */
export function sectionRaycast(bounds: THREE.Box3 | null): THREE.Mesh['raycast'] {
  return function (this: THREE.Mesh, raycaster, intersections) {
    const start = intersections.length
    THREE.Mesh.prototype.raycast.call(this, raycaster, intersections)
    if (bounds)
      for (let index = intersections.length - 1; index >= start; index--)
        if (!bounds.containsPoint(intersections[index].point)) intersections.splice(index, 1)
  }
}

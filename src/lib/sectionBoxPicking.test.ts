import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createSectionBoxRaycast } from './sectionBoxPicking'

const width = 1000
const height = 800

function camera(zoom = 1) {
  const view = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 100)
  view.position.set(0, 0, 10)
  view.lookAt(0, 0, 0)
  view.zoom = zoom
  view.updateProjectionMatrix()
  view.updateMatrixWorld(true)
  return view
}

function pixelPoint(view: THREE.Camera, world: THREE.Vector3) {
  const point = world.clone().project(view)
  return { x: ((point.x + 1) * width) / 2, y: ((1 - point.y) * height) / 2 }
}

function pick(helper: THREE.Box3Helper, view: THREE.Camera, point: { x: number; y: number }) {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(
    new THREE.Vector2((point.x / width) * 2 - 1, 1 - (point.y / height) * 2),
    view,
  )
  return raycaster.intersectObject(helper, false)
}

function helper(bounds: THREE.Box3, view: THREE.Camera) {
  const box = new THREE.Box3Helper(bounds)
  box.updateMatrixWorld(true)
  box.raycast = createSectionBoxRaycast(bounds, view, width, height)
  return box
}

describe('screen-space section box selection', () => {
  it('selects a real edge but leaves the face interior available for model clicks', () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
    const view = camera()
    const box = helper(bounds, view)
    const edge = pixelPoint(view, new THREE.Vector3(-1, 0, 1))
    expect(pick(box, view, edge)).toHaveLength(1)
    expect(pick(box, view, pixelPoint(view, new THREE.Vector3(0, 0, 1)))).toEqual([])
    expect(pick(box, view, { x: edge.x - 8, y: edge.y })).toHaveLength(1)
    expect(pick(box, view, { x: edge.x - 11, y: edge.y })).toEqual([])
  })

  it.each([
    [0.001, 1000],
    [1, 1],
    [1000, 0.001],
  ])('keeps a nine-pixel hit width for model scale %s and zoom %s', (scale, zoom) => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-scale, -scale, -scale),
      new THREE.Vector3(scale, scale, scale),
    )
    const view = camera(zoom)
    view.position.z = Math.max(10, scale * 10)
    view.far = Math.max(100, scale * 100)
    view.updateProjectionMatrix()
    view.updateMatrixWorld(true)
    const box = helper(bounds, view)
    const edge = pixelPoint(view, new THREE.Vector3(-scale, 0, scale))
    expect(pick(box, view, { x: edge.x - 8, y: edge.y })).toHaveLength(1)
    expect(pick(box, view, { x: edge.x - 11, y: edge.y })).toEqual([])
  })

  it('prioritizes an occluded back edge while returning a point on its real geometry', () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
    const view = camera()
    view.position.set(8, 5, 12)
    view.lookAt(0, 0, 0)
    view.updateMatrixWorld(true)
    const box = helper(bounds, view)
    const backEdge = new THREE.Vector3(0, 1, -1)
    const hit = pick(box, view, pixelPoint(view, backEdge))[0]
    expect(hit.distance).toBe(0)
    expect(hit.point.distanceTo(backEdge)).toBeLessThan(1e-8)
    expect(hit.object).toBe(box)
  })

  it('does not apply Box3Helper placement and scale twice for an offset building', () => {
    const bounds = new THREE.Box3(new THREE.Vector3(19, 29, -1), new THREE.Vector3(21, 31, 1))
    const view = camera()
    view.position.set(20, 30, 10)
    view.lookAt(20, 30, 0)
    view.updateMatrixWorld(true)
    const box = helper(bounds, view)
    expect(box.position.toArray()).toEqual([20, 30, 0])
    const edge = new THREE.Vector3(19, 30, 1)
    expect(pick(box, view, pixelPoint(view, edge))).toHaveLength(1)
    expect(pick(box, view, pixelPoint(view, new THREE.Vector3(20, 30, 1)))).toEqual([])
  })

  it('supports perspective picking without mutating the box, ray or camera', () => {
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
    const view = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
    view.position.set(6, 4, 10)
    view.lookAt(0, 0, 0)
    view.updateProjectionMatrix()
    view.updateMatrixWorld(true)
    const originalBounds = bounds.clone()
    const originalMatrix = view.matrixWorld.clone()
    const box = helper(bounds, view)
    const edge = new THREE.Vector3(0.3, 1, -1)
    const hit = pick(box, view, pixelPoint(view, edge))[0]
    expect(hit.point.distanceTo(edge)).toBeLessThan(1e-8)
    expect(bounds.equals(originalBounds)).toBe(true)
    expect(view.matrixWorld.equals(originalMatrix)).toBe(true)
  })

  it('ignores empty, invalid, behind-camera and off-viewport targets', () => {
    const view = camera()
    expect(pick(helper(new THREE.Box3(), view), view, { x: 500, y: 400 })).toEqual([])
    const behind = new THREE.Box3(new THREE.Vector3(-1, -1, 15), new THREE.Vector3(1, 1, 17))
    expect(pick(helper(behind, view), view, { x: 400, y: 400 })).toEqual([])
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
    const box = helper(bounds, view)
    box.raycast = createSectionBoxRaycast(bounds, view, NaN, height)
    expect(pick(box, view, { x: 400, y: 400 })).toEqual([])
    expect(pick(helper(bounds, view), view, { x: -20, y: 400 })).toEqual([])
  })
})

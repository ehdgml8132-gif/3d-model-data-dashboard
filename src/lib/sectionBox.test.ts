import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BUILDING_ELEMENTS, type BuildingElement } from '../data/building'
import {
  boundsForIfc,
  boundsForSample,
  clippingPlanes,
  sectionBounds,
  sectionRaycast,
} from './sectionBox'

const box = (min: [number, number, number], max: [number, number, number]) =>
  new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max))

describe('section box bounds', () => {
  it('encloses the entire sample when nothing is selected', () => {
    const bounds = boundsForSample(BUILDING_ELEMENTS, null)
    for (const element of BUILDING_ELEMENTS) {
      const center = new THREE.Vector3(...element.position)
      const size = new THREE.Vector3(...element.dimensions)
      expect(bounds.containsBox(new THREE.Box3().setFromCenterAndSize(center, size))).toBe(true)
    }
    expect(bounds.getSize(new THREE.Vector3()).y).toBeGreaterThanOrEqual(9.6)
  })

  it('frames a selected thin member with enough thickness to adjust its section', () => {
    const member: BuildingElement = {
      ...BUILDING_ELEMENTS[0],
      id: 'thin-member',
      position: [30, 15, -20],
      dimensions: [2, 0, 4],
    }
    const bounds = boundsForSample([...BUILDING_ELEMENTS, member], member.id)
    expect(bounds.containsPoint(new THREE.Vector3(29, 15, -22))).toBe(true)
    expect(bounds.containsPoint(new THREE.Vector3(31, 15, -18))).toBe(true)
    expect(bounds.getSize(new THREE.Vector3()).y).toBeGreaterThan(0)
    expect(bounds.getCenter(new THREE.Vector3()).toArray()).toEqual(member.position)
    expect(bounds.containsPoint(new THREE.Vector3(...BUILDING_ELEMENTS[0].position))).toBe(false)
  })

  it('unions every placed mesh of an IFC member in the same centered world space', () => {
    const first = box([-3, -1, -2], [-2, 1, 0])
    const second = box([1, 2, 3], [2, 4, 5])
    const elsewhere = box([50, 50, 50], [60, 60, 60])
    const full = first.clone().union(second).union(elsewhere)
    const original = full.clone()
    const bounds = boundsForIfc(
      [
        { elementId: 'chosen', bounds: first },
        { elementId: 'chosen', bounds: second },
        { elementId: 'other', bounds: elsewhere },
      ],
      full,
      'chosen',
    )
    expect(bounds.containsBox(first)).toBe(true)
    expect(bounds.containsBox(second)).toBe(true)
    expect(bounds.intersectsBox(elsewhere)).toBe(false)
    expect(full.equals(original)).toBe(true)
    expect(first.equals(box([-3, -1, -2], [-2, 1, 0]))).toBe(true)
  })

  it('uses the complete IFC bounds for an unselected or missing target', () => {
    const full = box([-10, -5, -3], [15, 30, 8])
    const meshes = [{ elementId: 'one', bounds: box([0, 0, 0], [1, 1, 1]) }]
    expect(boundsForIfc(meshes, full, null).containsBox(full)).toBe(true)
    expect(boundsForIfc(meshes, full, 'missing').containsBox(full)).toBe(true)
  })

  it('maps independent percentage ranges to world coordinates without changing the base', () => {
    const base = box([-10, 0, 100], [10, 20, 140])
    const clipped = sectionBounds(base, { x: [25, 75], y: [50, 100], z: [0, 25] })
    expect(clipped.min.toArray()).toEqual([-5, 10, 100])
    expect(clipped.max.toArray()).toEqual([5, 20, 110])
    expect(base.min.toArray()).toEqual([-10, 0, 100])
    expect(base.max.toArray()).toEqual([10, 20, 140])
  })
})

describe('section clipping and picking', () => {
  it('keeps the inside and excludes points beyond each of the six faces', () => {
    const bounds = box([-1, -2, -3], [4, 5, 6])
    const planes = clippingPlanes(bounds)
    expect(planes).toHaveLength(6)
    const kept = (point: THREE.Vector3) =>
      planes.every((plane) => plane.distanceToPoint(point) >= 0)
    expect(kept(new THREE.Vector3(0, 0, 0))).toBe(true)
    expect(kept(bounds.min)).toBe(true)
    expect(kept(bounds.max)).toBe(true)
    for (const coordinates of [
      [-1.01, 0, 0],
      [4.01, 0, 0],
      [0, -2.01, 0],
      [0, 5.01, 0],
      [0, 0, -3.01],
      [0, 0, 6.01],
    ]) {
      expect(kept(new THREE.Vector3(...coordinates))).toBe(false)
    }
  })

  it('lets a ray pass clipped foreground geometry to select an interior member', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    const foreground = new THREE.Mesh(geometry, material)
    const interior = new THREE.Mesh(geometry, material)
    foreground.position.z = 3
    foreground.updateMatrixWorld(true)
    interior.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
    expect(ray.intersectObjects([foreground, interior], false)[0].object).toBe(foreground)

    const clipped = sectionRaycast(box([-1, -1, -1], [1, 1, 1]))
    foreground.raycast = clipped
    interior.raycast = clipped
    const intersections = ray.intersectObjects([foreground, interior], false)
    expect(intersections.length).toBeGreaterThan(0)
    expect(intersections.every((hit) => hit.object === interior)).toBe(true)
    expect(intersections.every((hit) => hit.point.z >= -1 && hit.point.z <= 1)).toBe(true)

    foreground.raycast = sectionRaycast(null)
    expect(ray.intersectObjects([foreground, interior], false)[0].object).toBe(foreground)
    geometry.dispose()
    material.dispose()
  })
})

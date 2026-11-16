import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { SectionBoxSettings } from './sectionBox'
import {
  dragSectionPercent,
  projectSectionAxis,
  separateSectionHandles,
  setSectionFace,
} from './sectionBoxDrag'

function frontCamera() {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

describe('projected section face dragging', () => {
  it('moves horizontal and vertical faces by their projected world distance', () => {
    const camera = frontCamera()
    const x = projectSectionAxis(camera, new THREE.Vector3(), 'x', 10, 1000, 800)
    const y = projectSectionAxis(camera, new THREE.Vector3(), 'y', 10, 1000, 800)
    expect(x).toEqual({ x: 1000, y: -0, fallback: false })
    expect(y).toEqual({ x: 0, y: -800, fallback: false })
    expect(dragSectionPercent(50, -250, 500, x)).toBe(25)
    expect(dragSectionPercent(50, 500, -200, y)).toBe(75)
    expect(dragSectionPercent(50, 0, 200, x)).toBe(50)
  })

  it('follows reversed camera directions rather than assuming screen-right is world-right', () => {
    const camera = frontCamera()
    camera.position.z = -10
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const projection = projectSectionAxis(camera, new THREE.Vector3(), 'x', 10, 1000, 800)
    expect(projection.x).toBeCloseTo(-1000)
    expect(dragSectionPercent(40, -100, 0, projection)).toBeCloseTo(50)
  })

  it('projects perspective-camera axes without changing the origin or camera', () => {
    const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 100)
    camera.position.set(8, 6, 10)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    const origin = new THREE.Vector3(1, 2, -1)
    const original = origin.clone()
    const projection = projectSectionAxis(camera, origin, 'z', 4, 1200, 800)
    expect(projection.fallback).toBe(false)
    expect(origin.equals(original)).toBe(true)
    expect(dragSectionPercent(20, projection.x / 4, projection.y / 4, projection)).toBeCloseTo(45)
  })

  it('offers vertical dragging for edge-on, very thin or invalid axes', () => {
    const camera = frontCamera()
    const edgeOn = projectSectionAxis(camera, new THREE.Vector3(), 'z', 10, 1000, 800)
    expect(edgeOn).toEqual({ x: 0, y: -400, fallback: true })
    expect(dragSectionPercent(50, 0, -80, edgeOn)).toBe(70)
    expect(projectSectionAxis(camera, new THREE.Vector3(), 'x', 0.001, 1000, 800).fallback).toBe(
      true,
    )
    const invalid = projectSectionAxis(camera, new THREE.Vector3(), 'x', NaN, 1000, NaN)
    expect(invalid).toEqual({ x: 0, y: -80, fallback: true })
  })

  it('keeps a finite starting percentage for invalid pointer or projection data', () => {
    expect(dragSectionPercent(30, NaN, 1, { x: 100, y: 0, fallback: false })).toBe(30)
    expect(dragSectionPercent(30, 1, 1, { x: 0, y: 0, fallback: false })).toBe(30)
    expect(dragSectionPercent(30, 1, 1, { x: Infinity, y: 0, fallback: false })).toBe(30)
    expect(dragSectionPercent(NaN, NaN, 1, { x: 0, y: 0, fallback: false })).toBe(0)
  })
})

describe('section face limits', () => {
  const settings: SectionBoxSettings = {
    targetId: 'chosen-member',
    ranges: { x: [20, 80], y: [0, 100], z: [10, 90] },
  }

  it('clamps either face to the initial box and prevents inverted or empty sections', () => {
    expect(setSectionFace(settings, 'x', 0, -40).ranges.x).toEqual([0, 80])
    expect(setSectionFace(settings, 'x', 0, 120).ranges.x).toEqual([79, 80])
    expect(setSectionFace(settings, 'x', 1, -40).ranges.x).toEqual([20, 21])
    expect(setSectionFace(settings, 'x', 1, 120).ranges.x).toEqual([20, 100])
  })

  it('rounds pointer input to slider precision while preserving other faces and the target', () => {
    const before = structuredClone(settings)
    const next = setSectionFace(settings, 'x', 0, 36.6)
    expect(next.ranges.x).toEqual([37, 80])
    expect(next.ranges.y).toEqual([0, 100])
    expect(next.ranges.z).toEqual([10, 90])
    expect(next.targetId).toBe('chosen-member')
    expect(settings).toEqual(before)
    expect(next).not.toBe(settings)
    expect(next.ranges).not.toBe(settings.ranges)
    expect(next.ranges.x).not.toBe(settings.ranges.x)
  })

  it('ignores nonfinite requested values and repairs invalid existing endpoints', () => {
    expect(setSectionFace(settings, 'x', 0, NaN).ranges.x).toEqual([20, 80])
    const invalid: SectionBoxSettings = {
      ...settings,
      ranges: { ...settings.ranges, x: [NaN, Infinity] },
    }
    expect(setSectionFace(invalid, 'x', 1, NaN).ranges.x).toEqual([0, 100])
    const reversed: SectionBoxSettings = {
      ...settings,
      ranges: { ...settings.ranges, x: [90, 20] },
    }
    expect(setSectionFace(reversed, 'x', 1, 10).ranges.x).toEqual([90, 91])
  })
})

describe('section handle separation', () => {
  const assertSpacedAndBounded = (
    points: { x: number; y: number }[],
    width = 300,
    height = 340,
  ) => {
    for (const [index, point] of points.entries()) {
      expect(point.x).toBeGreaterThanOrEqual(24)
      expect(point.x).toBeLessThanOrEqual(width - 24)
      expect(point.y).toBeGreaterThanOrEqual(24)
      expect(point.y).toBeLessThanOrEqual(height - 36)
      for (const other of points.slice(index + 1))
        expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThanOrEqual(59.9)
    }
  }

  it.each([
    [150, 170],
    [0, 0],
    [300, 340],
    [25, 25],
  ])('separates six coincident or corner-clustered mobile handles at %s,%s', (x, y) => {
    const points = Array.from({ length: 6 }, (_, index) => ({ id: `face-${index}`, x, y }))
    const original = structuredClone(points)
    const separated = separateSectionHandles(points, 300, 340)
    assertSpacedAndBounded(separated)
    expect(separated.map((point) => point.id)).toEqual(points.map((point) => point.id))
    expect(points).toEqual(original)
    expect(separateSectionHandles(points, 300, 340)).toEqual(separated)
  })

  it('leaves well-separated in-bounds screen positions unchanged', () => {
    const points = [
      { id: 'left', x: 30, y: 150 },
      { id: 'right', x: 270, y: 150 },
      { id: 'top', x: 150, y: 30 },
      { id: 'bottom', x: 150, y: 280 },
      { id: 'near', x: 90, y: 90 },
      { id: 'far', x: 220, y: 230 },
    ]
    expect(separateSectionHandles(points, 300, 340)).toEqual(points)
  })

  it('separates a mixed near-corner cluster with a requested handle gap', () => {
    const points = Array.from({ length: 6 }, (_, index) => ({
      id: String(index),
      x: 25 + index,
      y: 26 + index,
    }))
    const result = separateSectionHandles(points, 300, 340, 64)
    assertSpacedAndBounded(result)
    for (const [index, point] of result.entries())
      for (const other of result.slice(index + 1))
        expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThanOrEqual(63.9)
  })
})

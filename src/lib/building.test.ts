import { describe, expect, it } from 'vitest'
import { BUILDING_ELEMENTS, BUILDING_FLOORS } from '../data/building'
import { filterBuildingElements, formatVolume, getBuildingSummary } from './building'

describe('built-in building sample', () => {
  it('has unique, clearly synthetic IDs and positive geometric dimensions', () => {
    expect(new Set(BUILDING_ELEMENTS.map((element) => element.id)).size).toBe(72)
    expect(new Set(BUILDING_ELEMENTS.map((element) => element.globalId)).size).toBe(72)
    for (const element of BUILDING_ELEMENTS) {
      expect(element.globalId).toMatch(/^DEMO-/)
      expect(
        element.dimensions.every((dimension) => Number.isFinite(dimension) && dimension > 0),
      ).toBe(true)
      expect(element.volume).toBeCloseTo(
        element.dimensions[0] * element.dimensions[1] * element.dimensions[2],
        6,
      )
      expect(BUILDING_FLOORS).toContain(element.floor)
    }
  })

  it('provides the intended frame per floor: 9 columns, 12 beams, 1 slab and 2 panels', () => {
    for (const floor of BUILDING_FLOORS) {
      const summary = getBuildingSummary(filterBuildingElements(BUILDING_ELEMENTS, floor))
      expect(summary.elementCount).toBe(24)
      expect(summary.floorCount).toBe(1)
      expect(summary.byKind.map((group) => group.count)).toEqual([9, 12, 1, 2])
      // Independently calculated gross box volumes: columns 4.32, beams 4.464,
      // slab 10.752, two lightweight panels 1.974 cubic metres.
      expect(summary.totalVolume).toBeCloseTo(21.51, 6)
      expect(
        summary.byMaterial.find((group) => group.material === '철근콘크리트')?.volume,
      ).toBeCloseTo(19.536, 6)
      expect(
        summary.byMaterial.find((group) => group.material === '경량 패널')?.volume,
      ).toBeCloseTo(1.974, 6)
    }
  })

  it('aggregates all floors without counting filtered-out elements', () => {
    expect(filterBuildingElements(BUILDING_ELEMENTS, 'all')).toHaveLength(72)
    const total = getBuildingSummary(BUILDING_ELEMENTS)
    expect(total.totalVolume).toBeCloseTo(64.53, 6)
    expect(total.floorCount).toBe(3)
    expect(total.byFloor.map((group) => group.volume)).toEqual([21.51, 21.51, 21.51])
    expect(total.byKind.find((group) => group.kind === 'column')?.volume).toBeCloseTo(12.96, 6)
  })

  it('handles an empty filter result and formats volume with its unit', () => {
    expect(getBuildingSummary([])).toMatchObject({
      elementCount: 0,
      totalVolume: 0,
      floorCount: 0,
      byMaterial: [],
      byFloor: [],
    })
    expect(formatVolume(21.51)).toBe('21.51 m³')
  })
})

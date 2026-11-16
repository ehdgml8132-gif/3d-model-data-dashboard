import { describe, expect, it } from 'vitest'
import {
  createBuildingMetricFilters,
  filterBuildingMetricElements,
  hasBuildingMetricFilters,
  isBuildingMetricFilterActive,
  type BuildingFilterElement,
  type BuildingMetricFilters,
} from './buildingFilters'

const elements: (BuildingFilterElement & { tag: string })[] = [
  {
    id: 'C-01',
    name: '기둥 1',
    kind: 'column',
    floor: '1F',
    material: '콘크리트',
    volume: 0,
    tag: '001',
  },
  {
    id: 'C-02',
    name: '기둥 2',
    kind: 'column',
    floor: '2F',
    material: '콘크리트',
    volume: 2,
    tag: '002',
  },
  { id: 'B-01', name: '보 1', kind: 'beam', floor: '1F', material: '철골', volume: 1, tag: '003' },
  {
    id: 'B-02',
    name: '보 2',
    kind: 'beam',
    floor: '2F',
    material: '콘크리트',
    volume: 4,
    tag: '004',
  },
  {
    id: 'W-01',
    name: '벽 1',
    kind: 'wall',
    floor: '2F',
    material: '미지정',
    volume: null,
    tag: '005',
  },
]
const ids = (items: BuildingFilterElement[]) => items.map((item) => item.id)

describe('building metric filters', () => {
  it('starts with every element visible and returns ordered original objects with their extra fields', () => {
    const filters = createBuildingMetricFilters()
    const result = filterBuildingMetricElements(elements, filters)
    expect(ids(result)).toEqual(['C-01', 'C-02', 'B-01', 'B-02', 'W-01'])
    expect(result).not.toBe(elements)
    expect(result[1]).toBe(elements[1])
    expect(result[1].tag).toBe('002')
    expect(hasBuildingMetricFilters(filters)).toBe(false)
  })

  it('creates independent volume state for each fresh filter set', () => {
    const first = createBuildingMetricFilters()
    const second = createBuildingMetricFilters()
    first.volume.min = 3
    first.volume.includeUnknown = false
    expect(second.volume).toEqual({ min: null, max: null, includeUnknown: true })
  })

  it('unions checked choices within a group and intersects all card conditions', () => {
    const filters: BuildingMetricFilters = {
      ...createBuildingMetricFilters(),
      kinds: ['column', 'beam'],
      floors: ['1F', '2F'],
      materials: ['콘크리트'],
      volume: { min: 1, max: 4, includeUnknown: false },
    }
    expect(ids(filterBuildingMetricElements(elements, filters))).toEqual(['C-02', 'B-02'])
  })

  it('limits individually selected members without overriding other card filters', () => {
    const filters: BuildingMetricFilters = {
      ...createBuildingMetricFilters(),
      elementIds: ['B-02', 'C-01', 'W-01'],
      kinds: ['column', 'beam'],
    }
    expect(ids(filterBuildingMetricElements(elements, filters))).toEqual(['C-01', 'B-02'])
    filters.floors = ['2F']
    expect(ids(filterBuildingMetricElements(elements, filters))).toEqual(['B-02'])
  })

  it.each(['kinds', 'elementIds', 'floors', 'materials'] as const)(
    'treats empty %s as none and null as all, including previously unseen model values',
    (key) => {
      const filters = createBuildingMetricFilters()
      filters[key] = []
      expect(filterBuildingMetricElements(elements, filters)).toEqual([])
      expect(hasBuildingMetricFilters(filters)).toBe(true)
      filters[key] = null
      expect(filterBuildingMetricElements(elements, filters)).toHaveLength(5)
    },
  )

  it('keeps exact checkbox identities including special strings and case-sensitive member IDs', () => {
    const special: BuildingFilterElement[] = [
      { ...elements[0], id: '__proto__', floor: 'B1 / 지하', material: '철골, 도장' },
      { ...elements[1], id: 'ABC', floor: 'B1 / 지하', material: '철골, 도장' },
      { ...elements[2], id: 'abc', floor: 'B1', material: '철골' },
    ]
    const filters: BuildingMetricFilters = {
      ...createBuildingMetricFilters(),
      elementIds: ['__proto__', 'ABC'],
      floors: ['B1 / 지하'],
      materials: ['철골, 도장'],
    }
    expect(ids(filterBuildingMetricElements(special, filters))).toEqual(['__proto__', 'ABC'])
  })

  it('includes exact minimum/maximum values and preserves known zero independently from unknown', () => {
    const filters = createBuildingMetricFilters()
    filters.volume = { min: 0, max: 2, includeUnknown: false }
    expect(ids(filterBuildingMetricElements(elements, filters))).toEqual(['C-01', 'C-02', 'B-01'])
    filters.volume = { min: 0, max: 0, includeUnknown: true }
    expect(ids(filterBuildingMetricElements(elements, filters))).toEqual(['C-01', 'W-01'])
  })

  it('treats nonfinite and negative source volumes as unknown, with an explicit inclusion choice', () => {
    const invalid = [NaN, Infinity, -1, null].map((volume, index) => ({
      ...elements[0],
      id: `unknown-${index}`,
      volume,
    }))
    const filters = createBuildingMetricFilters()
    filters.volume = { min: 1, max: 2, includeUnknown: true }
    expect(filterBuildingMetricElements(invalid, filters)).toHaveLength(4)
    filters.volume.includeUnknown = false
    expect(filterBuildingMetricElements(invalid, filters)).toEqual([])
  })

  it.each([
    { min: 3, max: 1 },
    { min: -1, max: 2 },
    { min: NaN, max: null },
    { min: null, max: Infinity },
  ])('does not silently normalize invalid volume bounds %j', ({ min, max }) => {
    const filters = createBuildingMetricFilters()
    filters.volume = { min, max, includeUnknown: false }
    expect(filterBuildingMetricElements(elements, filters)).toEqual([])
    filters.volume.includeUnknown = true
    expect(ids(filterBuildingMetricElements(elements, filters))).toEqual(['W-01'])
  })

  it('reports active cards separately, including all-unchecked and unknown-only changes', () => {
    const filters = createBuildingMetricFilters()
    filters.kinds = []
    expect(isBuildingMetricFilterActive(filters, 'members')).toBe(true)
    expect(isBuildingMetricFilterActive(filters, 'floors')).toBe(false)
    filters.kinds = null
    filters.elementIds = ['C-02']
    filters.floors = ['2F']
    filters.materials = ['콘크리트']
    filters.volume.includeUnknown = false
    expect(
      ['members', 'volume', 'floors', 'materials'].map((key) =>
        isBuildingMetricFilterActive(filters, key as 'members' | 'volume' | 'floors' | 'materials'),
      ),
    ).toEqual([true, true, true, true])
  })

  it('does not mutate elements or filter selections while combining conditions', () => {
    const filters: BuildingMetricFilters = {
      ...createBuildingMetricFilters(),
      kinds: ['beam', 'column'],
      floors: ['2F'],
      elementIds: ['B-02', 'C-02'],
    }
    const beforeElements = structuredClone(elements)
    const beforeFilters = structuredClone(filters)
    expect(ids(filterBuildingMetricElements(elements, filters))).toEqual(['C-02', 'B-02'])
    expect(elements).toEqual(beforeElements)
    expect(filters).toEqual(beforeFilters)
  })
})

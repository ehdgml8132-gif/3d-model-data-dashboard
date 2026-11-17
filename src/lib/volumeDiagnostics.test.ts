import { describe, expect, it } from 'vitest'
import type { IfcVolumeIssue } from '../ifc/types'
import {
  createBuildingMetricFilters,
  filterBuildingMetricElements,
  type BuildingFilterElement,
} from './buildingFilters'
import { summarizeVolumeIssues } from './volumeDiagnostics'

function element(
  id: string,
  floor: string,
  volume: number | null,
  volumeIssue?: IfcVolumeIssue,
): BuildingFilterElement {
  return {
    id,
    name: `부재 ${id}`,
    kind: 'column',
    floor,
    material: '콘크리트',
    volume,
    volumeIssue,
  }
}

describe('visible volume diagnostics', () => {
  it('counts each unknown once, retains observed details and keeps zero as a known volume', () => {
    const observed: IfcVolumeIssue = {
      code: 'unknown-unit',
      source: 'Type / Pset_Revit / 체적',
      value: '12.5',
      unit: '미지정',
    }
    const elements = [
      element('0', '1층', 0),
      element('1', '1층', 1.5, { code: 'missing-property' }),
      element('2', '1층', null, { code: 'missing-property' }),
      element('3', '2층', null, observed),
      element('4', '2층', null, { code: 'missing-property' }),
    ]
    const result = summarizeVolumeIssues(elements)
    expect(result.total).toBe(3)
    expect(result.groups.map(({ code, count }) => ({ code, count }))).toEqual([
      { code: 'missing-property', count: 2 },
      { code: 'unknown-unit', count: 1 },
    ])
    expect(result.groups.reduce((sum, group) => sum + group.count, 0)).toBe(result.total)
    expect(result.elements.map((item) => item.id)).toEqual(['2', '3', '4'])
    expect(result.elements.find((item) => item.id === '3')?.issue).toEqual(observed)
    expect(elements).toHaveLength(5)
  })

  it('matches the applied visible scope and drops diagnostics when unknowns are excluded', () => {
    const elements = [
      element('1', '1층', null, { code: 'empty-value' }),
      element('2', '2층', null, { code: 'invalid-value' }),
      element('3', '1층', 0),
    ]
    const filters = createBuildingMetricFilters()
    filters.floors = ['1층']
    const visible = filterBuildingMetricElements(elements, filters)
    expect(summarizeVolumeIssues(visible).elements.map((item) => item.id)).toEqual(['1'])
    expect(summarizeVolumeIssues(visible.filter((item) => item.name.includes('3'))).total).toBe(0)
    filters.volume.includeUnknown = false
    expect(summarizeVolumeIssues(filterBuildingMetricElements(elements, filters))).toEqual({
      total: 0,
      groups: [],
      elements: [],
    })
  })

  it('does not invent a source cause when older data has no recorded diagnostic', () => {
    const result = summarizeVolumeIssues([element('legacy', '1층', null)])
    expect(result.total).toBe(1)
    expect(result.groups).toMatchObject([{ code: 'unclassified', count: 1 }])
    expect(result.elements[0].issue).toEqual({ code: 'unclassified' })
  })
})

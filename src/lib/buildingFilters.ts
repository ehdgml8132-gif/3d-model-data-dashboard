export type BuildingFilterElement = {
  id: string
  name: string
  kind: string
  floor: string
  material: string
  volume: number | null
}

export type BuildingMetricFilterKey = 'members' | 'volume' | 'floors' | 'materials'

export type BuildingMetricFilters = {
  /** null includes every option; an empty array deliberately includes none. */
  kinds: string[] | null
  elementIds: string[] | null
  floors: string[] | null
  materials: string[] | null
  volume: {
    min: number | null
    max: number | null
    includeUnknown: boolean
  }
}

export function createBuildingMetricFilters(): BuildingMetricFilters {
  return {
    kinds: null,
    elementIds: null,
    floors: null,
    materials: null,
    volume: { min: null, max: null, includeUnknown: true },
  }
}

export function isBuildingMetricFilterActive(
  filters: BuildingMetricFilters,
  key: BuildingMetricFilterKey,
): boolean {
  switch (key) {
    case 'members':
      return filters.kinds !== null || filters.elementIds !== null
    case 'volume':
      return (
        filters.volume.min !== null || filters.volume.max !== null || !filters.volume.includeUnknown
      )
    case 'floors':
      return filters.floors !== null
    case 'materials':
      return filters.materials !== null
  }
}

export function hasBuildingMetricFilters(filters: BuildingMetricFilters): boolean {
  return (
    isBuildingMetricFilterActive(filters, 'members') ||
    isBuildingMetricFilterActive(filters, 'volume') ||
    isBuildingMetricFilterActive(filters, 'floors') ||
    isBuildingMetricFilterActive(filters, 'materials')
  )
}

/** OR within a checkbox group, AND across groups. Volume bounds are inclusive
 * in m³; absent or invalid source values remain unknown rather than becoming 0.
 */
export function filterBuildingMetricElements<T extends BuildingFilterElement>(
  elements: T[],
  filters: BuildingMetricFilters,
): T[] {
  const kinds = filters.kinds === null ? null : new Set(filters.kinds)
  const ids = filters.elementIds === null ? null : new Set(filters.elementIds)
  const floors = filters.floors === null ? null : new Set(filters.floors)
  const materials = filters.materials === null ? null : new Set(filters.materials)
  const { min, max, includeUnknown } = filters.volume
  const validBound = (bound: number | null) =>
    bound === null || (Number.isFinite(bound) && bound >= 0)
  // Invalid bounds are never silently swapped or treated as an unbounded range.
  // Unknown values still follow their own explicit checkbox.
  const validRange =
    validBound(min) && validBound(max) && (min === null || max === null || min <= max)

  return elements.filter((element) => {
    if (kinds && !kinds.has(element.kind)) return false
    if (ids && !ids.has(element.id)) return false
    if (floors && !floors.has(element.floor)) return false
    if (materials && !materials.has(element.material)) return false
    const volume = element.volume
    if (volume === null || !Number.isFinite(volume) || volume < 0) return includeUnknown
    return validRange && (min === null || volume >= min) && (max === null || volume <= max)
  })
}

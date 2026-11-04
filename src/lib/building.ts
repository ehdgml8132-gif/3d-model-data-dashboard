import {
  BUILDING_FLOORS,
  type BuildingElement,
  type ElementKind,
  type FloorFilter,
} from '../data/building'

export const ELEMENT_KIND_LABELS: Record<ElementKind, string> = {
  column: '기둥',
  beam: '보',
  slab: '슬래브',
  wall: '벽체',
}

export function filterBuildingElements(
  elements: BuildingElement[],
  floor: FloorFilter,
): BuildingElement[] {
  return floor === 'all' ? elements : elements.filter((element) => element.floor === floor)
}

export function getBuildingSummary(elements: BuildingElement[]) {
  const total = (items: BuildingElement[]) =>
    Number(items.reduce((sum, item) => sum + item.volume, 0).toFixed(6))
  const kinds: ElementKind[] = ['column', 'beam', 'slab', 'wall']
  const materials = [...new Set(elements.map((element) => element.material))]
  return {
    elementCount: elements.length,
    totalVolume: total(elements),
    floorCount: new Set(elements.map((element) => element.floor)).size,
    byKind: kinds.map((kind) => {
      const items = elements.filter((element) => element.kind === kind)
      return { kind, label: ELEMENT_KIND_LABELS[kind], count: items.length, volume: total(items) }
    }),
    byMaterial: materials.map((material) => {
      const items = elements.filter((element) => element.material === material)
      return { material, count: items.length, volume: total(items) }
    }),
    byFloor: BUILDING_FLOORS.filter((floor) =>
      elements.some((element) => element.floor === floor),
    ).map((floor) => {
      const items = elements.filter((element) => element.floor === floor)
      return { floor, count: items.length, volume: total(items) }
    }),
  }
}

export function formatVolume(value: number): string {
  return `${new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} m³`
}

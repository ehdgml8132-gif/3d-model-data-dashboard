/** Synthetic geometry for the built-in BIM demonstration; no IFC file is loaded. */
export type BuildingFloor = '1F' | '2F' | '3F'
export type FloorFilter = 'all' | BuildingFloor
export type ElementKind = 'column' | 'beam' | 'slab' | 'wall'
export type BuildingElement = {
  id: string
  /** Readable demo identifier, deliberately not represented as an actual IFC GUID. */
  globalId: string
  name: string
  kind: ElementKind
  ifcClass: 'IfcColumn' | 'IfcBeam' | 'IfcSlab' | 'IfcWall'
  floor: BuildingFloor
  material: '철근콘크리트' | '경량 패널'
  /** x, y, z in metres; volume is the gross rectangular geometry volume. */
  dimensions: [number, number, number]
  position: [number, number, number]
  volume: number
}

export const BUILDING_FLOORS: BuildingFloor[] = ['1F', '2F', '3F']

const IFC_CLASSES: Record<ElementKind, BuildingElement['ifcClass']> = {
  column: 'IfcColumn',
  beam: 'IfcBeam',
  slab: 'IfcSlab',
  wall: 'IfcWall',
}
const elements: BuildingElement[] = []
function addElement(
  floor: BuildingFloor,
  suffix: string,
  kind: ElementKind,
  name: string,
  dimensions: BuildingElement['dimensions'],
  position: BuildingElement['position'],
) {
  const id = `${floor}-${suffix}`
  elements.push({
    id,
    globalId: `DEMO-${id}`,
    name,
    kind,
    ifcClass: IFC_CLASSES[kind],
    floor,
    material: kind === 'wall' ? '경량 패널' : '철근콘크리트',
    dimensions,
    position,
    volume: Number((dimensions[0] * dimensions[1] * dimensions[2]).toFixed(6)),
  })
}

BUILDING_FLOORS.forEach((floor, floorIndex) => {
  const base = floorIndex * 3.2
  let column = 0
  for (const x of [-4, 0, 4]) {
    for (const z of [-3, 0, 3]) {
      column += 1
      addElement(
        floor,
        `C${String(column).padStart(2, '0')}`,
        'column',
        `${floor} 기둥 ${column}`,
        [0.4, 3, 0.4],
        [x, base + 1.5, z],
      )
    }
  }
  let beam = 0
  for (const z of [-3, 0, 3]) {
    for (const x of [-2, 2]) {
      beam += 1
      addElement(
        floor,
        `BX${String(beam).padStart(2, '0')}`,
        'beam',
        `${floor} X방향 보 ${beam}`,
        [3.6, 0.4, 0.3],
        [x, base + 2.8, z],
      )
    }
  }
  beam = 0
  for (const x of [-4, 0, 4]) {
    for (const z of [-1.5, 1.5]) {
      beam += 1
      addElement(
        floor,
        `BZ${String(beam).padStart(2, '0')}`,
        'beam',
        `${floor} Z방향 보 ${beam}`,
        [0.3, 0.4, 2.6],
        [x, base + 2.8, z],
      )
    }
  }
  addElement(floor, 'S01', 'slab', `${floor} 상부 슬래브`, [8.4, 0.2, 6.4], [0, base + 3.1, 0])
  for (const [index, x] of [-2, 2].entries()) {
    addElement(
      floor,
      `W0${index + 1}`,
      'wall',
      `${floor} 후면 외벽 패널 ${index + 1}`,
      [3.5, 2.35, 0.12],
      [x, base + 1.375, -3],
    )
  }
})

export const BUILDING_ELEMENTS: BuildingElement[] = elements

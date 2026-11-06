import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { extractIfcModel } from './extract'

const require = createRequire(import.meta.url)
const { IfcAPI: NodeIfcAPI } = require('web-ifc') as { IfcAPI: new () => IfcAPI }
const source = readFileSync(
  new URL('../../public/examples/authored-building.ifc', import.meta.url),
  'utf8',
)
let api: IfcAPI

beforeAll(async () => {
  api = new NodeIfcAPI()
  await api.Init()
})
afterAll(() => api?.Dispose())

function parse(text = source) {
  const id = api.OpenModel(new TextEncoder().encode(text), {
    COORDINATE_TO_ORIGIN: true,
    CIRCLE_SEGMENTS: 16,
  })
  try {
    expect(id).toBeGreaterThanOrEqual(0)
    return extractIfcModel(api, id, 'authored-building.ifc')
  } finally {
    api.CloseModel(id)
  }
}

describe('official web-ifc extraction', () => {
  it('extracts real curved geometry, storeys, materials and IFC properties', () => {
    const model = parse()
    expect(model.elements).toHaveLength(5)
    expect(model.meshes).toHaveLength(5)
    expect(model.lengthUnit).toBe('mm')
    expect(model.warnings).toEqual([])
    const column = model.elements.find((element) => element.expressId === 44)!
    expect(column).toMatchObject({
      id: 'IFC-44',
      globalId: '0nKbBzQJnGpBAXy9$4zESO',
      tag: '0001',
      kind: 'column',
      floor: 'Ground floor',
      material: 'Concrete C30/37',
      volume: 0.589048623,
    })
    expect(column.properties).toContainEqual({
      group: 'Pset_DemoCommon',
      name: 'FireRating',
      value: 'R120',
    })
    const mesh = model.meshes.find((mesh) => mesh.elementId === column.id)!
    expect(mesh.positions.length / 3).toBeGreaterThan(24)
    expect(mesh.indices.length).toBeGreaterThan(36)
    // web-ifc keeps local vertices in mm; its transform handles scale and IFC Z→Y.
    const transformed: number[][] = []
    const m = mesh.matrix
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = mesh.positions.subarray(i, i + 3)
      transformed.push([
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      ])
    }
    const dimensions = [0, 1, 2].map(
      (axis) =>
        Math.max(...transformed.map((p) => p[axis])) - Math.min(...transformed.map((p) => p[axis])),
    )
    expect(dimensions[0]).toBeCloseTo(0.5, 1)
    expect(dimensions[1]).toBeCloseTo(3, 5)
    expect(dimensions[2]).toBeCloseTo(0.5, 1)
  })

  it('keeps explicit cubic-metre quantities independent of millimetre length units', () => {
    const model = parse()
    expect(model.elements.find((element) => element.expressId === 108)?.volume).toBe(1.25)
  })

  it('shares owned buffers for repeated IFC representations while retaining each element placement', () => {
    const text = source
      .replace('(#44,#60),#25)', '(#44,#60,#119),#25)')
      .replace(
        'ENDSEC;\nEND-ISO',
        [
          "#119=IFCCOLUMN('0J4FUqfnH4JfJ1O84e9Xp0',#5,'Repeated column',$,$,#55,#43,'0006',.NOTDEFINED.);",
          'ENDSEC;\nEND-ISO',
        ].join('\n'),
      )
    const model = parse(text)
    const first = model.meshes.find((mesh) => mesh.elementId === 'IFC-44')!
    const repeated = model.meshes.find((mesh) => mesh.elementId === 'IFC-119')!
    expect(repeated.positions).toBe(first.positions)
    expect(repeated.normals).toBe(first.normals)
    expect(repeated.indices).toBe(first.indices)
    expect(repeated.matrix).not.toEqual(first.matrix)
  })

  it('converts an explicit cubic-millimetre quantity exactly once', () => {
    const text = source
      .replace(
        "#113=IFCQUANTITYVOLUME('NetVolume','Declared volume in cubic metres',#15,1.25,$);",
        "#113=IFCQUANTITYVOLUME('NetVolume',$,#119,1250000000.,$);",
      )
      .replace(
        'ENDSEC;\nEND-ISO',
        '#119=IFCSIUNIT(*,.VOLUMEUNIT.,.MILLI.,.CUBIC_METRE.);\nENDSEC;\nEND-ISO',
      )
    expect(parse(text).elements.find((element) => element.expressId === 108)?.volume).toBeCloseTo(
      1.25,
      8,
    )
  })

  it('shows project units for typed property values without guessing occurrence quantities', () => {
    const text = source.replace("IFCLABEL('R120')", 'IFCLENGTHMEASURE(500.)')
    const column = parse(text).elements.find((element) => element.expressId === 44)!
    expect(column.properties).toContainEqual({
      group: 'Pset_DemoCommon',
      name: 'FireRating',
      value: '500 mm',
    })
    expect(column.volume).toBe(0.589048623)
  })

  it('shows null for missing quantities and for unknown volume units', () => {
    const withoutBeamQto = source.replace(/#115=IFCRELDEFINESBYPROPERTIES[^\n]+\n/, '')
    const model = parse(withoutBeamQto)
    expect(model.elements.find((element) => element.expressId === 108)?.volume).toBeNull()
    expect(model.warnings.some((warning) => warning.includes('수량이 없는'))).toBe(true)
    const unknown = source.replace(
      '#15=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);',
      "#15=IFCCONTEXTDEPENDENTUNIT($,.VOLUMEUNIT.,'Unknown volume unit');",
    )
    expect(parse(unknown).elements.every((element) => element.volume === null)).toBe(true)
  })

  it.each(['IFCRELAGGREGATES', 'IFCRELNESTS'])(
    'finds storeys through %s parents and includes type property sets',
    (parentRelation) => {
      const text = source
        .replace('(#44,#60),#25)', '(#119,#60),#25)')
        .replace(
          'ENDSEC;\nEND-ISO',
          [
            "#119=IFCELEMENTASSEMBLY('0J4FUqfnH4JfJ1O84e9Xp0',#5,'Column assembly',$,$,$,$,$,.NOTDEFINED.,.NOTDEFINED.);",
            `#120=${parentRelation}('0J4FUqfnH4JfJ1O84e9Xp1',#5,$,$,#119,(#44));`,
            "#121=IFCCOLUMNTYPE('0J4FUqfnH4JfJ1O84e9Xp2',#5,'Round column type',$,$,(#47),$,$,$,.NOTDEFINED.);",
            "#122=IFCRELDEFINESBYTYPE('0J4FUqfnH4JfJ1O84e9Xp3',#5,$,$,(#76),#121);",
            'ENDSEC;\nEND-ISO',
          ].join('\n'),
        )
      const model = parse(text)
      expect(model.elements.find((element) => element.expressId === 44)?.floor).toBe('Ground floor')
      expect(model.elements.find((element) => element.expressId === 76)?.properties).toContainEqual(
        {
          group: 'Type / Pset_DemoCommon',
          name: 'FireRating',
          value: 'R120',
        },
      )
    },
  )
})

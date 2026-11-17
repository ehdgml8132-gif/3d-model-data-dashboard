import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import type { IfcAPI } from 'web-ifc'
import { extractIfcModel } from './extract'
import { MAX_IFC_PROPERTIES_PER_ELEMENT } from './limits'

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

const koreanVolume = '\\X2\\CCB4C801\\X0\\'
const beamProperty =
  "#204=IFCPROPERTYSINGLEVALUE('" + koreanVolume + "',$,IFCVOLUMEMEASURE(1.25),#15);"

function withBeamVolume(nominal: string, unit = '$', name = koreanVolume) {
  return source.replace(
    beamProperty,
    "#204=IFCPROPERTYSINGLEVALUE('" + name + "',$," + nominal + ',' + unit + ');',
  )
}
function append(text: string, lines: string[]) {
  return text.replace('ENDSEC;\nEND-ISO', [...lines, 'ENDSEC;\nEND-ISO'].join('\n'))
}
function beamVolume(text: string) {
  return parse(text).elements.find((element) => element.expressId === 108)?.volume
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
    expect(column.properties).toContainEqual({
      group: 'Pset_DemoCommon',
      name: '체적',
      value: '0.589048623 m³',
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

  it('keeps explicit cubic-metre properties independent of millimetre length units', () => {
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

  it('converts an explicit cubic-millimetre property exactly once', () => {
    const text = append(withBeamVolume('IFCVOLUMEMEASURE(1250000000.)', '#119'), [
      '#119=IFCSIUNIT(*,.VOLUMEUNIT.,.MILLI.,.CUBIC_METRE.);',
    ])
    expect(beamVolume(text)).toBeCloseTo(1.25, 8)
  })

  it('shows project units for unrelated typed properties without using them as volume', () => {
    const text = source.replace("IFCLABEL('R120')", 'IFCLENGTHMEASURE(500.)')
    const column = parse(text).elements.find((element) => element.expressId === 44)!
    expect(column.properties).toContainEqual({
      group: 'Pset_DemoCommon',
      name: 'FireRating',
      value: '500 mm',
    })
    expect(column.volume).toBe(0.589048623)
  })

  it('shows null for a missing 체적 property and for unknown volume units', () => {
    const withoutBeamVolume = source.replace('(#109,#110,#204)', '(#109,#110)')
    const model = parse(withoutBeamVolume)
    expect(model.elements.find((element) => element.expressId === 108)?.volume).toBeNull()
    expect(model.warnings.some((warning) => warning.includes('체적'))).toBe(true)
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

describe('Revit property-set volume extraction', () => {
  it('uses a Revit 체적 property even when Qto/BaseQuantities disagrees', () => {
    const text = source.replace(
      "#113=IFCQUANTITYVOLUME('NetVolume','Declared volume in cubic metres',#15,1.25,$);",
      "#113=IFCQUANTITYVOLUME('NetVolume','Different Qto value',#15,999.,$);",
    )
    const beam = parse(text).elements.find((element) => element.expressId === 108)!
    expect(beam.volume).toBe(1.25)
    expect(beam.properties).toContainEqual({
      group: 'Qto_DemoBaseQuantities',
      name: 'NetVolume',
      value: '999 m³',
    })
  })

  it('does not use Qto volumes when all Revit 체적 properties are absent', () => {
    const text = [200, 201, 202, 203, 204].reduce(
      (text, id) => text.replace(',#' + id + ')', ')'),
      source,
    )
    const model = parse(text)
    expect(model.elements.every((element) => element.volume === null)).toBe(true)
    expect(
      model.elements.every((element) =>
        element.properties.some((property) => property.name === 'NetVolume'),
      ),
    ).toBe(true)
  })

  it.each([
    ['IFCREAL(2.5)', '$', koreanVolume, 2.5],
    ['IFCVOLUMEMEASURE(2.5)', '$', 'Volume', 2.5],
    ['IFCVOLUMEMEASURE(2.5)', '$', 'volume', 2.5],
    ["IFCTEXT('1.25 m³')", '$', koreanVolume, 1.25],
    ["IFCLABEL('1,250.5 m3')", '$', koreanVolume, 1250.5],
    ["IFCLABEL('1,250,000,000 mm³')", '$', koreanVolume, 1.25],
    ["IFCTEXT('1250000 cm³')", '$', koreanVolume, 1.25],
    ['IFCVOLUMEMEASURE(0.)', '$', koreanVolume, 0],
  ] as const)('reads numeric or formatted Revit property %s', (nominal, unit, name, expected) => {
    expect(beamVolume(withBeamVolume(nominal, unit, name))).toBeCloseTo(expected, 8)
  })

  it('converts implicit values using the project volume unit, independently of length', () => {
    const text = withBeamVolume('IFCREAL(1250000000.)').replace(
      '#15=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);',
      '#15=IFCSIUNIT(*,.VOLUMEUNIT.,.MILLI.,.CUBIC_METRE.);',
    )
    expect(beamVolume(text)).toBeCloseTo(1.25, 8)
  })

  it('uses an explicit property unit before the project volume unit', () => {
    const text = append(
      withBeamVolume('IFCVOLUMEMEASURE(1.25)', '#119').replace(
        '#15=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);',
        '#15=IFCSIUNIT(*,.VOLUMEUNIT.,.MILLI.,.CUBIC_METRE.);',
      ),
      ['#119=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);'],
    )
    expect(beamVolume(text)).toBe(1.25)
  })

  it('reads 체적 nested in a complex Revit property', () => {
    const text = append(source.replace('(#109,#110,#204)', '(#109,#110,#205)'), [
      "#205=IFCCOMPLEXPROPERTY('Dimensions',$,'Dimensions',(#204));",
    ])
    expect(beamVolume(text)).toBe(1.25)
  })

  it.each([
    ["IFCLABEL('')", '$', koreanVolume],
    ["IFCLABEL('unknown')", '$', koreanVolume],
    ["IFCLABEL('NaN')", '$', koreanVolume],
    ["IFCLABEL('Infinity')", '$', koreanVolume],
    ["IFCLABEL('1,25 m³')", '$', koreanVolume],
    ["IFCLABEL('1.25 m²')", '$', koreanVolume],
    ['IFCVOLUMEMEASURE(-1.)', '$', koreanVolume],
    ['IFCLENGTHMEASURE(1.25)', '$', koreanVolume],
    ['IFCVOLUMEMEASURE(1.25)', '#13', koreanVolume],
    ['IFCVOLUMEMEASURE(1.25)', '$', 'NetVolume'],
    ['IFCVOLUMEMEASURE(1.25)', '$', '\\X2\\CCB4C8010020D569ACC4\\X0\\'],
  ])('does not guess volumes for invalid property %s (%s, %s)', (nominal, unit, name) => {
    expect(beamVolume(withBeamVolume(nominal, unit, name))).toBeNull()
  })

  it('rejects inconsistent explicit and formatted text volume units', () => {
    expect(beamVolume(withBeamVolume("IFCLABEL('1250000000 mm³')", '#15'))).toBeNull()
  })

  it('uses text volume units when the project volume unit is unavailable', () => {
    const text = withBeamVolume("IFCLABEL('1.25 m³')").replace(
      '#15=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);',
      "#15=IFCCONTEXTDEPENDENTUNIT($,.VOLUMEUNIT.,'Unknown volume unit');",
    )
    expect(beamVolume(text)).toBe(1.25)
  })

  it('does not fall back to project units when a property has an unknown explicit unit', () => {
    const text = append(withBeamVolume('IFCVOLUMEMEASURE(1.25)', '#119'), [
      "#119=IFCCONTEXTDEPENDENTUNIT($,.VOLUMEUNIT.,'Unknown volume unit');",
    ])
    expect(beamVolume(text)).toBeNull()
  })

  it('prefers occurrence properties and uses the type property when absent', () => {
    const text = append(source.replace('(#77,#78,#202)', '(#77,#78)'), [
      "#205=IFCPROPERTYSINGLEVALUE('" + koreanVolume + "',$,IFCVOLUMEMEASURE(2.5),#15);",
      "#206=IFCPROPERTYSET('0J4FUqfnH4JfJ1O84e9Xp0',#5,'Revit Type Dimensions',$,(#205));",
      "#207=IFCCOLUMNTYPE('0J4FUqfnH4JfJ1O84e9Xp1',#5,'Column type',$,$,(#206),$,$,$,.NOTDEFINED.);",
      "#208=IFCRELDEFINESBYTYPE('0J4FUqfnH4JfJ1O84e9Xp2',#5,$,$,(#44,#76),#207);",
    ])
    const model = parse(text)
    expect(model.elements.find((element) => element.expressId === 44)?.volume).toBe(0.589048623)
    expect(model.elements.find((element) => element.expressId === 76)?.volume).toBe(2.5)
  })

  it('keeps conflicting occurrence properties unspecified rather than choosing arbitrarily', () => {
    const text = append(source.replace('(#109,#110,#204)', '(#109,#110,#204,#205)'), [
      "#205=IFCPROPERTYSINGLEVALUE('" + koreanVolume + "',$,IFCVOLUMEMEASURE(2.5),#15);",
    ])
    const model = parse(text)
    expect(model.elements.find((element) => element.expressId === 108)?.volume).toBeNull()
    expect(
      model.warnings.some((warning) => warning.includes('서로 다른') && warning.includes('체적')),
    ).toBe(true)
  })

  it('accepts duplicate properties when their normalized volumes agree', () => {
    const text = append(source.replace('(#109,#110,#204)', '(#109,#110,#204,#205)'), [
      "#205=IFCPROPERTYSINGLEVALUE('" + koreanVolume + "',$,IFCVOLUMEMEASURE(1250000000.),#119);",
      '#119=IFCSIUNIT(*,.VOLUMEUNIT.,.MILLI.,.CUBIC_METRE.);',
    ])
    expect(beamVolume(text)).toBeCloseTo(1.25, 8)
  })
})

describe('observed reasons for unconfirmed Pset volumes', () => {
  const beam = (text: string) => parse(text).elements.find((element) => element.expressId === 108)!
  const withColumnType = (text: string, nominal: string, unit = '#15') =>
    append(text, [
      `#205=IFCPROPERTYSINGLEVALUE('${koreanVolume}',$,${nominal},${unit});`,
      "#206=IFCPROPERTYSET('0J4FUqfnH4JfJ1O84e9Xp0',#5,'Revit Type Dimensions',$,(#205));",
      "#207=IFCCOLUMNTYPE('0J4FUqfnH4JfJ1O84e9Xp1',#5,'Column type',$,$,(#206),$,$,$,.NOTDEFINED.);",
      "#208=IFCRELDEFINESBYTYPE('0J4FUqfnH4JfJ1O84e9Xp2',#5,$,$,(#44,#76),#207);",
    ])

  it('reports missing Pset properties even when usable Qto volumes exist', () => {
    const text = [200, 201, 202, 203, 204].reduce(
      (text, id) => text.replace(',#' + id + ')', ')'),
      source,
    )
    const elements = parse(text).elements
    expect(elements).toHaveLength(5)
    for (const element of elements) {
      expect(element.volume).toBeNull()
      expect(element.volumeIssue?.code).toBe('missing-property')
      expect(element.properties.some((property) => property.name === 'NetVolume')).toBe(true)
    }
    expect(beam(withBeamVolume('IFCVOLUMEMEASURE(1.25)', '$', 'NetVolume')).volumeIssue?.code).toBe(
      'missing-property',
    )
  })

  it.each(['$', "IFCLABEL('')", "IFCLABEL('   ')"])(
    'distinguishes a present but empty nominal value %s from an absent property',
    (nominal) => {
      const element = beam(withBeamVolume(nominal))
      expect(element.volume).toBeNull()
      expect(element.volumeIssue?.code).toBe('empty-value')
      expect(element.volumeIssue?.source).toContain('Pset_DemoCommon')
      expect(element.volumeIssue?.source).toContain('체적')
    },
  )

  it.each([
    "IFCLABEL('unknown')",
    "IFCLABEL('NaN')",
    "IFCLABEL('1,25 m³')",
    "IFCLABEL('1e309')",
    'IFCVOLUMEMEASURE(-1.)',
    'IFCLENGTHMEASURE(1.25)',
  ])('identifies a malformed, negative, nonfinite or wrong-measure value %s', (nominal) => {
    const element = beam(withBeamVolume(nominal))
    expect(element.volume).toBeNull()
    expect(element.volumeIssue?.code).toBe('invalid-value')
    expect(element.volumeIssue?.value).toBeTruthy()
  })

  it.each(["IFCLABEL('1.25 gallons')", "IFCLABEL('1.25 m²')"])(
    'identifies unsupported formatted units in %s instead of blaming the numeric value',
    (nominal) => {
      const element = beam(withBeamVolume(nominal, '$'))
      expect(element.volume).toBeNull()
      expect(element.volumeIssue?.code).toBe('unknown-unit')
    },
  )

  it('distinguishes incomplete exponents from unfamiliar units beginning with e', () => {
    for (const nominal of ["IFCLABEL('1e+')", "IFCLABEL('1e- m³')"]) {
      const element = beam(withBeamVolume(nominal))
      expect(element.volume).toBeNull()
      expect(element.volumeIssue?.code).toBe('invalid-value')
    }
    for (const nominal of ["IFCLABEL('1 ea')", "IFCLABEL('1 eV')"])
      expect(beam(withBeamVolume(nominal)).volumeIssue?.code).toBe('unknown-unit')
  })

  it('identifies unsupported explicit units and a non-volume explicit dimension', () => {
    const unknown = append(withBeamVolume('IFCVOLUMEMEASURE(1.25)', '#119'), [
      "#119=IFCCONTEXTDEPENDENTUNIT($,.VOLUMEUNIT.,'Custom volume units');",
    ])
    expect(beam(unknown).volumeIssue?.code).toBe('unknown-unit')
    expect(beam(withBeamVolume('IFCVOLUMEMEASURE(1.25)', '#13')).volumeIssue?.code).toBe(
      'unknown-unit',
    )
  })

  it('identifies missing project volume units when the property supplies none', () => {
    const text = withBeamVolume('IFCREAL(1.25)', '$').replace(
      '#16=IFCUNITASSIGNMENT((#13,#14,#15));',
      '#16=IFCUNITASSIGNMENT((#13,#14));',
    )
    const element = beam(text)
    expect(element.volume).toBeNull()
    expect(element.volumeIssue?.code).toBe('unknown-unit')
  })

  it('distinguishes explicit-versus-formatted unit conflicts from unsupported units', () => {
    const element = beam(withBeamVolume("IFCLABEL('1250000000 mm³')", '#15'))
    expect(element.volume).toBeNull()
    expect(element.volumeIssue?.code).toBe('conflicting-units')
    expect(element.volumeIssue?.value).toContain('1250000000')
  })

  it('identifies disagreeing normalized values at the winning occurrence priority', () => {
    const element = beam(
      append(source.replace('(#109,#110,#204)', '(#109,#110,#204,#205)'), [
        `#205=IFCPROPERTYSINGLEVALUE('${koreanVolume}',$,IFCVOLUMEMEASURE(2.5),#15);`,
      ]),
    )
    expect(element.volume).toBeNull()
    expect(element.volumeIssue?.code).toBe('conflicting-values')
    expect(element.volumeIssue?.source).toContain('Pset_DemoCommon')
  })

  it('attaches a type source to a type-only failure and prefers occurrence diagnostics', () => {
    const text = withColumnType(
      source
        .replace('(#77,#78,#202)', '(#77,#78)')
        .replace('IFCVOLUMEMEASURE(0.589048623),$);', "IFCLABEL('bad occurrence'),$);"),
      'IFCVOLUMEMEASURE(2.5)',
      '#13',
    )
    const elements = parse(text).elements
    const occurrence = elements.find((element) => element.expressId === 44)!
    const typeOnly = elements.find((element) => element.expressId === 76)!
    expect(occurrence.volumeIssue?.code).toBe('invalid-value')
    expect(occurrence.volumeIssue?.source).not.toMatch(/^Type\s*\//)
    expect(typeOnly.volumeIssue?.code).toBe('unknown-unit')
    expect(typeOnly.volumeIssue?.source).toContain('Type / ')
    expect(typeOnly.volumeIssue?.source).toContain('Revit Type Dimensions')
  })

  it('leaves no failure reason on valid zeroes, valid fallbacks or equal duplicate values', () => {
    const zero = beam(withBeamVolume('IFCVOLUMEMEASURE(0.)'))
    expect(zero.volume).toBe(0)
    expect(zero.volumeIssue).toBeUndefined()
    const fallback = parse(
      withColumnType(
        source.replace('IFCVOLUMEMEASURE(0.589048623),$);', "IFCLABEL('bad occurrence'),$);"),
        'IFCVOLUMEMEASURE(2.5)',
      ),
    ).elements.find((element) => element.expressId === 44)!
    expect(fallback.volume).toBe(2.5)
    expect(fallback.volumeIssue).toBeUndefined()
    const duplicate = beam(
      append(source.replace('(#109,#110,#204)', '(#109,#110,#204,#205)'), [
        `#205=IFCPROPERTYSINGLEVALUE('${koreanVolume}',$,IFCVOLUMEMEASURE(1250000000.),#119);`,
        '#119=IFCSIUNIT(*,.VOLUMEUNIT.,.MILLI.,.CUBIC_METRE.);',
      ]),
    )
    expect(duplicate.volume).toBeCloseTo(1.25, 8)
    expect(duplicate.volumeIssue).toBeUndefined()
    expect(parse().elements.every((element) => element.volumeIssue === undefined)).toBe(true)
  })

  it('reports a search limit rather than claiming a skipped volume property is absent', () => {
    const ordinary = Array.from(
      { length: MAX_IFC_PROPERTIES_PER_ELEMENT },
      (_, index) =>
        `#${1000 + index}=IFCPROPERTYSINGLEVALUE('Property ${index}',$,IFCLABEL('x'),$);`,
    )
    const refs = ordinary.map((_, index) => `#${1000 + index}`).join(',')
    const text = append(source.replace('(#109,#110,#204)', `(${refs},#204)`), ordinary)
    const element = beam(text)
    expect(element.volume).toBeNull()
    expect(element.volumeIssue?.code).toBe('property-limit')
    // The same display cap must not invalidate a volume already read safely.
    const known = beam(append(source.replace('(#109,#110,#204)', `(#204,${refs})`), ordinary))
    expect(known.volume).toBe(1.25)
    expect(known.volumeIssue).toBeUndefined()
  })

  it('reports an actual property read failure instead of inventing a missing-property cause', () => {
    const getLine = api.GetLine.bind(api)
    const spy = vi
      .spyOn(api, 'GetLine')
      .mockImplementation((...args: Parameters<IfcAPI['GetLine']>) => {
        if (args[1] === 204) throw new Error('Injected broken property reference')
        return getLine(...args)
      })
    try {
      const element = beam(source)
      expect(element.volume).toBeNull()
      expect(element.volumeIssue?.code).toBe('property-read-error')
    } finally {
      spy.mockRestore()
    }
  })

  it('bounds retained source, raw value and unit context independently of display text', () => {
    const text = append(
      withBeamVolume(`IFCLABEL('${'invalid '.repeat(100)}')`, '#119').replace(
        "'Pset_DemoCommon',$,(#109,#110,#204)",
        `'${'Source'.repeat(100)}',$,(#109,#110,#204)`,
      ),
      [`#119=IFCCONTEXTDEPENDENTUNIT($,.VOLUMEUNIT.,'${'Unit'.repeat(100)}');`],
    )
    const issue = beam(text).volumeIssue!
    expect(issue.code).toBe('invalid-value')
    expect(issue.source).toBeTruthy()
    expect(issue.value).toBeTruthy()
    expect(issue.source!.length).toBeLessThanOrEqual(260)
    expect(issue.value!.length).toBeLessThanOrEqual(160)
    expect(issue.unit?.length ?? 0).toBeLessThanOrEqual(120)
  })
})

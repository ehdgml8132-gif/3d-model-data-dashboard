/**
 * Independent fixture check using the official web-ifc WASM parser and mesher.
 * Run: node e2e/fixtures/validate-authored-ifc.mjs
 * This is a self-authored IFC4 example, not an export from Revit.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebIFC = require('web-ifc')
const api = new WebIFC.IfcAPI()
await api.Init()
const source = new URL('../../public/examples/authored-building.ifc', import.meta.url)
const csv = new URL('../../public/examples/authored-building-data.csv', import.meta.url)
const model = api.OpenModel(new Uint8Array(await readFile(source)), {
  COORDINATE_TO_ORIGIN: false,
  CIRCLE_SEGMENTS: 32,
})
assert.ok(model >= 0, 'official engine must open the authored IFC')

function lines(type) {
  const ids = api.GetLineIDsWithType(model, type, true)
  return Array.from({ length: ids.size() }, (_, index) => api.GetLine(model, ids.get(index)))
}

try {
  assert.equal(api.GetModelSchema(model), 'IFC4')
  const elements = lines(WebIFC.IFCELEMENT)
  assert.equal(elements.length, 5, 'five real IFC elements expected')
  assert.equal(lines(WebIFC.IFCBUILDINGSTOREY).length, 2)
  const globalIds = elements.map((element) => element.GlobalId.value)
  assert.equal(new Set(globalIds).size, 5)
  for (const id of globalIds) assert.match(id, /^[0-3][0-9A-Za-z_$]{21}$/)
  const column = elements.find((element) => element.GlobalId.value === '0nKbBzQJnGpBAXy9$4zESO')
  assert.ok(column)
  assert.equal(column.Tag.value, '0001', 'leading-zero tags are strings')

  const units = lines(WebIFC.IFCSIUNIT)
  assert.ok(
    units.some((unit) => unit.UnitType.value === 'LENGTHUNIT' && unit.Prefix?.value === 'MILLI'),
  )
  assert.ok(
    units.some(
      (unit) =>
        unit.UnitType.value === 'VOLUMEUNIT' &&
        unit.Name.value === 'CUBIC_METRE' &&
        unit.Prefix === null,
    ),
  )
  const quantities = lines(WebIFC.IFCQUANTITYVOLUME)
  assert.equal(quantities.length, 5)
  assert.equal(
    quantities.filter((quantity) => quantity.VolumeValue.value === 0.589048623).length,
    2,
  )
  assert.ok(quantities.some((quantity) => quantity.VolumeValue.value === 1.25))
  for (const quantity of quantities) {
    const unit = api.GetLine(model, quantity.Unit.value)
    assert.equal(unit.UnitType.value, 'VOLUMEUNIT')
    assert.equal(unit.Name.value, 'CUBIC_METRE')
  }
  assert.deepEqual(
    lines(WebIFC.IFCMATERIAL)
      .map((material) => material.Name.value)
      .sort(),
    ['Concrete C30/37', 'Structural Steel S355'],
  )
  assert.equal(
    lines(WebIFC.IFCPROPERTYSET).filter((pset) => pset.Name.value === 'Pset_DemoCommon').length,
    5,
  )
  const columnSets = await api.properties.getPropertySets(model, column.expressID, true)
  assert.ok(
    columnSets.some((pset) =>
      pset.HasProperties?.some(
        (prop) => prop.Name?.value === 'FireRating' && prop.NominalValue?.value === 'R120',
      ),
    ),
  )

  let meshCount = 0
  let triangles = 0
  let cylinderVertices = 0
  let cylinderBounds = null
  api.StreamAllMeshes(model, (mesh) => {
    meshCount += 1
    assert.ok(globalIds.includes(api.GetLine(model, mesh.expressID).GlobalId.value))
    for (let index = 0; index < mesh.geometries.size(); index += 1) {
      const placed = mesh.geometries.get(index)
      const geometry = api.GetGeometry(model, placed.geometryExpressID)
      try {
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize())
        const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize())
        assert.ok(vertices.length > 0 && indices.length > 0)
        assert.equal(indices.length % 3, 0)
        assert.ok([...vertices].every(Number.isFinite))
        triangles += indices.length / 3
        if (mesh.expressID === column.expressID) {
          cylinderVertices += vertices.length / 6
          const bounds = [
            [Infinity, -Infinity],
            [Infinity, -Infinity],
            [Infinity, -Infinity],
          ]
          const transform = placed.flatTransformation
          for (let vertex = 0; vertex < vertices.length; vertex += 6) {
            for (let axis = 0; axis < 3; axis += 1) {
              const coordinate =
                transform[axis] * vertices[vertex] +
                transform[axis + 4] * vertices[vertex + 1] +
                transform[axis + 8] * vertices[vertex + 2] +
                transform[axis + 12]
              bounds[axis][0] = Math.min(bounds[axis][0], coordinate)
              bounds[axis][1] = Math.max(bounds[axis][1], coordinate)
            }
          }
          cylinderBounds = bounds.map(([min, max]) => max - min)
        }
      } finally {
        geometry.delete()
      }
    }
  })
  assert.equal(meshCount, 5, 'official engine must produce each element mesh')
  assert.ok(
    cylinderVertices > 24,
    'round column must have circular geometry, not eight box corners',
  )
  // Source geometry buffers use millimetres; placed transforms include conversion to metres.
  assert.ok(cylinderBounds)
  const sortedCylinderBounds = [...cylinderBounds].sort((a, b) => a - b)
  assert.ok(Math.abs(sortedCylinderBounds[0] - 0.5) < 0.002)
  assert.ok(Math.abs(sortedCylinderBounds[1] - 0.5) < 0.002)
  assert.ok(Math.abs(sortedCylinderBounds[2] - 3) < 1e-6)
  const cylinderBBoxVolume = cylinderBounds.reduce((total, span) => total * span, 1)
  assert.ok(
    Math.abs(cylinderBBoxVolume - 0.75) < 0.005,
    'circle tessellation is close to the 0.75 m³ enclosing box',
  )
  assert.ok(
    Math.abs(cylinderBBoxVolume - 0.589048623) > 0.1,
    'declared quantity differs from bounding-box volume',
  )

  const rows = (await readFile(csv, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(','))
  assert.equal(rows.length, 6)
  assert.equal(rows[0][0], 'GlobalId')
  assert.deepEqual(
    rows
      .slice(1)
      .map((row) => row[0])
      .sort(),
    globalIds.sort(),
  )
  assert.equal(rows[1][1], '0001')
  // A valid derivative removes only the beam-to-Qto relation, preserving its actual geometry.
  const withoutBeamQuantity = (await readFile(source, 'utf8')).replace(
    /^#115=IFCRELDEFINESBYPROPERTIES[^\n]*\n/m,
    '',
  )
  const derivative = api.OpenModel(new TextEncoder().encode(withoutBeamQuantity))
  try {
    assert.ok(derivative >= 0)
    const beamSets = await api.properties.getPropertySets(derivative, 108, true)
    assert.ok(beamSets.some((pset) => pset.Name.value === 'Pset_DemoCommon'))
    assert.ok(!beamSets.some((pset) => pset.Name.value === 'Qto_DemoBaseQuantities'))
    let derivativeMeshCount = 0
    api.StreamAllMeshes(derivative, () => {
      derivativeMeshCount += 1
    })
    assert.equal(
      derivativeMeshCount,
      5,
      'missing declared quantity must not remove real beam geometry',
    )
  } finally {
    api.CloseModel(derivative)
  }
  console.log(
    JSON.stringify({
      schema: api.GetModelSchema(model),
      elements: elements.length,
      storeys: 2,
      meshCount,
      triangles,
      cylinderVertices,
      cylinderBoundsMetres: cylinderBounds,
      cylinderBBoxVolume,
      declaredCylinderVolume: 0.589048623,
      matchedCsvRows: rows.length - 1,
    }),
  )
} finally {
  api.CloseModel(model)
  api.Dispose()
}

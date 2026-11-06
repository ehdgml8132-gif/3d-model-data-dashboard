import * as WebIFC from 'web-ifc'
import {
  MAX_IFC_ELEMENTS,
  MAX_IFC_GEOMETRY_BYTES,
  MAX_IFC_MESHES,
  MAX_IFC_PROPERTIES_PER_ELEMENT,
  MAX_IFC_PROPERTY_TEXT,
} from './limits'
import type {
  IfcElement,
  IfcElementKind,
  IfcMesh,
  IfcModel,
  IfcProgress,
  IfcProperty,
} from './types'

// web-ifc's generated schema classes differ across IFC2X3 / IFC4 / IFC4X3.
// Values are read shallowly and only known relation/property references expanded.
type Line = Record<string, unknown> & { expressID?: number; type?: number }
type Unit = { factor: number; label: string; dimension: number }
type Volume = { value: number; priority: number }
type PropertySet = { properties: IfcProperty[]; volumes: Volume[] }
type Reporter = (progress: IfcProgress) => void

const prefixes: Record<string, number> = {
  EXA: 1e18,
  PETA: 1e15,
  TERA: 1e12,
  GIGA: 1e9,
  MEGA: 1e6,
  KILO: 1e3,
  HECTO: 1e2,
  DECA: 1e1,
  DECI: 1e-1,
  CENTI: 1e-2,
  MILLI: 1e-3,
  MICRO: 1e-6,
  NANO: 1e-9,
  PICO: 1e-12,
  FEMTO: 1e-15,
  ATTO: 1e-18,
}
const unitSymbols: Record<string, string> = {
  '': 'm',
  MILLI: 'mm',
  CENTI: 'cm',
  DECI: 'dm',
  KILO: 'km',
  MICRO: 'µm',
}
const classNames: Record<string, string> = Object.fromEntries(
  [
    'IfcColumn',
    'IfcColumnStandardCase',
    'IfcBeam',
    'IfcBeamStandardCase',
    'IfcSlab',
    'IfcSlabStandardCase',
    'IfcWall',
    'IfcWallStandardCase',
    'IfcWallElementedCase',
    'IfcDoor',
    'IfcWindow',
    'IfcRoof',
    'IfcFooting',
    'IfcPile',
    'IfcStair',
    'IfcStairFlight',
    'IfcRailing',
    'IfcBuildingElementProxy',
    'IfcSpace',
    'IfcElementAssembly',
    'IfcFurnishingElement',
    'IfcFurniture',
    'IfcPlate',
    'IfcMember',
    'IfcCovering',
  ].map((name) => [name.toUpperCase(), name]),
)

function scalar(value: unknown, depth = 0): string {
  if (value == null || depth > 7) return ''
  if (Array.isArray(value))
    return value
      .slice(0, 100)
      .map((item) => scalar(item, depth + 1))
      .join(', ')
  if (typeof value === 'object') {
    const object = value as Line
    if ('value' in object) return scalar(object.value, depth + 1)
    if ('Name' in object) return scalar(object.Name, depth + 1)
    return object.expressID ? `#${object.expressID}` : ''
  }
  return String(value)
}

function references(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(references)
  if (!value || typeof value !== 'object') return []
  const reference = value as Line
  if (reference.type === 5 && Number.isInteger(reference.value)) return [reference.value as number]
  if (Number.isInteger(reference.expressID)) return [reference.expressID as number]
  return Array.isArray(reference.value) ? references(reference.value) : []
}

function kindOf(name: string): IfcElementKind {
  const upper = name.toUpperCase()
  if (upper.startsWith('IFCCOLUMN')) return 'column'
  if (upper.startsWith('IFCBEAM')) return 'beam'
  if (upper.startsWith('IFCSLAB')) return 'slab'
  if (upper.startsWith('IFCWALL')) return 'wall'
  return 'other'
}

/** Extracts a fully owned JS snapshot; no WASM views survive model disposal. */
export function extractIfcModel(
  api: WebIFC.IfcAPI,
  modelId: number,
  name: string,
  report: Reporter = () => {},
): IfcModel {
  const warnings = new Set<string>()
  const lineCache = new Map<number, Line>()
  const line = (id: number): Line => {
    const cached = lineCache.get(id)
    if (cached) return cached
    const value = api.GetLine(modelId, id, false) as Line
    if (!value) throw new Error(`IFC 객체 #${id}를 읽지 못했습니다.`)
    if (lineCache.size < 150_000) lineCache.set(id, value)
    return value
  }
  const resolved = (value: unknown): Line | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const object = value as Line
    if (object.type === 5 && Number.isInteger(object.value)) return line(object.value as number)
    return object
  }
  const visitType = (type: number, callback: (item: Line) => void) => {
    const ids = api.GetLineIDsWithType(modelId, type, true)
    try {
      for (let i = 0; i < ids.size(); i++) callback(line(ids.get(i)))
    } finally {
      ;(ids as unknown as { delete?: () => void }).delete?.()
    }
  }
  const unitCache = new Map<number, Unit | undefined>()
  function readUnit(reference: unknown, visited = new Set<number>()): Unit | undefined {
    const item = resolved(reference)
    if (!item) return undefined
    const id = item.expressID
    if (id && unitCache.has(id)) return unitCache.get(id)
    if (id && visited.has(id)) return undefined
    if (id) visited.add(id)
    let answer: Unit | undefined
    const unitName = scalar(item.Name).toUpperCase()
    const prefix = scalar(item.Prefix).toUpperCase()
    const unitType = scalar(item.UnitType).toUpperCase()
    const dimension =
      unitType === 'LENGTHUNIT'
        ? 1
        : unitType === 'AREAUNIT'
          ? 2
          : unitType === 'VOLUMEUNIT'
            ? 3
            : 0
    const prefixScale = prefix ? prefixes[prefix] : 1
    if (
      dimension &&
      Number.isFinite(prefixScale) &&
      ['METRE', 'SQUARE_METRE', 'CUBIC_METRE'].includes(unitName)
    ) {
      const power = unitName === 'METRE' ? 1 : unitName === 'SQUARE_METRE' ? 2 : 3
      if (power === dimension)
        answer = {
          factor: prefixScale ** power,
          dimension,
          label: `${unitSymbols[prefix] || `${prefix.toLowerCase()} metre`}${power === 1 ? '' : power === 2 ? '²' : '³'}`,
        }
    } else if (item.ConversionFactor && dimension) {
      const conversion = resolved(item.ConversionFactor)
      const component = readUnit(conversion?.UnitComponent, new Set(visited))
      const multiplier = Number(scalar(conversion?.ValueComponent))
      if (
        component?.dimension === dimension &&
        Number.isFinite(multiplier) &&
        multiplier > 0 &&
        !item.ConversionOffset
      ) {
        answer = { dimension, factor: multiplier * component.factor, label: scalar(item.Name) }
      }
    } else if (Array.isArray(item.Elements)) {
      let factor = 1
      let exponent = 0
      let valid = true
      for (const ref of item.Elements) {
        const component = resolved(ref)
        const unit = readUnit(component?.Unit, new Set(visited))
        const power = Number(scalar(component?.Exponent))
        if (!unit || !Number.isFinite(power)) {
          valid = false
          break
        }
        factor *= unit.factor ** power
        exponent += unit.dimension * power
      }
      if (valid && exponent === 3 && Number.isFinite(factor))
        answer = { dimension: 3, factor, label: 'IFC 체적 단위' }
    }
    if (id) unitCache.set(id, answer)
    return answer
  }

  const lengthUnits: Unit[] = []
  const volumeUnits: Unit[] = []
  const displayUnits = new Map<string, Set<string>>()
  function unitLabel(reference: unknown): string {
    const unit = resolved(reference)
    if (!unit) return ''
    const normalized = readUnit(reference)
    if (normalized) return normalized.label
    return [scalar(unit.Prefix), scalar(unit.Name)].filter(Boolean).join(' ')
  }
  visitType(WebIFC.IFCPROJECT, (project) => {
    const assignment = resolved(project.UnitsInContext)
    for (const reference of (assignment?.Units as unknown[] | undefined) || []) {
      const unit = readUnit(reference)
      if (unit?.dimension === 1) lengthUnits.push(unit)
      if (unit?.dimension === 3) volumeUnits.push(unit)
      const type = scalar(resolved(reference)?.UnitType)
      const label = unitLabel(reference)
      if (type && label) {
        const labels = displayUnits.get(type) || new Set<string>()
        labels.add(label)
        displayUnits.set(type, labels)
      }
    }
  })
  const uniqueUnit = (units: Unit[]) =>
    units.length && units.every((unit) => unit.factor === units[0].factor) ? units[0] : undefined
  const lengthUnit = uniqueUnit(lengthUnits)
  const volumeUnit = uniqueUnit(volumeUnits)
  const defaultUnitLabel = (type: string) => {
    const labels = displayUnits.get(type)
    return labels?.size === 1 ? [...labels][0] : ''
  }
  if (!lengthUnit)
    warnings.add(
      'IFC 프로젝트의 길이 단위를 확인하지 못했습니다. 형상은 web-ifc의 미터 좌표로 표시합니다.',
    )

  report({ percent: 18, message: '실제 IFC 형상을 변환합니다.' })
  const meshes: IfcMesh[] = []
  const geometryCache = new Map<number, Pick<IfcMesh, 'positions' | 'normals' | 'indices'>>()
  const elements: IfcElement[] = []
  const elementById = new Map<number, IfcElement>()
  let geometryBytes = 0
  let failedGeometry = 0
  let geometryFailure: Error | undefined
  api.StreamAllMeshes(modelId, (mesh, index, total) => {
    try {
      if (geometryFailure) return
      let item: Line
      try {
        item = line(mesh.expressID)
      } catch {
        failedGeometry++
        return
      }
      const rawClass = api.GetNameFromTypeCode(item.type || 0) || 'IFCELEMENT'
      if (rawClass.toUpperCase() === 'IFCOPENINGELEMENT') return
      const ifcClass = classNames[rawClass.toUpperCase()] || rawClass
      const elementId = `IFC-${mesh.expressID}`
      for (let i = 0; i < mesh.geometries.size(); i++) {
        if (geometryFailure) break
        const placed = mesh.geometries.get(i)
        let geometry: ReturnType<WebIFC.IfcAPI['GetGeometry']> | undefined
        try {
          if (
            meshes.length >= MAX_IFC_MESHES ||
            (!elementById.has(mesh.expressID) && elements.length >= MAX_IFC_ELEMENTS)
          ) {
            geometryFailure = new Error(
              'IFC 형상이 브라우저 처리 한도를 초과했습니다. 건물을 층·분야별로 나누어 내보내 주세요. (형상 240 MB, 부재 50,000개 한도)',
            )
            break
          }
          const matrix = Array.from(placed.flatTransformation)
          if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value)))
            throw new Error('IFC 배치 좌표가 올바르지 않습니다.')
          let buffers = geometryCache.get(placed.geometryExpressID)
          if (!buffers) {
            geometry = api.GetGeometry(modelId, placed.geometryExpressID)
            const vertexData = api.GetVertexArray(
              geometry.GetVertexData(),
              geometry.GetVertexDataSize(),
            )
            const indexData = api.GetIndexArray(
              geometry.GetIndexData(),
              geometry.GetIndexDataSize(),
            )
            if (!vertexData.length || !indexData.length) continue
            const vertexCount = vertexData.length / 6
            if (!Number.isInteger(vertexCount) || indexData.length % 3)
              throw new Error('IFC 삼각형 형상 데이터가 올바르지 않습니다.')
            const bytes = vertexData.byteLength + indexData.byteLength
            if (geometryBytes + bytes > MAX_IFC_GEOMETRY_BYTES) {
              geometryFailure = new Error(
                'IFC 형상이 브라우저 처리 한도 240 MB를 초과했습니다. 건물을 층·분야별로 나누어 내보내 주세요.',
              )
              break
            }
            const positions = new Float32Array(vertexCount * 3)
            const normals = new Float32Array(vertexCount * 3)
            for (let vertex = 0; vertex < vertexCount; vertex++) {
              for (let axis = 0; axis < 3; axis++) {
                const value = vertexData[vertex * 6 + axis]
                const normal = vertexData[vertex * 6 + 3 + axis]
                if (!Number.isFinite(value) || !Number.isFinite(normal))
                  throw new Error('IFC 형상에 유효하지 않은 좌표가 있습니다.')
                positions[vertex * 3 + axis] = value
                normals[vertex * 3 + axis] = normal
              }
            }
            const indices = new Uint32Array(indexData)
            for (const index of indices)
              if (index >= vertexCount) throw new Error('IFC 형상의 인덱스가 올바르지 않습니다.')
            buffers = { positions, normals, indices }
            geometryCache.set(placed.geometryExpressID, buffers)
            geometryBytes += bytes
          }
          const color = placed.color
          const rgba = [color.x, color.y, color.z, color.w].map((value, channel) =>
            Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : channel === 3 ? 1 : 0.7,
          ) as [number, number, number, number]
          meshes.push({ elementId, ...buffers, color: rgba, matrix })
          if (!elementById.has(mesh.expressID)) {
            const element: IfcElement = {
              id: elementId,
              expressId: mesh.expressID,
              globalId: scalar(item.GlobalId),
              name: scalar(item.Name) || ifcClass,
              ifcClass,
              tag: scalar(item.Tag),
              kind: kindOf(ifcClass),
              floor: '미지정',
              material: '미지정',
              volume: null,
              properties: [],
            }
            elementById.set(mesh.expressID, element)
            elements.push(element)
          }
        } catch {
          failedGeometry++
        } finally {
          geometry?.delete()
        }
      }
      if (index % 100 === 0)
        report({
          percent: 18 + Math.floor((index / Math.max(total, 1)) * 52),
          message: `${elements.length.toLocaleString()}개 부재의 형상을 읽었습니다.`,
        })
    } finally {
      // Streamed FlatMesh is a JS value object, but its geometry vector owns a WASM handle.
      ;(mesh.geometries as unknown as { delete?: () => void }).delete?.()
    }
  })
  if (geometryFailure) throw geometryFailure
  if (!meshes.length)
    throw new Error(
      '표시할 수 있는 IFC 형상이 없습니다. Revit에서 3D 형상을 포함하여 IFC로 내보내 주세요.',
    )
  if (failedGeometry)
    warnings.add(
      `${failedGeometry.toLocaleString()}개 형상을 읽지 못했습니다. 일부 부재가 표시되지 않을 수 있습니다.`,
    )

  report({ percent: 72, message: '층·재료·속성집합 연결을 읽습니다.' })
  const containment = new Map<number, number[]>()
  const parents = new Map<number, number[]>()
  const sets = new Map<number, number[]>()
  const types = new Map<number, number[]>()
  const materials = new Map<number, number[]>()
  function relationIndex(
    type: number,
    relatedKey: string,
    relatingKey: string,
    index: Map<number, number[]>,
  ) {
    visitType(type, (relation) => {
      const definitions = references(relation[relatingKey])
      for (const id of references(relation[relatedKey])) {
        const existing = index.get(id) || []
        index.set(id, [...new Set([...existing, ...definitions])])
      }
    })
  }
  relationIndex(
    WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE,
    'RelatedElements',
    'RelatingStructure',
    containment,
  )
  relationIndex(WebIFC.IFCRELAGGREGATES, 'RelatedObjects', 'RelatingObject', parents)
  relationIndex(WebIFC.IFCRELNESTS, 'RelatedObjects', 'RelatingObject', parents)
  relationIndex(
    WebIFC.IFCRELDEFINESBYPROPERTIES,
    'RelatedObjects',
    'RelatingPropertyDefinition',
    sets,
  )
  relationIndex(WebIFC.IFCRELDEFINESBYTYPE, 'RelatedObjects', 'RelatingType', types)
  relationIndex(WebIFC.IFCRELASSOCIATESMATERIAL, 'RelatedObjects', 'RelatingMaterial', materials)

  function floorOf(id: number, visited = new Set<number>()): string[] {
    if (visited.size > 50 || visited.has(id)) return []
    visited.add(id)
    const item = line(id)
    if (item.type === WebIFC.IFCBUILDINGSTOREY) return [scalar(item.Name) || `층 #${id}`]
    return [
      ...new Set(
        [...(containment.get(id) || []), ...(parents.get(id) || [])].flatMap((parent) =>
          floorOf(parent, new Set(visited)),
        ),
      ),
    ]
  }
  const materialCache = new Map<number, string[]>()
  function materialNames(id: number, visited = new Set<number>()): string[] {
    if (visited.has(id) || visited.size > 30) return []
    if (materialCache.has(id)) return materialCache.get(id) as string[]
    visited.add(id)
    const item = line(id)
    if (item.type === WebIFC.IFCMATERIAL) return scalar(item.Name) ? [scalar(item.Name)] : []
    const childKeys = [
      'Material',
      'Materials',
      'ForLayerSet',
      'MaterialLayers',
      'ForProfileSet',
      'MaterialProfiles',
      'MaterialConstituents',
    ]
    const names = [
      ...new Set(
        childKeys
          .flatMap((key) => references(item[key]))
          .flatMap((child) => materialNames(child, new Set(visited))),
      ),
    ]
    materialCache.set(id, names)
    return names
  }

  let propertyText = 0
  let cachedPropertyText = 0
  let propertiesCapped = false
  let missingVolumeUnit = false
  const setCache = new Map<number, PropertySet>()
  function readSet(id: number): PropertySet {
    const cached = setCache.get(id)
    if (cached) return cached
    const item = line(id)
    const result: PropertySet = { properties: [], volumes: [] }
    const group = scalar(item.Name) || 'IFC 속성집합'
    function property(reference: unknown, path = '', depth = 0) {
      if (depth > 8 || result.properties.length >= MAX_IFC_PROPERTIES_PER_ELEMENT) {
        propertiesCapped = true
        return
      }
      const prop = resolved(reference)
      if (!prop) return
      const name = path + (scalar(prop.Name) || '속성')
      const nested = prop.HasProperties || prop.HasQuantities
      if (Array.isArray(nested)) {
        for (const child of nested) property(child, `${name} / `, depth + 1)
        return
      }
      const explicitUnit = prop.Unit ? readUnit(prop.Unit) : undefined
      let propertyUnitLabel = prop.Unit ? unitLabel(prop.Unit) : ''
      if (prop.VolumeValue != null) {
        const raw = Number(scalar(prop.VolumeValue))
        const unit = prop.Unit ? explicitUnit : volumeUnit
        propertyUnitLabel = unit?.label || propertyUnitLabel
        if (unit?.dimension === 3 && Number.isFinite(raw) && raw >= 0) {
          const normalizedName = scalar(prop.Name).replace(/[ _-]/g, '').toLowerCase()
          const priority =
            normalizedName === 'netvolume' ? 0 : normalizedName === 'grossvolume' ? 1 : 2
          const value = raw * unit.factor
          if (Number.isFinite(value)) result.volumes.push({ value, priority })
        } else missingVolumeUnit = true
      } else if (!prop.Unit) {
        const nominalType = scalar((prop.NominalValue as Line | undefined)?.name)
        const unitType =
          prop.LengthValue != null || /LENGTHMEASURE$/.test(nominalType)
            ? 'LENGTHUNIT'
            : prop.AreaValue != null || nominalType === 'IFCAREAMEASURE'
              ? 'AREAUNIT'
              : prop.WeightValue != null || nominalType === 'IFCMASSMEASURE'
                ? 'MASSUNIT'
                : nominalType === 'IFCVOLUMEMEASURE'
                  ? 'VOLUMEUNIT'
                  : prop.TimeValue != null || nominalType === 'IFCTIMEMEASURE'
                    ? 'TIMEUNIT'
                    : nominalType === 'IFCPLANEANGLEMEASURE'
                      ? 'PLANEANGLEUNIT'
                      : ''
        propertyUnitLabel = defaultUnitLabel(unitType)
      }
      const add = (label: string, value: unknown) => {
        const raw = scalar(value)
        if (!raw) return
        const display = `${raw.slice(0, 4000)}${propertyUnitLabel ? ` ${propertyUnitLabel}` : ''}`
        if (raw.length > 4000) propertiesCapped = true
        const size = group.length + label.length + display.length
        if (
          result.properties.length >= MAX_IFC_PROPERTIES_PER_ELEMENT ||
          cachedPropertyText + size > MAX_IFC_PROPERTY_TEXT
        ) {
          propertiesCapped = true
          return
        }
        cachedPropertyText += size
        result.properties.push({ group, name: label, value: display })
      }
      if (prop.NominalValue != null) add(name, prop.NominalValue)
      else if (prop.EnumerationValues != null) add(name, prop.EnumerationValues)
      else if (prop.ListValues != null) add(name, prop.ListValues)
      else if (
        prop.LowerBoundValue != null ||
        prop.UpperBoundValue != null ||
        prop.SetPointValue != null
      ) {
        add(`${name} / Lower`, prop.LowerBoundValue)
        add(`${name} / Upper`, prop.UpperBoundValue)
        add(`${name} / Set point`, prop.SetPointValue)
      } else if (prop.DefiningValues != null || prop.DefinedValues != null) {
        add(`${name} / Defining`, prop.DefiningValues)
        add(`${name} / Defined`, prop.DefinedValues)
      } else {
        const valueKeys = Object.keys(prop).filter((key) => key.endsWith('Value'))
        for (const key of valueKeys) add(name, prop[key])
        if (!valueKeys.length) add(name, prop.Description || prop.PropertyReference)
      }
    }
    for (const ref of (item.HasProperties || item.Quantities || []) as unknown[]) property(ref)
    setCache.set(id, result)
    return result
  }

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]
    try {
      const item = line(element.expressId)
      const floorNames = [...new Set(floorOf(element.expressId))]
      element.floor = floorNames.length ? floorNames.join(' / ') : '미지정'
      const typeIds = types.get(element.expressId) || []
      const materialIds = [
        ...(materials.get(element.expressId) || []),
        ...typeIds.flatMap((id) => materials.get(id) || []),
      ]
      const names = [...new Set(materialIds.flatMap((id) => materialNames(id)))]
      element.material = names.length ? names.join(', ') : '미지정'
      const attributes = ['Name', 'Description', 'ObjectType', 'PredefinedType', 'Tag', 'GlobalId']
      const properties: IfcProperty[] = []
      const addProperty = (property: IfcProperty) => {
        const textLength = property.name.length + property.value.length + property.group.length
        if (
          properties.length >= MAX_IFC_PROPERTIES_PER_ELEMENT ||
          propertyText + textLength > MAX_IFC_PROPERTY_TEXT
        ) {
          propertiesCapped = true
          return
        }
        propertyText += textLength
        properties.push(property)
      }
      for (const key of attributes) {
        const value = scalar(item[key])
        if (value) addProperty({ group: 'IFC Attributes', name: key, value: value.slice(0, 4000) })
      }
      const volumeCandidates: Volume[] = []
      const sourceSets: { id: number; prefix: string; type: boolean }[] = []
      for (const id of sets.get(element.expressId) || [])
        sourceSets.push({ id, prefix: '', type: false })
      for (const typeId of typeIds) {
        const type = line(typeId)
        if (scalar(type.Name))
          addProperty({ group: 'IFC Type', name: 'Name', value: scalar(type.Name).slice(0, 4000) })
        for (const id of references(type.HasPropertySets))
          sourceSets.push({ id, prefix: 'Type / ', type: true })
      }
      const seenSets = new Set<number>()
      for (const source of sourceSets) {
        if (seenSets.has(source.id)) continue
        seenSets.add(source.id)
        const set = readSet(source.id)
        for (const property of set.properties) {
          addProperty({ ...property, group: source.prefix + property.group })
        }
        // A type quantity describes its type; an occurrence quantity takes precedence.
        for (const volume of set.volumes)
          volumeCandidates.push({ ...volume, priority: volume.priority + (source.type ? 10 : 0) })
      }
      element.properties = properties
      volumeCandidates.sort((a, b) => a.priority - b.priority)
      const best = volumeCandidates[0]
      if (best) {
        const peers = volumeCandidates.filter((volume) => volume.priority === best.priority)
        if (
          peers.every(
            (volume) =>
              Math.abs(volume.value - best.value) < Math.max(1e-9, Math.abs(best.value) * 1e-8),
          )
        )
          element.volume = best.value
        else
          warnings.add(
            '동일 부재에 서로 다른 체적 수량이 있어 해당 체적을 미지정으로 표시했습니다.',
          )
      }
    } catch {
      warnings.add('일부 부재의 층·재료·속성을 완전히 읽지 못했습니다.')
    }
    if (i % 100 === 0)
      report({
        percent: 75 + Math.floor((i / elements.length) * 23),
        message: `${(i + 1).toLocaleString()} / ${elements.length.toLocaleString()}개 부재의 속성을 읽었습니다.`,
      })
  }
  if (propertiesCapped)
    warnings.add(
      '속성 표시 한도를 초과하여 일부 속성·긴 값을 생략했습니다. (부재당 500개, 속성 텍스트 40 MB)',
    )
  if (missingVolumeUnit)
    warnings.add('단위를 확인할 수 없는 IFC 체적 수량은 미지정으로 표시했습니다.')
  if (elements.some((element) => element.volume === null))
    warnings.add('체적은 IFC에 내보낸 수량만 사용합니다. 수량이 없는 부재는 미지정으로 표시됩니다.')
  return {
    source: 'ifc',
    name,
    elements,
    meshes,
    lengthUnit: lengthUnit?.label || '알 수 없음',
    warnings: [...warnings],
  }
}

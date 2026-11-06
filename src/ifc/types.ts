export type IfcElementKind = 'column' | 'beam' | 'slab' | 'wall' | 'other'

export type IfcProperty = { group: string; name: string; value: string }

export type IfcElement = {
  id: string
  expressId: number
  globalId: string
  name: string
  ifcClass: string
  tag: string
  kind: IfcElementKind
  floor: string
  material: string
  /** Exported IFC volume quantity in m³; null when absent or its unit is unknown. */
  volume: number | null
  properties: IfcProperty[]
}

/** Raw web-ifc buffers; applying the column-major placement once yields metres, Y-up.
 * Local position buffers can retain source units; the matrix includes unit scaling.
 */
export type IfcMesh = {
  elementId: string
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  color: [number, number, number, number]
  matrix: number[]
}

export type IfcModel = {
  source: 'ifc'
  name: string
  elements: IfcElement[]
  meshes: IfcMesh[]
  /** Original project's length unit. Geometry and volume are normalized separately. */
  lengthUnit: string
  warnings: string[]
}

export type IfcProgress = { percent: number; message: string }

export type IfcWorkerRequest = { file: File; wasmPath: string }
export type IfcWorkerResponse =
  | { type: 'progress'; progress: IfcProgress }
  | { type: 'complete'; model: IfcModel }
  | { type: 'error'; message: string }

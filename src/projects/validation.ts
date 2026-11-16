import { MAX_IFC_ELEMENTS, MAX_IFC_FILE_BYTES } from '../ifc/limits'
import { BUSINESS_LIMITS } from '../lib/business'
import type { BuildingMetricFilters } from '../lib/buildingFilters'
import type { SectionBoxSettings } from '../lib/sectionBox'
import type { ProjectBusiness, ProjectCamera, ProjectWorkspace, SavedProject } from './types'

export const MAX_PROJECT_METADATA_BYTES = 64 * 1024 * 1024
const kinds = ['all', 'column', 'beam', 'slab', 'wall', 'other'] as const
const memberKinds = new Set<string>(kinds.slice(1))

function fail(label: string): never {
  throw new Error(`프로젝트의 ${label} 정보가 올바르지 않습니다.`)
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label)
  return value as Record<string, unknown>
}
function numeric(value: unknown, label: string, min = 0, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(label)
  return value
}

/** Normalize only the documented schema. Unknown object fields are not retained,
 * and arbitrary project files cannot introduce Maps, prototypes or executable values.
 */
export function validateSavedProject(input: unknown): SavedProject {
  let stringBytes = 0
  const text = (value: unknown, label: string, max = MAX_PROJECT_METADATA_BYTES, empty = false) => {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(label)
    // Bound JSON string expansion before JSON.stringify allocates a manifest.
    // This counts escaped controls and UTF-8 without allocating one buffer per cell.
    let bytes = 2
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2
      else if (code < 32) bytes += 6
      else if (code < 128) bytes++
      else if (code < 2048) bytes += 2
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4
          index++
        } else bytes += 6
      } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6
      else bytes += 3
    }
    stringBytes += bytes
    if (stringBytes > MAX_PROJECT_METADATA_BYTES)
      throw new Error('프로젝트의 업무 데이터와 화면 정보는 64MB 이하로 저장해 주세요.')
    return value
  }
  const date = (value: unknown, label: string) => {
    const result = text(value, label, 40)
    const timestamp = Date.parse(result)
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== result) fail(label)
    return result
  }
  const identifier = (value: unknown, label: string, max = 1024, empty = false) => {
    const result = text(value, label, max, empty)
    if (/[\u0000-\u001f\u007f]/u.test(result)) fail(label)
    return result
  }
  const boolean = (value: unknown, label: string): boolean => {
    if (typeof value !== 'boolean') fail(label)
    return value
  }
  const stringSelection = (value: unknown, label: string): string[] | null => {
    if (value === null) return null
    if (!Array.isArray(value) || value.length > MAX_IFC_ELEMENTS) fail(label)
    const values = value.map((item) => text(item, label))
    if (new Set(values).size !== values.length) fail(label)
    return values
  }
  const root = object(input, '파일')
  if (root.version !== 1)
    throw new Error('지원하지 않는 프로젝트 버전입니다. 앱을 업데이트해 주세요.')
  const snapshot = object(root.snapshot, '저장 내용')
  const file = snapshot.ifcFile
  if (
    typeof File === 'undefined' ||
    !(file instanceof File) ||
    !/\.ifc$/i.test(file.name) ||
    !file.size ||
    file.size > MAX_IFC_FILE_BYTES ||
    !Number.isSafeInteger(file.lastModified) ||
    file.lastModified < 0
  )
    throw new Error('프로젝트에는 비어 있지 않은 150MB 이하의 IFC 원본 파일이 필요합니다.')
  text(file.name, 'IFC 파일 이름', 1024)
  const elementCount = numeric(snapshot.elementCount, '부재 수', 1, MAX_IFC_ELEMENTS)
  if (!Number.isInteger(elementCount)) fail('부재 수')

  const view = object(snapshot.workspace, '화면')
  if (view.activeView !== 'space' && view.activeView !== 'data') fail('화면 종류')
  if (!kinds.includes(view.kind as (typeof kinds)[number])) fail('부재 종류')
  const query = text(view.query, '검색어', 4096, true)
  const selectedId = identifier(view.selectedId, '선택 부재', 1024, true)
  const tablePage = numeric(view.tablePage, '목록 페이지', 0, 250)
  if (!Number.isInteger(tablePage)) fail('목록 페이지')

  const rawFilters = object(view.metricFilters, '카드 필터')
  const rawVolume = object(rawFilters.volume, '체적 필터')
  const bound = (value: unknown, label: string) => (value === null ? null : numeric(value, label))
  const minimum = bound(rawVolume.min, '최소 체적')
  const maximum = bound(rawVolume.max, '최대 체적')
  if (minimum !== null && maximum !== null && minimum > maximum) fail('체적 범위')
  const metricFilters: BuildingMetricFilters = {
    kinds: stringSelection(rawFilters.kinds, '부재 종류 필터'),
    elementIds: stringSelection(rawFilters.elementIds, '개별 부재 필터'),
    floors: stringSelection(rawFilters.floors, '층 필터'),
    materials: stringSelection(rawFilters.materials, '재료 필터'),
    volume: {
      min: minimum,
      max: maximum,
      includeUnknown: boolean(rawVolume.includeUnknown, '체적 미확인 포함'),
    },
  }
  if (metricFilters.kinds?.some((kind) => !memberKinds.has(kind))) fail('부재 종류 필터')

  let sectionBox: SectionBoxSettings | null = null
  if (view.sectionBox !== null) {
    const section = object(view.sectionBox, '단면상자')
    const ranges = object(section.ranges, '단면 범위')
    const readRange = (value: unknown): [number, number] => {
      if (!Array.isArray(value) || value.length !== 2) fail('단면 범위')
      const min = numeric(value[0], '단면 최소값', 0, 100)
      const max = numeric(value[1], '단면 최대값', 0, 100)
      if (max - min < 1) fail('단면 범위')
      return [min, max]
    }
    sectionBox = {
      targetId: section.targetId === null ? null : identifier(section.targetId, '단면 기준 부재'),
      ranges: { x: readRange(ranges.x), y: readRange(ranges.y), z: readRange(ranges.z) },
    }
  }

  let camera: ProjectCamera | null = null
  if (view.camera !== null) {
    const rawCamera = object(view.camera, '시점')
    const vector = (value: unknown): [number, number, number] => {
      if (!Array.isArray(value) || value.length !== 3) fail('시점 좌표')
      return value.map((item) => numeric(item, '시점 좌표', -1e12, 1e12)) as [
        number,
        number,
        number,
      ]
    }
    const viewport = rawCamera.viewport
    if (!Array.isArray(viewport) || viewport.length !== 2) fail('시점 화면 크기')
    camera = {
      position: vector(rawCamera.position),
      target: vector(rawCamera.target),
      zoom: numeric(rawCamera.zoom, '시점 확대', Number.MIN_VALUE, 1e12),
      viewport: [
        numeric(viewport[0], '화면 너비', 1, 100_000),
        numeric(viewport[1], '화면 높이', 1, 100_000),
      ],
    }
    if (camera.position.every((coordinate, index) => coordinate === camera!.target[index]))
      fail('시점 방향')
  }

  let business: ProjectBusiness | null = null
  if (snapshot.business !== null) {
    const rawBusiness = object(snapshot.business, '업무 데이터')
    const rawTable = object(rawBusiness.table, '업무 표')
    if (
      !Array.isArray(rawTable.headers) ||
      !rawTable.headers.length ||
      rawTable.headers.length > BUSINESS_LIMITS.columns ||
      !Array.isArray(rawTable.rows) ||
      !rawTable.rows.length ||
      rawTable.rows.length > BUSINESS_LIMITS.rows ||
      (rawTable.rows.length + 1) * rawTable.headers.length > BUSINESS_LIMITS.cells
    )
      fail('업무 표 크기')
    const headers = rawTable.headers.map((header) => text(header, '업무 열 이름'))
    if (
      headers.some((header) => header !== header.trim()) ||
      new Set(headers).size !== headers.length
    )
      fail('업무 열 이름')
    const rows = rawTable.rows.map((row) => {
      if (!Array.isArray(row) || row.length !== headers.length) fail('업무 행')
      return row.map((cell) => text(cell, '업무 값', MAX_PROJECT_METADATA_BYTES, true))
    })
    const column = text(rawBusiness.column, '업무 연결 열')
    if (!headers.includes(column)) fail('업무 연결 열')
    if (!['globalId', 'tag', 'id'].includes(rawBusiness.modelKey as string)) fail('업무 연결 키')
    business = {
      fileName: text(rawBusiness.fileName, '업무 파일 이름', 1024),
      modelKey: rawBusiness.modelKey as ProjectBusiness['modelKey'],
      column,
      table: { name: text(rawTable.name, '업무 시트 이름'), headers, rows },
    }
  }

  const workspace: ProjectWorkspace = {
    activeView: view.activeView,
    kind: view.kind as ProjectWorkspace['kind'],
    metricFilters,
    query,
    selectedId,
    sectionBox,
    camera,
    tablePage,
  }
  const record: SavedProject = {
    version: 1,
    id: identifier(root.id, '식별자', 128),
    name: text(root.name, '이름', 120),
    createdAt: date(root.createdAt, '생성 시각'),
    updatedAt: date(root.updatedAt, '수정 시각'),
    snapshot: { ifcFile: file, elementCount, business, workspace },
  }
  const metadata = {
    ...record,
    snapshot: {
      ...record.snapshot,
      ifcFile: { name: file.name, size: file.size, lastModified: file.lastModified },
    },
  }
  if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > MAX_PROJECT_METADATA_BYTES)
    throw new Error('프로젝트의 업무 데이터와 화면 정보는 64MB 이하로 저장해 주세요.')
  return record
}

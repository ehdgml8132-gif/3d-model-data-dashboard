import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_IFC_ELEMENTS, MAX_IFC_FILE_BYTES } from '../ifc/limits'
import { BUSINESS_LIMITS, parseBusinessCsv } from '../lib/business'
import { createBuildingMetricFilters } from '../lib/buildingFilters'
import { fullSectionRanges } from '../lib/sectionBox'
import { buildProjectRecord, listProjects, summarizeProject, writeProject } from './storage'
import type { SavedProject } from './types'
import { validateSavedProject } from './validation'

function project(): SavedProject {
  return {
    version: 1,
    id: 'project-1',
    name: '서울 현장',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    snapshot: {
      ifcFile: new File(['ISO-10303-21;'], '구조.ifc', { lastModified: 0 }),
      elementCount: 20,
      business: {
        fileName: '진행표.csv',
        table: { name: '진행표', headers: ['번호', '상태'], rows: [['0001', '완료']] },
        modelKey: 'tag',
        column: '번호',
      },
      workspace: {
        activeView: 'space',
        metricFilters: createBuildingMetricFilters(),
        kind: 'all',
        query: '',
        selectedId: '',
        sectionBox: null,
        camera: null,
        tablePage: 0,
      },
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('project records and validation', () => {
  it('copies mutable state for saving, keeps IFC bytes, and preserves checkbox null/none meanings', () => {
    const source = project()
    source.snapshot.workspace.metricFilters.kinds = []
    source.snapshot.workspace.metricFilters.floors = ['1층']
    const saved = validateSavedProject(source)
    source.snapshot.workspace.metricFilters.floors.push('2층')
    source.snapshot.business!.table.rows[0][0] = 'changed'
    expect(saved.snapshot.ifcFile).toBe(source.snapshot.ifcFile)
    expect(saved.snapshot.workspace.metricFilters).toMatchObject({
      kinds: [],
      floors: ['1층'],
      materials: null,
    })
    expect(saved.snapshot.business?.table.rows[0][0]).toBe('0001')
  })

  it('creates distinct Save As IDs and retains identity/creation date for overwrite', () => {
    const source = project()
    const first = buildProjectRecord('  서울 현장  ', source.snapshot)
    const copy = buildProjectRecord('복사본', source.snapshot)
    expect(first.name).toBe('서울 현장')
    expect(first.id).not.toBe(copy.id)
    const updated = buildProjectRecord('수정본', source.snapshot, source)
    expect(updated.id).toBe(source.id)
    expect(updated.createdAt).toBe(source.createdAt)
    expect(updated.updatedAt).not.toBe(source.updatedAt)
    expect(summarizeProject(updated)).toEqual({
      id: source.id,
      name: '수정본',
      createdAt: source.createdAt,
      updatedAt: updated.updatedAt,
      ifcName: '구조.ifc',
      ifcBytes: source.snapshot.ifcFile.size,
      elementCount: 20,
    })
  })

  it.each([
    ['빈 IFC', (record: SavedProject) => (record.snapshot.ifcFile = new File([], 'model.ifc'))],
    ['IFC 확장자', (record: SavedProject) => (record.snapshot.ifcFile = new File(['a'], 'a.txt'))],
    [
      'IFC 크기',
      (record: SavedProject) =>
        Object.defineProperty(record.snapshot.ifcFile, 'size', { value: MAX_IFC_FILE_BYTES + 1 }),
    ],
    ['부재 수', (record: SavedProject) => (record.snapshot.elementCount = MAX_IFC_ELEMENTS + 1)],
    ['검색어 길이', (record: SavedProject) => (record.snapshot.workspace.query = 'x'.repeat(4097))],
    ['선택 식별자', (record: SavedProject) => (record.snapshot.workspace.selectedId = 'a\u0000b')],
    ['날짜', (record: SavedProject) => (record.createdAt = '1')],
    [
      '중복 필터',
      (record: SavedProject) => (record.snapshot.workspace.metricFilters.floors = ['1', '1']),
    ],
    [
      '종류 필터',
      (record: SavedProject) => (record.snapshot.workspace.metricFilters.kinds = ['invalid']),
    ],
    [
      '체적 역전',
      (record: SavedProject) =>
        (record.snapshot.workspace.metricFilters.volume = { min: 2, max: 1, includeUnknown: true }),
    ],
    [
      '음수 체적',
      (record: SavedProject) => (record.snapshot.workspace.metricFilters.volume.min = -1),
    ],
    [
      '무한 체적',
      (record: SavedProject) => (record.snapshot.workspace.metricFilters.volume.max = Infinity),
    ],
  ])('rejects invalid %s before writing', (_, mutate) => {
    const record = project()
    mutate(record)
    expect(() => validateSavedProject(record)).toThrow()
  })

  it.each([
    { x: [90, 10], y: [0, 100], z: [0, 100] },
    { x: [0, 0.5], y: [0, 100], z: [0, 100] },
    { x: [0, 101], y: [0, 100], z: [0, 100] },
  ])('rejects invalid section-box ranges %j', (ranges) => {
    const record = project()
    record.snapshot.workspace.sectionBox = {
      targetId: null,
      ranges: ranges as NonNullable<typeof record.snapshot.workspace.sectionBox>['ranges'],
    }
    expect(() => validateSavedProject(record)).toThrow(/단면/)
  })

  it('preserves section-box rotation in saved records and accepts older boxes without an angle', () => {
    const record = project()
    const section = { targetId: null, ranges: fullSectionRanges() }
    record.snapshot.workspace.sectionBox = section
    expect(validateSavedProject(record).snapshot.workspace.sectionBox).toStrictEqual(section)
    for (const rotationY of [-180, 0, 42.5, 180]) {
      record.snapshot.workspace.sectionBox = { ...section, rotationY }
      const saved = buildProjectRecord(record.name, record.snapshot)
      expect(saved.snapshot.workspace.sectionBox).toStrictEqual({ ...section, rotationY })
    }
  })

  it.each([-181, 181, Infinity, NaN])('rejects invalid section-box rotation %s', (rotationY) => {
    const record = project()
    record.snapshot.workspace.sectionBox = {
      targetId: null,
      ranges: fullSectionRanges(),
      rotationY,
    }
    expect(() => validateSavedProject(record)).toThrow(/단면 회전 각도/)
  })

  it('rejects unusable camera state without silently resetting it', () => {
    const record = project()
    const camera = {
      position: [1, 2, 3] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
      zoom: 1,
      viewport: [800, 600] as [number, number],
    }
    record.snapshot.workspace.camera = camera
    expect(validateSavedProject(record).snapshot.workspace.camera).toEqual(camera)
    camera.target = [...camera.position]
    expect(() => validateSavedProject(record)).toThrow(/시점 방향/)
    camera.target = [0, 0, 0]
    camera.zoom = 0
    expect(() => validateSavedProject(record)).toThrow(/시점 확대/)
    camera.zoom = 1
    camera.viewport[0] = NaN
    expect(() => validateSavedProject(record)).toThrow(/화면 너비/)
  })

  it('validates business headers, row widths, mapping and table limits', () => {
    const record = project()
    const business = record.snapshot.business!
    business.table.headers = ['번호', '번호']
    expect(() => validateSavedProject(record)).toThrow(/업무 열/)
    business.table.headers = ['번호', '상태']
    business.table.rows = [['0001']]
    expect(() => validateSavedProject(record)).toThrow(/업무 행/)
    business.table.rows = [['0001', '완료']]
    business.column = '없는 열'
    expect(() => validateSavedProject(record)).toThrow(/연결 열/)
    business.column = '번호'
    business.table.rows = Array.from({ length: BUSINESS_LIMITS.rows + 1 }, () => ['0001', '완료'])
    expect(() => validateSavedProject(record)).toThrow(/표 크기/)
  })

  it('accepts actual CSV parser output without changing leading zeros, quoted text or empty cells', () => {
    const record = project()
    const table = parseBusinessCsv(
      '\uFEFF 번호 ,상태,메모\r\n0001,"완료, 검수","두 줄\n메모"\r\n0002,,\r\n',
      '현장 업무.csv',
    )
    record.snapshot.business = { fileName: '현장 업무.csv', table, modelKey: 'tag', column: '번호' }
    expect(validateSavedProject(record).snapshot.business?.table).toEqual(table)
    expect(table.rows).toEqual([
      ['0001', '완료, 검수', '두 줄\n메모'],
      ['0002', '', ''],
    ])
  })

  it('reports an unavailable browser store and validates writes before opening it', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(listProjects()).rejects.toThrow(/프로젝트 파일/)
    const invalid = project()
    invalid.name = ''
    await expect(writeProject(invalid)).rejects.toThrow(/이름/)
  })
})

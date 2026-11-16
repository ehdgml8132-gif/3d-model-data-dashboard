import { describe, expect, it, vi } from 'vitest'
import { MAX_IFC_FILE_BYTES } from '../ifc/limits'
import { createBuildingMetricFilters } from '../lib/buildingFilters'
import { decodeProjectFile, encodeProjectFile, PROJECT_FILE_MIME } from './codec'
import type { SavedProject } from './types'
import { MAX_PROJECT_METADATA_BYTES } from './validation'

const originalBytes = new Uint8Array([73, 83, 79, 45, 49, 48, 51, 48, 51, 45, 50, 49, 59, 0, 255])

function project(): SavedProject {
  return {
    version: 1,
    id: '0f8800a7-69ea-4f66-8330-3b99e0e960e3',
    name: '서울 현장 · 공정 검토',
    createdAt: '2026-01-01T01:02:03.000Z',
    updatedAt: '2026-01-02T03:04:05.000Z',
    snapshot: {
      ifcFile: new File([originalBytes], '서울-구조.IFC', { lastModified: 1767225600000 }),
      elementCount: 1,
      business: {
        fileName: '공정표.xlsx',
        table: {
          name: '현장 업무',
          headers: ['자산번호', '진행상태'],
          rows: [['0001', '검수 완료']],
        },
        modelKey: 'tag',
        column: '자산번호',
      },
      workspace: {
        activeView: 'data',
        metricFilters: {
          kinds: ['column'],
          elementIds: ['IFC-44'],
          floors: ['1층'],
          materials: ['철근콘크리트'],
          volume: { min: 0, max: 10, includeUnknown: true },
        },
        kind: 'column',
        query: '기둥',
        selectedId: 'IFC-44',
        sectionBox: { targetId: 'IFC-44', ranges: { x: [20, 80], y: [0, 100], z: [5, 95] } },
        camera: { position: [10, 8, 10], target: [0, 0, 0], zoom: 40, viewport: [1280, 800] },
        tablePage: 0,
      },
    },
  }
}

function metadata(record = project()) {
  const file = record.snapshot.ifcFile
  return {
    ...record,
    snapshot: {
      ...record.snapshot,
      ifcFile: { name: file.name, size: file.size, lastModified: file.lastModified },
    },
  }
}

function container(value: unknown, body = originalBytes, encoded?: Uint8Array): File {
  const json = encoded ?? new TextEncoder().encode(JSON.stringify(value))
  const header = new Uint8Array(12)
  header.set(new TextEncoder().encode('MONOPRJ1'))
  new DataView(header.buffer).setUint32(8, json.byteLength, true)
  return new File([header, new Uint8Array(json), body], 'backup.bin')
}

describe('portable project binary format', () => {
  it('round trips original IFC bytes, Korean metadata, leading-zero IDs and the full workspace', async () => {
    const original = project()
    const blob = await encodeProjectFile(original)
    expect(blob.type).toBe(PROJECT_FILE_MIME)
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
    expect(new TextDecoder().decode(header.subarray(0, 8))).toBe('MONOPRJ1')
    const length = new DataView(header.buffer).getUint32(8, true)
    expect(blob.size).toBe(12 + length + originalBytes.length)
    expect(new Uint8Array(await blob.slice(12 + length).arrayBuffer())).toEqual(originalBytes)

    // Content magic is authoritative: a renamed downloaded file is still readable.
    const decoded = await decodeProjectFile(new File([blob], 'renamed-project.backup'))
    expect(decoded.name).toBe(original.name)
    expect(decoded.snapshot.workspace).toEqual(original.snapshot.workspace)
    expect(decoded.snapshot.business).toEqual(original.snapshot.business)
    expect(decoded.snapshot.business?.table.rows[0][0]).toBe('0001')
    expect(decoded.snapshot.ifcFile.name).toBe('서울-구조.IFC')
    expect(decoded.snapshot.ifcFile.lastModified).toBe(1767225600000)
    expect(new Uint8Array(await decoded.snapshot.ifcFile.arrayBuffer())).toEqual(originalBytes)
    expect(original.snapshot.business?.table.rows[0][0]).toBe('0001')
  })

  it('supports absent business data, camera and section plus default all-value filters', async () => {
    const record = project()
    record.snapshot.business = null
    record.snapshot.workspace.camera = null
    record.snapshot.workspace.sectionBox = null
    record.snapshot.workspace.selectedId = ''
    record.snapshot.workspace.metricFilters = createBuildingMetricFilters()
    const decoded = await decodeProjectFile(
      new File([await encodeProjectFile(record)], 'no-business.monospace'),
    )
    expect(decoded.snapshot.business).toBeNull()
    expect(decoded.snapshot.workspace.camera).toBeNull()
    expect(decoded.snapshot.workspace.sectionBox).toBeNull()
    expect(decoded.snapshot.workspace.metricFilters).toEqual(createBuildingMetricFilters())
  })

  it('round trips long IFC filenames accepted by the shared project schema', async () => {
    const record = project()
    const name = `${'a'.repeat(700)}.ifc`
    record.snapshot.ifcFile = new File([originalBytes], name, { lastModified: 0 })
    const decoded = await decodeProjectFile(
      new File([await encodeProjectFile(record)], 'long-name.monospace'),
    )
    expect(decoded.snapshot.ifcFile.name).toBe(name)
    expect(decoded.snapshot.ifcFile.lastModified).toBe(0)
  })

  it.each([0, 4, 8, 12])('rejects an empty/truncated %i-byte header', async (size) => {
    await expect(
      decodeProjectFile(new File([new Uint8Array(size)], 'bad.monospace')),
    ).rejects.toThrow()
  })

  it('rejects a foreign magic header before attempting JSON parsing', async () => {
    const bytes = new Uint8Array(await container(metadata()).arrayBuffer())
    bytes[0] = 0
    await expect(decodeProjectFile(new File([bytes], 'foreign.monospace'))).rejects.toThrow(
      /Monospace/,
    )
  })

  it('rejects declared oversized metadata without reading or allocating that slice', async () => {
    const header = new Uint8Array(13)
    header.set(new TextEncoder().encode('MONOPRJ1'))
    new DataView(header.buffer).setUint32(8, MAX_PROJECT_METADATA_BYTES + 1, true)
    const file = new File([header], 'oversized.monospace')
    const slice = vi.spyOn(file, 'slice')
    await expect(decodeProjectFile(file)).rejects.toThrow(/크기/)
    expect(slice).toHaveBeenCalledTimes(1)
    expect(slice).toHaveBeenCalledWith(0, 12)
  })

  it('rejects oversized outer files before any slice is read', async () => {
    const file = new File(['placeholder'], 'oversized.monospace')
    Object.defineProperty(file, 'size', {
      value: 13 + MAX_IFC_FILE_BYTES + MAX_PROJECT_METADATA_BYTES,
    })
    const slice = vi.spyOn(file, 'slice')
    await expect(decodeProjectFile(file)).rejects.toThrow(/한도/)
    expect(slice).not.toHaveBeenCalled()
  })

  it('rejects truncated metadata and a missing IFC payload', async () => {
    const data = container(metadata())
    await expect(
      decodeProjectFile(new File([data.slice(0, 20)], 'truncated.monospace')),
    ).rejects.toThrow(/잘렸/)
    await expect(decodeProjectFile(container(metadata(), new Uint8Array()))).rejects.toThrow(
      /IFC 모델 데이터/,
    )
  })

  it.each([new TextEncoder().encode('{'), new Uint8Array([0xff, 0xfe, 0x7b])])(
    'rejects corrupt JSON or invalid UTF-8 metadata',
    async (encoded) => {
      await expect(decodeProjectFile(container(null, originalBytes, encoded))).rejects.toThrow(
        /화면 데이터/,
      )
    },
  )

  it('rejects future versions instead of guessing how to restore them', async () => {
    await expect(decodeProjectFile(container({ ...metadata(), version: 2 }))).rejects.toThrow(
      /버전/,
    )
  })

  it('rejects both trailing bytes and truncated IFC data', async () => {
    await expect(
      decodeProjectFile(container(metadata(), originalBytes.subarray(1))),
    ).rejects.toThrow(/IFC 크기/)
    await expect(
      decodeProjectFile(container(metadata(), new Uint8Array([...originalBytes, 0]))),
    ).rejects.toThrow(/IFC 크기/)
  })

  it('rejects invalid IFC descriptors before creating their File', async () => {
    const value = metadata()
    value.snapshot.ifcFile.size = MAX_IFC_FILE_BYTES + 1
    await expect(decodeProjectFile(container(value))).rejects.toThrow(/IFC 파일 정보/)
    value.snapshot.ifcFile.size = originalBytes.length
    value.snapshot.ifcFile.name = 'not-a-model.txt'
    await expect(decodeProjectFile(container(value))).rejects.toThrow(/IFC 파일 정보/)
  })

  it('validates restored state before returning or exporting a project', async () => {
    const invalid = project()
    invalid.snapshot.workspace.metricFilters.volume = { min: 10, max: 1, includeUnknown: false }
    await expect(decodeProjectFile(container(metadata(invalid)))).rejects.toThrow()
    await expect(encodeProjectFile(invalid)).rejects.toThrow()
  })
})

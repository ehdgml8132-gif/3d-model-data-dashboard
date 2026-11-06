import ExcelJS from 'exceljs'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { BusinessModelElement, BusinessTable } from '../business/types'
import { BUSINESS_LIMITS, joinBusinessRows, loadBusinessFile, parseBusinessCsv } from './business'

const models: BusinessModelElement[] = [
  { id: 'ifc:1', globalId: '00123', tag: 'C-01' },
  { id: 'ifc:2', globalId: 'AbcXYZ', tag: 'C-02' },
  { id: 'ifc:3', globalId: '0', tag: 'C-03' },
  { id: 'ifc:4', globalId: null, tag: null },
]

const makeTable = (records: string) => parseBusinessCsv(`모델 ID,예산,상태\n${records}`)
const makeFile = (bytes: Uint8Array, name = 'data.xlsx') => new File([bytes.slice().buffer], name)

describe('generic business CSV', () => {
  it('preserves leading zeros, case, zero, whitespace and business field values', () => {
    const table = parseBusinessCsv(
      '\uFEFF\nGlobalId,예산,상태\r\n00123,0, 대기 \r\nAbcXYZ,,확인\r\n0,1200,완료\r\n',
      '견적.csv',
    )
    expect(table).toEqual({
      name: '견적.csv',
      headers: ['GlobalId', '예산', '상태'],
      rows: [
        ['00123', '0', ' 대기 '],
        ['AbcXYZ', '', '확인'],
        ['0', '1200', '완료'],
      ],
    })
  })

  it('reads quoted commas, escaped quotes and multiline values', () => {
    const table = parseBusinessCsv('ID,설명\r\n00123,"공사, \"\"A\"\" 구역\r\n다음 줄"\r\n')
    expect(table.rows).toEqual([['00123', '공사, "A" 구역\r\n다음 줄']])
  })

  it('keeps formulas and HTML as inert text without evaluating or removing rows', () => {
    const table = parseBusinessCsv('id,설명\n1,=1+2\n2,<script>alert(1)</script>\n,빈 키 행')
    expect(table.rows).toEqual([
      ['1', '=1+2'],
      ['2', '<script>alert(1)</script>'],
      ['', '빈 키 행'],
    ])
  })

  it.each([
    ['', '열 이름'],
    ['ID,금액', '업무 데이터가 없습니다'],
    ['ID,ID\na,b', '중복'],
    ['ID, ID \na,b', '중복'],
    ['ID,\na,b', '비어 있는 열 이름'],
    ['ID,금액\na,b,c', '열 개수'],
    ['ID,금액\na', '열 개수'],
    ['ID,금액\na,"열린 따옴표', '닫히지 않은'],
    ['ID,금액\na,"닫힘"이후', '큰따옴표 형식'],
  ])('rejects invalid CSV %s', (source, message) => {
    expect(() => parseBusinessCsv(source)).toThrow(message)
  })

  it('enforces column and row bounds during parsing', () => {
    expect(() =>
      parseBusinessCsv(
        `${Array.from({ length: BUSINESS_LIMITS.columns + 1 }, (_, i) => `열${i}`).join(',')}\n1`,
      ),
    ).toThrow('200')
    expect(() => parseBusinessCsv(`ID\n${'a\n'.repeat(BUSINESS_LIMITS.rows + 1)}`)).toThrow(
      '30,000',
    )
  })

  it('enforces file byte and logical cell limits', () => {
    expect(() => parseBusinessCsv(`ID\n${'a'.repeat(BUSINESS_LIMITS.fileBytes)}`)).toThrow('10MB')
    const header = Array.from({ length: 200 }, (_, i) => `열${i}`).join(',')
    expect(() =>
      parseBusinessCsv(`${header}\n${`${Array(200).fill('a').join(',')}\n`.repeat(5000)}`),
    ).toThrow('1,000,000')
  })
})

describe('exact model-to-business joins', () => {
  it('matches the chosen column with trim-only keys and keeps 00123 and 0 intact', () => {
    const table = makeTable(' 00123 ,0,확인\nAbcXYZ,12,완료\n0,1,대기')
    const result = joinBusinessRows(models, table, { modelKey: 'globalId', column: '모델 ID' })
    expect(result.byElementId.get('ifc:1')).toEqual({
      status: 'matched',
      rows: [[' 00123 ', '0', '확인']],
    })
    expect(result.byElementId.get('ifc:3')?.status).toBe('matched')
    expect(result.diagnostics).toEqual({
      businessRows: 3,
      matchedElements: 3,
      unmatchedElements: 1,
      ambiguousElements: 0,
      blankBusinessKeys: 0,
      blankModelKeys: 1,
      duplicateBusinessKeys: 0,
      unmatchedBusinessRows: 0,
      duplicateModelKeys: 0,
    })
  })

  it('does not normalize case, strip meaningful zeros or match an empty key', () => {
    const result = joinBusinessRows(models, makeTable('123,1,A\nabcxyz,2,B\n,3,C'), {
      modelKey: 'globalId',
      column: '모델 ID',
    })
    expect(result.diagnostics.matchedElements).toBe(0)
    expect(result.diagnostics.unmatchedElements).toBe(4)
    expect(result.diagnostics.blankBusinessKeys).toBe(1)
    expect(result.diagnostics.blankModelKeys).toBe(1)
    expect(result.diagnostics.unmatchedBusinessRows).toBe(2)
    expect(result.byElementId.get('ifc:4')).toEqual({ status: 'unmatched', rows: [] })
  })

  it('preserves every duplicate business row as ambiguous without summing quantities', () => {
    const table = makeTable('00123,10,1차\n00123,20,2차\n없음,40,확인\n없음,50,확인\n,60,빈 키')
    const result = joinBusinessRows(models, table, { modelKey: 'globalId', column: '모델 ID' })
    expect(result.byElementId.get('ifc:1')).toEqual({
      status: 'ambiguous',
      rows: table.rows.slice(0, 2),
    })
    expect(result.diagnostics.ambiguousElements).toBe(1)
    expect(result.diagnostics.duplicateBusinessKeys).toBe(2)
    expect(result.diagnostics.unmatchedBusinessRows).toBe(2)
    expect(table.rows).toHaveLength(5)
  })

  it('marks every model sharing a nonblank selected key as ambiguous', () => {
    const elements = [...models, { id: 'ifc:5', globalId: '00123', tag: 'C-05' }]
    const result = joinBusinessRows(elements, makeTable('00123,1,확인'), {
      modelKey: 'globalId',
      column: '모델 ID',
    })
    expect(result.byElementId.get('ifc:1')?.status).toBe('ambiguous')
    expect(result.byElementId.get('ifc:5')?.status).toBe('ambiguous')
    expect(result.diagnostics.duplicateModelKeys).toBe(1)
    expect(result.diagnostics.ambiguousElements).toBe(2)
    expect(result.diagnostics.unmatchedBusinessRows).toBe(0)
  })

  it('supports Tag and internal id without implicitly using GlobalId', () => {
    expect(
      joinBusinessRows(models, makeTable('C-02,1,확인'), {
        modelKey: 'tag',
        column: '모델 ID',
      }).byElementId.get('ifc:2')?.status,
    ).toBe('matched')
    expect(
      joinBusinessRows(models, makeTable('ifc:2,1,확인'), {
        modelKey: 'id',
        column: '모델 ID',
      }).byElementId.get('ifc:2')?.status,
    ).toBe('matched')
    expect(
      joinBusinessRows(models, makeTable('C-02,1,확인'), {
        modelKey: 'globalId',
        column: '모델 ID',
      }).diagnostics.matchedElements,
    ).toBe(0)
  })

  it('rejects missing columns and duplicate internal model identities', () => {
    expect(() =>
      joinBusinessRows(models, makeTable('00123,1,확인'), { modelKey: 'id', column: '없음' }),
    ).toThrow('열을 선택')
    expect(() =>
      joinBusinessRows([...models, models[0]], makeTable('00123,1,확인'), {
        modelKey: 'globalId',
        column: '모델 ID',
      }),
    ).toThrow('내부 ID가 중복')
  })

  it('does not mutate source tables or elements and reports no-data gracefully', () => {
    const table: BusinessTable = { name: '빈 목록', headers: ['ID'], rows: [] }
    Object.freeze(table.rows)
    const result = joinBusinessRows(models, table, { modelKey: 'globalId', column: 'ID' })
    expect(result.byElementId.size).toBe(4)
    expect(result.diagnostics.unmatchedElements).toBe(4)
    expect(
      joinBusinessRows([], makeTable('00123,1,확인'), { modelKey: 'globalId', column: '모델 ID' })
        .diagnostics.unmatchedBusinessRows,
    ).toBe(1)
  })
})

describe('local business file loading', () => {
  it('loads CSV as one named table, rejects non-UTF8 CSV and unsupported file types', async () => {
    expect(
      (await loadBusinessFile(new File(['ID,금액\n00123,0'], '견적.csv'))).sheets[0].rows,
    ).toEqual([['00123', '0']])
    await expect(
      loadBusinessFile(makeFile(new Uint8Array([0xff, 0xfe, 0x80]), '한글.csv')),
    ).rejects.toThrow('UTF-8')
    await expect(loadBusinessFile(new File(['ID'], 'old.xls'))).rejects.toThrow('XLSX')
    await expect(
      loadBusinessFile(new File([new Uint8Array(BUSINESS_LIMITS.fileBytes + 1)], 'large.xlsx')),
    ).rejects.toThrow('10MB')
  })

  it('loads two real XLSX sheets, formatted IDs, zero, cached formulas, rich text and blanks', async () => {
    const workbook = new ExcelJS.Workbook()
    const first = workbook.addWorksheet('견적')
    first.getRow(3).values = ['GlobalId', '예산', '메모']
    first.getRow(4).values = ['00123', 0, { richText: [{ text: '중요 ' }, { text: '검토' }] }]
    first.getRow(5).values = [123, { formula: '1+2', result: 3 }, '숫자 ID']
    first.getCell('A5').numFmt = '00000'
    first.getRow(6).values = ['0', { formula: 'SUM(0)', result: 0 }, null]
    const second = workbook.addWorksheet('일정')
    second.addRow(['Tag', '검토 완료', '미계산'])
    second.addRow(['C-02', false, { formula: '1+1' }])
    workbook.addWorksheet('비어 있는 시트')
    const parsed = await loadBusinessFile(
      makeFile(new Uint8Array(await workbook.xlsx.writeBuffer())),
    )
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(['견적', '일정'])
    expect(parsed.sheets[0].rows).toEqual([
      ['00123', '0', '중요 검토'],
      ['00123', '3', '숫자 ID'],
      ['0', '0', ''],
    ])
    expect(parsed.sheets[1].rows).toEqual([['C-02', 'false', '']])
    expect(parsed.warnings?.[0]).toContain('수식은 실행하지 않습니다')
  })

  it('rejects duplicate XLSX headers and data extending beyond the header', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('중복')
    sheet.addRow(['ID', 'ID'])
    sheet.addRow(['A', 'B'])
    await expect(
      loadBusinessFile(makeFile(new Uint8Array(await workbook.xlsx.writeBuffer()))),
    ).rejects.toThrow('중복')
    sheet.getRow(1).values = ['ID']
    await expect(
      loadBusinessFile(makeFile(new Uint8Array(await workbook.xlsx.writeBuffer()))),
    ).rejects.toThrow('제목이 없는 열')
  })
})

function minimumZip(
  sheet = '<worksheet><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1"/></row></sheetData></worksheet>',
) {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8('<workbook/>'),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  })
}

function changeLastDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
  const patched = zip.slice()
  const view = new DataView(patched.buffer)
  let last = -1
  for (let i = 0; i < patched.length - 46; i += 1)
    if (view.getUint32(i, true) === 0x02014b50) last = i
  if (last < 0) throw new Error('Test ZIP central directory is missing')
  view.setUint32(last + 24, size, true)
  return patched
}

describe('XLSX bounded ZIP preflight', () => {
  it('rejects corrupt ZIP and declared expansion before invoking ExcelJS', async () => {
    await expect(loadBusinessFile(new File(['not a ZIP'], 'bad.xlsx'))).rejects.toThrow(
      '올바른 XLSX',
    )
    await expect(
      loadBusinessFile(
        makeFile(changeLastDeclaredSize(minimumZip(), BUSINESS_LIMITS.inflatedEntryBytes + 1)),
      ),
    ).rejects.toThrow('압축 해제 크기가 너무')
  })

  it('checks actual inflated length rather than trusting forged ZIP declarations', async () => {
    const bomb = minimumZip(`<worksheet>${'a'.repeat(100_000)}</worksheet>`)
    await expect(loadBusinessFile(makeFile(changeLastDeclaredSize(bomb, 10)))).rejects.toThrow(
      '선언된 범위를 초과',
    )
  })

  it.each([
    ['<worksheet><dimension ref="A1:XFD1048576"/></worksheet>', '범위'],
    ['<worksheet><sheetData><row r="30002"/></sheetData></worksheet>', '행 범위'],
    ['<worksheet><sheetData><row r="1"><c r="GS1"/></row></sheetData></worksheet>', '범위'],
    ['<!DOCTYPE a [<!ENTITY b "bad">]><worksheet/>', 'XML 선언'],
  ])('rejects oversized or unsupported sheet XML (%s)', async (xml, message) => {
    await expect(loadBusinessFile(makeFile(minimumZip(xml)))).rejects.toThrow(message)
  })
})

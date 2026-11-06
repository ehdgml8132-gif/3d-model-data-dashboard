import type { Cell, CellValue } from 'exceljs'
import { Inflate } from 'fflate'
import type {
  BusinessJoinResult,
  BusinessModelElement,
  BusinessModelKey,
  BusinessTable,
  BusinessWorkbook,
} from '../business/types'

export type {
  BusinessTable,
  BusinessWorkbook,
  BusinessJoinResult,
  BusinessModelKey,
} from '../business/types'

export const BUSINESS_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  rows: 30_000,
  columns: 200,
  cells: 1_000_000,
  sheets: 30,
  zipEntries: 1000,
  inflatedEntryBytes: 32 * 1024 * 1024,
  inflatedTotalBytes: 100 * 1024 * 1024,
} as const

function validateTable(name: string, records: string[][]): BusinessTable {
  const [header, ...rows] = records
  if (!header) throw new Error(`${name}: 첫 번째 비어 있지 않은 행에 열 이름을 입력해 주세요.`)
  const headers = header.map((value) => value.trim())
  if (headers.length > BUSINESS_LIMITS.columns)
    throw new Error(`열은 최대 ${BUSINESS_LIMITS.columns}개까지 지원합니다.`)
  if (headers.some((value) => !value)) throw new Error(`${name}: 비어 있는 열 이름이 있습니다.`)
  if (new Set(headers).size !== headers.length)
    throw new Error(`${name}: 열 이름이 중복되었습니다. 각 열에 다른 이름을 지정해 주세요.`)
  if (!rows.length) throw new Error(`${name}: 제목 행 아래에 업무 데이터가 없습니다.`)
  if (rows.length > BUSINESS_LIMITS.rows || records.length * headers.length > BUSINESS_LIMITS.cells)
    throw new Error(`업무 데이터는 최대 30,000행, 1,000,000셀까지 지원합니다.`)
  rows.forEach((row, index) => {
    if (row.length !== headers.length)
      throw new Error(`${name}: 데이터 ${index + 1}행의 열 개수가 제목 행과 다릅니다.`)
  })
  return { name, headers, rows }
}

/** CSV uses its first nonblank record as the header. Values remain exactly text. */
export function parseBusinessCsv(text: string, name = 'CSV'): BusinessTable {
  if (new TextEncoder().encode(text).byteLength > BUSINESS_LIMITS.fileBytes)
    throw new Error('업무 데이터 파일은 10MB 이하로 선택해 주세요.')
  const input = text.replace(/^\uFEFF/, '')
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false
  let parsedCells = 0
  const fieldDone = () => {
    row.push(field)
    parsedCells += 1
    if (parsedCells > BUSINESS_LIMITS.cells)
      throw new Error('업무 데이터는 최대 1,000,000셀까지 지원합니다.')
    if (row.length > BUSINESS_LIMITS.columns) throw new Error('열은 최대 200개까지 지원합니다.')
    field = ''
    closedQuote = false
  }
  const rowDone = () => {
    fieldDone()
    if (row.some((value) => value.trim() !== '')) {
      if (records.length && row.length !== records[0].length)
        throw new Error(`${name}: 데이터 ${records.length}행의 열 개수가 제목 행과 다릅니다.`)
      records.push(row)
    }
    if (records.length > BUSINESS_LIMITS.rows + 1)
      throw new Error('업무 데이터는 최대 30,000행까지 지원합니다.')
    if (records.length * (records[0]?.length ?? 0) > BUSINESS_LIMITS.cells)
      throw new Error('업무 데이터는 최대 1,000,000셀까지 지원합니다.')
    row = []
  }
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
        closedQuote = true
      } else field += character
    } else if (character === ',') fieldDone()
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      rowDone()
    } else if (character === '"' && field === '' && !closedQuote) quoted = true
    else if (character === '"' || closedQuote)
      throw new Error('CSV의 큰따옴표 형식이 올바르지 않습니다.')
    else field += character
  }
  if (quoted) throw new Error('CSV에 닫히지 않은 큰따옴표가 있습니다.')
  rowDone()
  return validateTable(name, records)
}

type ZipEntry = {
  name: string
  method: number
  compressed: number
  uncompressed: number
  start: number
}

/** Reject unsupported/oversized ZIP structures before ExcelJS can inflate them. */
function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (
      view.getUint32(index, true) === 0x06054b50 &&
      index + 22 + view.getUint16(index + 20, true) === bytes.length
    ) {
      end = index
      break
    }
  }
  if (end < 0)
    throw new Error('올바른 XLSX 파일이 아닙니다. 엑셀에서 .xlsx 형식으로 다시 저장해 주세요.')
  const count = view.getUint16(end + 10, true)
  const directorySize = view.getUint32(end + 12, true)
  const directoryStart = view.getUint32(end + 16, true)
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    count === 0xffff ||
    count > BUSINESS_LIMITS.zipEntries ||
    directoryStart + directorySize !== end
  )
    throw new Error('이 XLSX의 압축 구조는 지원하지 않습니다.')
  const entries: ZipEntry[] = []
  const names = new Set<string>()
  let offset = directoryStart
  let inflatedTotal = 0
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('XLSX 압축 목록이 손상되었습니다.')
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const uncompressed = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    if (offset + 46 + nameLength + extraLength + commentLength > end)
      throw new Error('XLSX 압축 목록의 길이가 올바르지 않습니다.')
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (
      flags & 1 ||
      (method !== 0 && method !== 8) ||
      local === 0xffffffff ||
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff ||
      names.has(name) ||
      name.startsWith('/') ||
      name.split('/').includes('..')
    )
      throw new Error('암호화되었거나 지원하지 않는 XLSX 압축 항목입니다.')
    names.add(name)
    inflatedTotal += uncompressed
    if (
      uncompressed > BUSINESS_LIMITS.inflatedEntryBytes ||
      inflatedTotal > BUSINESS_LIMITS.inflatedTotalBytes
    )
      throw new Error('XLSX 압축 해제 크기가 너무 큽니다. 필요한 시트만 새 파일로 저장해 주세요.')
    if (
      local + 30 > directoryStart ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 8, true) !== method
    )
      throw new Error('XLSX 압축 항목이 손상되었습니다.')
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    if (start + compressed > directoryStart)
      throw new Error('XLSX 압축 항목의 범위가 올바르지 않습니다.')
    entries.push({ name, method, compressed, uncompressed, start })
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml'))
    throw new Error('엑셀 XLSX 문서 구조를 찾을 수 없습니다.')
  return entries
}

function inflateEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const input = bytes.subarray(entry.start, entry.start + entry.compressed)
  if (entry.method === 0) {
    if (input.byteLength !== entry.uncompressed)
      throw new Error('XLSX 압축 항목의 크기가 일치하지 않습니다.')
    return input
  }
  let length = 0
  const chunks: Uint8Array[] = []
  const inflater = new Inflate((chunk) => {
    length += chunk.length
    if (length > entry.uncompressed || length > BUSINESS_LIMITS.inflatedEntryBytes)
      throw new Error('XLSX 압축 해제 크기가 선언된 범위를 초과했습니다.')
    chunks.push(chunk)
  })
  if (!input.length) inflater.push(input, true)
  for (let offset = 0; offset < input.length; offset += 4096)
    inflater.push(input.subarray(offset, offset + 4096), offset + 4096 >= input.length)
  if (length !== entry.uncompressed) throw new Error('XLSX 압축 항목의 크기가 일치하지 않습니다.')
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function validateWorksheetXml(xml: string) {
  let cells = 0
  let rows = 0
  let rowCells = 0
  let maxRow = 0
  let maxColumn = 0
  const address = (value: string) => {
    const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(value)
    if (!match) throw new Error('XLSX 셀 주소가 올바르지 않습니다.')
    const column = [...match[1]].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0)
    const row = Number(match[2])
    if (
      !Number.isSafeInteger(row) ||
      row < 1 ||
      row > BUSINESS_LIMITS.rows + 1 ||
      column > BUSINESS_LIMITS.columns
    )
      throw new Error(
        'XLSX 시트 범위가 30,001행 또는 200열을 초과합니다. 불필요한 행·열 서식을 제거해 주세요.',
      )
    maxRow = Math.max(row, maxRow)
    maxColumn = Math.max(column, maxColumn)
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('지원하지 않는 XLSX XML 선언입니다.')
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?(?:dimension|row|c)\b[^>]*>/g)) {
    const tag = match[0]
    const reference = /\b(?:ref|r)\s*=\s*["']([^"']+)["']/.exec(tag)?.[1]
    if (/<(?:[\w.-]+:)?dimension\b/.test(tag)) {
      if (reference) for (const value of reference.split(':')) address(value)
    } else if (/<(?:[\w.-]+:)?row\b/.test(tag)) {
      rows += 1
      rowCells = 0
      if (rows > BUSINESS_LIMITS.rows + 1)
        throw new Error('XLSX 시트는 최대 30,000개 데이터 행까지 지원합니다.')
      if (reference && (!/^\d+$/.test(reference) || Number(reference) > BUSINESS_LIMITS.rows + 1))
        throw new Error('XLSX 시트의 행 범위가 너무 큽니다.')
    } else {
      cells += 1
      rowCells += 1
      if (rowCells > BUSINESS_LIMITS.columns)
        throw new Error('XLSX 시트는 최대 200열까지 지원합니다.')
      if (reference) address(reference)
      if (cells > BUSINESS_LIMITS.cells)
        throw new Error('XLSX 시트는 최대 1,000,000셀까지 지원합니다.')
    }
  }
  if (maxRow * maxColumn > BUSINESS_LIMITS.cells)
    throw new Error('XLSX 시트 범위는 최대 1,000,000셀까지 지원합니다.')
  return Math.max(cells, maxRow * maxColumn)
}

function excelCellText(cell: Cell, warnings: Set<string>): string {
  const text = (value: CellValue): string => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return ''
      // A numeric Excel ID with an explicit 00000 format retains its displayed zeros.
      return Number.isSafeInteger(value) && value >= 0 && /^0{1,64}$/.test(cell.numFmt)
        ? String(value).padStart(cell.numFmt.length, '0')
        : String(value)
    }
    if (typeof value === 'boolean') return String(value)
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : ''
    if ('formula' in value || 'sharedFormula' in value) {
      warnings.add(
        '엑셀 수식은 실행하지 않습니다. 파일에 저장된 계산 결과만 읽으며, 결과가 없는 수식은 빈 값으로 표시합니다.',
      )
      // ExcelJS's value getter omits a cached 0/false; the result accessor retains it.
      return text(value.result ?? cell.result ?? null)
    }
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    if ('text' in value) return String(value.text)
    if ('error' in value) return value.error
    return ''
  }
  return text(cell.value)
}

export async function loadBusinessFile(file: File): Promise<BusinessWorkbook> {
  if (file.size > BUSINESS_LIMITS.fileBytes)
    throw new Error('업무 데이터 파일은 10MB 이하로 선택해 주세요.')
  const extension = file.name.toLocaleLowerCase().split('.').pop()
  if (extension !== 'csv' && extension !== 'xlsx')
    throw new Error(
      'CSV 또는 XLSX 파일을 선택해 주세요. 이전 XLS 형식은 XLSX로 다시 저장해야 합니다.',
    )
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength > BUSINESS_LIMITS.fileBytes)
    throw new Error('업무 데이터 파일은 10MB 이하로 선택해 주세요.')
  if (extension === 'csv') {
    let csv: string
    try {
      csv = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      throw new Error(
        'CSV는 UTF-8 인코딩으로 저장해 주세요. 엑셀에서 CSV UTF-8 형식을 선택할 수 있습니다.',
      )
    }
    return { sheets: [parseBusinessCsv(csv, file.name)] }
  }
  const bytes = new Uint8Array(buffer)
  const entries = readZipEntries(bytes)
  let sheets = 0
  let preflightCells = 0
  // Inflate every entry through a bounded streaming decoder, then inspect sheet
  // dimensions BEFORE ExcelJS parses XML or creates rows/cells.
  for (const entry of entries) {
    const inflated = inflateEntry(bytes, entry)
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(entry.name)) {
      sheets += 1
      if (sheets > BUSINESS_LIMITS.sheets)
        throw new Error('업무 데이터는 최대 30개 시트까지 지원합니다.')
      preflightCells += validateWorksheetXml(new TextDecoder().decode(inflated))
      if (preflightCells > BUSINESS_LIMITS.cells)
        throw new Error('전체 XLSX 시트 범위는 최대 1,000,000셀까지 지원합니다.')
    }
  }
  const excel = await import('exceljs')
  const Workbook = excel.Workbook ?? excel.default.Workbook
  const workbook = new Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    throw new Error('XLSX 파일을 읽을 수 없습니다. 암호를 해제하고 엑셀에서 다시 저장해 주세요.')
  }
  const tables: BusinessTable[] = []
  const warnings = new Set<string>()
  let totalCells = 0
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > BUSINESS_LIMITS.rows + 1 || sheet.columnCount > BUSINESS_LIMITS.columns)
      throw new Error('XLSX 시트 범위가 30,001행 또는 200열을 초과합니다.')
    const records: string[][] = []
    let width = 0
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.from({ length: row.cellCount }, (_, index) =>
        excelCellText(row.getCell(index + 1), warnings),
      )
      while (values.length && values[values.length - 1] === '') values.pop()
      if (!values.some((value) => value.trim())) return
      if (!records.length) width = values.length
      if (values.length > width)
        throw new Error(`${sheet.name}: 제목이 없는 열에 데이터가 있습니다.`)
      while (values.length < width) values.push('')
      records.push(values)
      totalCells += width
      if (totalCells > BUSINESS_LIMITS.cells)
        throw new Error('전체 업무 데이터는 최대 1,000,000셀까지 지원합니다.')
    })
    if (records.length) tables.push(validateTable(sheet.name, records))
  }
  if (!tables.length) throw new Error('XLSX 파일에 데이터가 있는 시트가 없습니다.')
  return { sheets: tables, ...(warnings.size ? { warnings: [...warnings] } : {}) }
}

/** Exact, case-sensitive joins after trimming outer whitespace; never first-match. */
export function joinBusinessRows(
  elements: readonly BusinessModelElement[],
  table: BusinessTable,
  options: { modelKey: BusinessModelKey; column: string },
): BusinessJoinResult {
  const column = table.headers.indexOf(options.column)
  if (column < 0) throw new Error('연결할 업무 데이터 열을 선택해 주세요.')
  const business = new Map<string, string[][]>()
  let blankBusinessKeys = 0
  for (const row of table.rows) {
    const key = (row[column] ?? '').trim()
    if (!key) {
      blankBusinessKeys += 1
      continue
    }
    const rows = business.get(key) ?? []
    rows.push(row)
    business.set(key, rows)
  }
  const model = new Map<string, BusinessModelElement[]>()
  const ids = new Set<string>()
  let blankModelKeys = 0
  for (const element of elements) {
    if (ids.has(element.id))
      throw new Error('모델 내부 ID가 중복되어 업무 데이터를 안전하게 연결할 수 없습니다.')
    ids.add(element.id)
    const key = element[options.modelKey]?.trim() ?? ''
    if (!key) {
      blankModelKeys += 1
      continue
    }
    const matches = model.get(key) ?? []
    matches.push(element)
    model.set(key, matches)
  }
  const diagnostics = {
    businessRows: table.rows.length,
    matchedElements: 0,
    unmatchedElements: 0,
    ambiguousElements: 0,
    blankBusinessKeys,
    blankModelKeys,
    duplicateBusinessKeys: [...business.values()].filter((rows) => rows.length > 1).length,
    unmatchedBusinessRows: [...business.entries()].reduce(
      (sum, [key, rows]) => sum + (model.has(key) ? 0 : rows.length),
      0,
    ),
    duplicateModelKeys: [...model.values()].filter((matches) => matches.length > 1).length,
  }
  const byElementId: BusinessJoinResult['byElementId'] = new Map()
  for (const element of elements) {
    const key = element[options.modelKey]?.trim() ?? ''
    const rows = business.get(key) ?? []
    if (!key || !rows.length) {
      byElementId.set(element.id, { status: 'unmatched', rows: [] })
      diagnostics.unmatchedElements += 1
    } else if (rows.length > 1 || (model.get(key)?.length ?? 0) > 1) {
      byElementId.set(element.id, { status: 'ambiguous', rows })
      diagnostics.ambiguousElements += 1
    } else {
      byElementId.set(element.id, { status: 'matched', rows })
      diagnostics.matchedElements += 1
    }
  }
  return { byElementId, diagnostics }
}

import { PRODUCT_IDS } from '../data/sample'
import type { Product, ProductId } from '../types'

const DAY = 86_400_000
const CSV_HEADERS = [
  'product_id',
  'product_name',
  'category',
  'unit_price',
  'stock',
  'date',
  'quantity',
]
const MAX_ROWS = 40_000

/** Read RFC-style quoted fields, including commas, escaped quotes and newlines. */
function readCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false
  const input = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  const pushRow = () => {
    row.push(field)
    // Blank lines are permitted between records, but empty fields are validated below.
    if (row.some((value) => value.trim() !== '')) rows.push(row)
    if (rows.length > MAX_ROWS + 1)
      throw new Error(`CSV는 최대 ${MAX_ROWS.toLocaleString('ko-KR')}행까지 업로드할 수 있습니다.`)
    row = []
    field = ''
    closedQuote = false
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
      } else {
        field += character
      }
    } else if (character === ',') {
      row.push(field)
      field = ''
      closedQuote = false
    } else if (character === '\n') {
      pushRow()
    } else if (character === '"' && field === '' && !closedQuote) {
      quoted = true
    } else if (character === '"' || closedQuote) {
      throw new Error(
        'CSV의 따옴표 형식을 확인해 주세요. 따옴표가 포함된 값은 큰따옴표로 감싸야 합니다.',
      )
    } else {
      field += character
    }
  }
  if (quoted) throw new Error('CSV에서 닫히지 않은 큰따옴표를 발견했습니다.')
  pushRow()
  return rows
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

function parseNonnegative(value: string, label: string, row: number, integer = false): number {
  // Reject coercions such as empty values, Infinity, hexadecimal, and exponent notation.
  if (!/^\d+(?:\.\d+)?$/.test(value))
    throw new Error(`${row}행: ${label}은 0 이상의 숫자여야 합니다.`)
  const parsed = Number(value)
  if (
    !Number.isFinite(parsed) ||
    parsed > Number.MAX_SAFE_INTEGER ||
    (integer && !Number.isSafeInteger(parsed))
  ) {
    throw new Error(
      `${row}행: ${label}의 값이 올바르지 않습니다.${integer ? ' 0 이상의 정수를 입력해 주세요.' : ''}`,
    )
  }
  return parsed
}

export function parseProductsCsv(text: string): Product[] {
  const [header, ...rows] = readCsv(text)
  if (!header)
    throw new Error('CSV 파일이 비어 있습니다. 샘플 CSV를 내려받아 형식을 확인해 주세요.')
  const columns = header.map((value) => value.trim())
  if (
    columns.length !== CSV_HEADERS.length ||
    new Set(columns).size !== columns.length ||
    CSV_HEADERS.some((name) => !columns.includes(name))
  ) {
    throw new Error(`CSV 열 이름을 확인해 주세요: ${CSV_HEADERS.join(', ')}`)
  }
  if (rows.length === 0)
    throw new Error('CSV에 상품 데이터가 없습니다. 제목 행 아래에 데이터를 추가해 주세요.')

  const products = new Map<ProductId, Product>()
  const dates = new Set<string>()

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2
    if (row.length !== columns.length) throw new Error(`${line}행: 열 개수가 제목 행과 다릅니다.`)
    const values = Object.fromEntries(columns.map((column, index) => [column, row[index].trim()]))
    if (!PRODUCT_IDS.includes(values.product_id as ProductId)) {
      throw new Error(
        `${line}행: 상품 ID는 P001, P002, P003, P004 중 하나여야 합니다. 각 ID는 3D 모형에 연결됩니다.`,
      )
    }
    const id = values.product_id as ProductId
    if (!values.product_name || !values.category)
      throw new Error(`${line}행: 상품명과 카테고리를 입력해 주세요.`)
    if (values.product_name.length > 80 || values.category.length > 40)
      throw new Error(`${line}행: 상품명은 80자, 카테고리는 40자 이내로 입력해 주세요.`)
    // Spreadsheet formula prefixes are rejected so exported data remains safe to open in Excel.
    if (/^[=+@-]/.test(values.product_name) || /^[=+@-]/.test(values.category)) {
      throw new Error(`${line}행: 상품명과 카테고리는 =, +, -, @ 문자로 시작할 수 없습니다.`)
    }
    const unitPrice = parseNonnegative(values.unit_price, '단가', line)
    const stock = parseNonnegative(values.stock, '재고', line, true)
    const quantity = parseNonnegative(values.quantity, '판매 수량', line, true)
    if (!isDate(values.date))
      throw new Error(`${line}행: 날짜는 실제 존재하는 YYYY-MM-DD 형식이어야 합니다.`)
    const dateKey = `${id}:${values.date}`
    if (dates.has(dateKey))
      throw new Error(
        `${line}행: ${id}의 ${values.date} 데이터가 중복되었습니다. 상품별로 하루에 한 행만 입력해 주세요.`,
      )
    dates.add(dateKey)

    let product = products.get(id)
    if (!product) {
      product = {
        id,
        name: values.product_name,
        category: values.category,
        unitPrice,
        stock,
        sales: [],
      }
      products.set(id, product)
    } else if (
      product.name !== values.product_name ||
      product.category !== values.category ||
      product.unitPrice !== unitPrice ||
      product.stock !== stock
    ) {
      throw new Error(
        `${line}행: 같은 상품 ID의 상품명·카테고리·단가·현재 재고는 모든 행에서 같아야 합니다.`,
      )
    }
    product.sales.push({ date: values.date, quantity })
  })

  const missing = PRODUCT_IDS.filter((id) => !products.has(id))
  if (missing.length > 0)
    throw new Error(
      `3D 모형에 연결할 상품이 부족합니다. ${missing.join(', ')}의 데이터를 추가해 주세요.`,
    )

  const result = PRODUCT_IDS.map((id) => {
    const product = products.get(id)!
    product.sales.sort((a, b) => a.date.localeCompare(b.date))
    return product
  })
  // Reject values whose derived totals cannot be represented accurately.
  let total = 0
  let totalQuantity = 0
  let totalStock = 0
  for (const product of result) {
    totalStock += product.stock
    for (const sale of product.sales) {
      total += sale.quantity * product.unitPrice
      totalQuantity += sale.quantity
    }
  }
  if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER)
    throw new Error('판매 금액의 합계가 너무 큽니다. 단가와 판매 수량을 확인해 주세요.')
  if (!Number.isSafeInteger(totalQuantity) || !Number.isSafeInteger(totalStock))
    throw new Error('수량의 합계가 너무 큽니다. 판매 수량과 재고를 확인해 주세요.')
  return result
}

export function productsToCsv(products: Product[]): string {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  const rows = products.flatMap((product) =>
    product.sales.map((sale) =>
      [
        product.id,
        product.name,
        product.category,
        product.unitPrice,
        product.stock,
        sale.date,
        sale.quantity,
      ]
        .map(escape)
        .join(','),
    ),
  )
  return `\uFEFF${CSV_HEADERS.join(',')}\r\n${rows.join('\r\n')}\r\n`
}

export function getLatestDate(products: Product[]): string | undefined {
  let latest: string | undefined
  for (const product of products) {
    for (const sale of product.sales) if (!latest || sale.date > latest) latest = sale.date
  }
  return latest
}

/** Reporting windows end at the last date in the data, not the machine clock. */
export function getProductStats(
  product: Product,
  days: 7 | 30,
  referenceDate = getLatestDate([product]),
): { quantity: number; revenue: number } {
  if (!referenceDate) return { quantity: 0, revenue: 0 }
  const start = new Date(Date.parse(`${referenceDate}T00:00:00Z`) - (days - 1) * DAY)
    .toISOString()
    .slice(0, 10)
  const quantity = product.sales.reduce(
    (total, sale) => total + (sale.date >= start && sale.date <= referenceDate ? sale.quantity : 0),
    0,
  )
  return { quantity, revenue: quantity * product.unitPrice }
}

export function getDailyTotals(
  products: Product[],
  days: 7 | 30,
): { date: string; label: string; revenue: number; quantity: number }[] {
  const latest = getLatestDate(products)
  if (!latest) return []
  const end = Date.parse(`${latest}T00:00:00Z`)
  const totals = new Map(
    Array.from({ length: days }, (_, index) => {
      const date = new Date(end - (days - index - 1) * DAY).toISOString().slice(0, 10)
      return [
        date,
        { date, label: `${Number(date.slice(5, 7))}.${date.slice(8)}`, revenue: 0, quantity: 0 },
      ]
    }),
  )
  for (const product of products) {
    for (const sale of product.sales) {
      const day = totals.get(sale.date)
      if (day) {
        day.quantity += sale.quantity
        day.revenue += sale.quantity * product.unitPrice
      }
    }
  }
  return [...totals.values()]
}

export function formatCurrency(value: number): string {
  return `${formatNumber(value)}원`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)
}

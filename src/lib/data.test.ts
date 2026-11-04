import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SAMPLE_PRODUCTS } from '../data/sample'
import type { Product } from '../types'
import {
  getDailyTotals,
  getLatestDate,
  getProductStats,
  parseProductsCsv,
  productsToCsv,
} from './data'

const oneDayProducts = (): Product[] =>
  SAMPLE_PRODUCTS.map((product) => ({
    ...product,
    sales: [{ date: '2026-11-04', quantity: 2 }],
  }))

describe('CSV import and export', () => {
  it('roundtrips every sample product and all 120 daily records', () => {
    const csv = productsToCsv(SAMPLE_PRODUCTS)
    const parsed = parseProductsCsv(csv)
    expect(parsed).toEqual(SAMPLE_PRODUCTS)
    expect(parsed.flatMap((product) => product.sales)).toHaveLength(120)
    expect(getLatestDate(parsed)).toBe('2026-11-04')
  })

  it('keeps the downloadable CSV identical to the on-screen sample data', () => {
    const csv = readFileSync(new URL('../../public/sample-products.csv', import.meta.url), 'utf-8')
    expect(parseProductsCsv(csv)).toEqual(SAMPLE_PRODUCTS)
  })

  it('reads quoted commas, escaped quotes, BOM, CRLF and blank lines', () => {
    const products = oneDayProducts()
    products[0].name = '오늘의 "스페셜", 커피'
    expect(parseProductsCsv(`\r\n${productsToCsv(products)}`.replace('\uFEFF', ''))).toEqual(
      products,
    )
    expect(parseProductsCsv(productsToCsv(products))).toEqual(products)
  })

  it('supports reordered columns', () => {
    const csv = productsToCsv(oneDayProducts())
      .replace(/^\uFEFF/, '')
      .trim()
    const swapped = csv
      .split('\r\n')
      .map((row) => {
        const fields = row.split(',')
        ;[fields[0], fields[1]] = [fields[1], fields[0]]
        return fields.join(',')
      })
      .join('\n')
    expect(parseProductsCsv(swapped)).toEqual(oneDayProducts())
  })

  it.each([
    ['', '비어'],
    ['name,quantity\ncoffee,2', '열 이름'],
    ['product_id,product_name,category,unit_price,stock,date,quantity', '상품 데이터'],
    ['product_id,product_id,category,unit_price,stock,date,quantity', '열 이름'],
  ])('rejects an empty or incorrect schema (%s)', (csv, message) => {
    expect(() => parseProductsCsv(csv)).toThrow(message)
  })

  it.each([
    ['P001', 'P999', '상품 ID'],
    ['"2026-11-04"', '"2026-02-30"', '날짜'],
    ['"2026-11-04"', '"2025-02-29"', '날짜'],
    ['"2026-11-04"', '"2026/11/04"', '날짜'],
    ['"4500"', '"-1"', '단가'],
    ['"4500"', '"Infinity"', '단가'],
    ['"4500"', '"1e6"', '단가'],
    ['"4500"', '"0x10"', '단가'],
    ['"4500"', '""', '단가'],
    ['"128"', '"1.5"', '재고'],
    ['"2"', '"-3"', '판매 수량'],
    ['"2"', '"2.5"', '판매 수량'],
    ['"아메리카노"', '"=HYPERLINK()"', '시작할 수 없습니다'],
    ['"커피"', '"@SUM()"', '시작할 수 없습니다'],
  ])('rejects invalid values %s → %s', (before, after, message) => {
    const csv = productsToCsv(oneDayProducts()).replace(before, after)
    expect(() => parseProductsCsv(csv)).toThrow(message)
  })

  it('accepts an actual leap day', () => {
    const csv = productsToCsv(oneDayProducts()).replaceAll('2026-11-04', '2024-02-29')
    expect(getLatestDate(parseProductsCsv(csv))).toBe('2024-02-29')
  })

  it('requires all four scene IDs, rather than silently leaving objects unmapped', () => {
    expect(() => parseProductsCsv(productsToCsv(oneDayProducts().slice(0, 3)))).toThrow('P004')
  })

  it('rejects duplicate daily records', () => {
    const csv = productsToCsv(oneDayProducts())
    const duplicate = csv.split('\r\n')[1]
    expect(() => parseProductsCsv(`${csv}${duplicate}`)).toThrow('중복')
  })

  it('rejects inconsistent metadata for an existing product', () => {
    const csv = productsToCsv(oneDayProducts())
    const secondDay = csv
      .split('\r\n')[1]
      .replace('2026-11-04', '2026-11-03')
      .replace('4500', '4600')
    expect(() => parseProductsCsv(`${csv}${secondDay}`)).toThrow('모든 행에서 같아야')
  })

  it('rejects unterminated and malformed quoted fields', () => {
    expect(() => parseProductsCsv('"missing end')).toThrow('닫히지 않은')
    expect(() => parseProductsCsv('"closed"trailing')).toThrow('따옴표')
    expect(() => parseProductsCsv('wrong"quote')).toThrow('따옴표')
  })

  it('rejects rows with the wrong field count and unsafe derived totals', () => {
    expect(() => parseProductsCsv(productsToCsv(oneDayProducts()).replace(',"128"', ''))).toThrow(
      '열 개수',
    )
    const products = oneDayProducts()
    products[0].unitPrice = Number.MAX_SAFE_INTEGER
    expect(() => parseProductsCsv(productsToCsv(products))).toThrow('합계가 너무')
  })
})

describe('reporting windows', () => {
  it('uses the latest data date and includes both ends of a 7-day window', () => {
    const product: Product = {
      ...SAMPLE_PRODUCTS[0],
      unitPrice: 100,
      sales: [
        { date: '2026-10-28', quantity: 100 },
        { date: '2026-10-29', quantity: 2 },
        { date: '2026-11-04', quantity: 3 },
      ],
    }
    expect(getProductStats(product, 7)).toEqual({ quantity: 5, revenue: 500 })
    expect(getProductStats(product, 30)).toEqual({ quantity: 105, revenue: 10500 })
  })

  it('aligns sparse products with a shared reference date and fills missing days with zero', () => {
    const products = oneDayProducts()
    products[0].sales = [{ date: '2026-10-20', quantity: 100 }]
    expect(getProductStats(products[0], 7, getLatestDate(products))).toEqual({
      quantity: 0,
      revenue: 0,
    })
    const daily = getDailyTotals(products, 7)
    expect(daily).toHaveLength(7)
    expect(daily[0]).toEqual({ date: '2026-10-29', label: '10.29', revenue: 0, quantity: 0 })
    expect(daily[6]).toEqual({
      date: '2026-11-04',
      label: '11.04',
      quantity: 6,
      revenue: (5200 + 3800 + 6800) * 2,
    })
  })

  it('chart totals equal all product card totals for both period selections', () => {
    for (const days of [7, 30] as const) {
      const chartRevenue = getDailyTotals(SAMPLE_PRODUCTS, days).reduce(
        (sum, day) => sum + day.revenue,
        0,
      )
      const productRevenue = SAMPLE_PRODUCTS.reduce(
        (sum, product) => sum + getProductStats(product, days).revenue,
        0,
      )
      expect(chartRevenue).toBe(productRevenue)
      expect(chartRevenue).toBeGreaterThan(0)
    }
  })

  it('handles empty sales without NaN or invalid dates', () => {
    expect(getProductStats({ ...SAMPLE_PRODUCTS[0], sales: [] }, 7)).toEqual({
      quantity: 0,
      revenue: 0,
    })
    expect(getLatestDate([])).toBeUndefined()
    expect(getDailyTotals([], 30)).toEqual([])
  })
})

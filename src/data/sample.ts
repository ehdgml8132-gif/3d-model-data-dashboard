import type { Product, ProductId } from '../types'

export const PRODUCT_IDS: readonly ProductId[] = ['P001', 'P002', 'P003', 'P004']

const sampleDefinitions = [
  { id: 'P001', name: '아메리카노', category: '커피', unitPrice: 4500, stock: 128, base: 56 },
  { id: 'P002', name: '카페라테', category: '커피', unitPrice: 5200, stock: 86, base: 39 },
  { id: 'P003', name: '버터 크루아상', category: '베이커리', unitPrice: 3800, stock: 12, base: 25 },
  { id: 'P004', name: '딸기 케이크', category: '디저트', unitPrice: 6800, stock: 8, base: 17 },
] satisfies (Omit<Product, 'sales'> & { base: number })[]

/** Fixed dates and quantities keep demos reproducible; these are fictional sales. */
export const SAMPLE_PRODUCTS: Product[] = sampleDefinitions.map(
  ({ base, ...product }, productIndex) => ({
    ...product,
    sales: Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 9, 6 + index))
      const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 13 : 0
      const variation = ((index * 7 + productIndex * 3) % 17) - 8
      const growth = Math.floor(index / 7) * 2
      return {
        date: date.toISOString().slice(0, 10),
        quantity: base + weekend + variation + growth,
      }
    }),
  }),
)

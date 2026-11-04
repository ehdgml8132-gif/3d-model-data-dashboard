export type ProductId = 'P001' | 'P002' | 'P003' | 'P004'

export type DailySale = {
  /** Calendar date in YYYY-MM-DD format. No timezone conversion is applied. */
  date: string
  quantity: number
}

export type Product = {
  id: ProductId
  name: string
  category: string
  unitPrice: number
  stock: number
  sales: DailySale[]
}

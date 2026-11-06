/** Imported values stay text: identifiers are never numerically coerced. */
export type BusinessTable = {
  name: string
  headers: string[]
  rows: string[][]
}

export type BusinessWorkbook = {
  sheets: BusinessTable[]
  warnings?: string[]
}

export type BusinessModelElement = {
  id: string
  globalId?: string | null
  tag?: string | null
}

export type BusinessModelKey = 'globalId' | 'tag' | 'id'

export type BusinessElementMatch = {
  status: 'matched' | 'unmatched' | 'ambiguous'
  /** All matching source rows are retained, including ambiguous duplicates. */
  rows: string[][]
}

export type BusinessJoinResult = {
  byElementId: Map<string, BusinessElementMatch>
  diagnostics: {
    businessRows: number
    matchedElements: number
    unmatchedElements: number
    ambiguousElements: number
    blankBusinessKeys: number
    /** Model objects lacking the selected GlobalId/Tag/id value. */
    blankModelKeys: number
    /** Number of distinct business keys appearing more than once. */
    duplicateBusinessKeys: number
    /** Nonblank business rows without any corresponding model key. */
    unmatchedBusinessRows: number
    /** Number of distinct, nonblank model keys appearing more than once. */
    duplicateModelKeys: number
  }
}

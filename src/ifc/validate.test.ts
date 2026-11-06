import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateIfcBytes } from './validate'

const source = readFileSync(
  new URL('../../public/examples/authored-building.ifc', import.meta.url),
  'utf8',
)
const bytes = (text: string) => new TextEncoder().encode(text)

describe('IFC exchange-file validation', () => {
  it('accepts a long valid header and STEP comments around a complete file', () => {
    const longHeader = source.replace('HEADER;', `HEADER;\n/*${'x'.repeat(6400)}*/`)
    expect(() => validateIfcBytes(bytes(longHeader))).not.toThrow()
    expect(() =>
      validateIfcBytes(bytes(`\uFEFF /* leading */\n${source}\n/*${'trailing'.repeat(2000)}*/\n`)),
    ).not.toThrow()
  })
  it('rejects truncation that the permissive IFC engine can otherwise render partially', () => {
    expect(() => validateIfcBytes(bytes(source.split('#70=')[0]))).toThrow('파일의 끝')
    expect(() => validateIfcBytes(bytes(source.replace('END-ISO-10303-21;', '')))).toThrow(
      '파일의 끝',
    )
  })
  it('rejects non-IFC and an unterminated trailing comment', () => {
    expect(() => validateIfcBytes(bytes('name,value\n1,2'))).toThrow('유효한 IFC')
    expect(() => validateIfcBytes(bytes(`${source}/* not closed`))).toThrow('파일의 끝')
  })
})

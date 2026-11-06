const encoder = new TextEncoder()
const startToken = encoder.encode('ISO-10303-21;')
const endToken = encoder.encode('END-ISO-10303-21;')
const whitespace = (byte: number) => byte === 32 || (byte >= 9 && byte <= 13)

/** web-ifc accepts truncated STEP, so also require complete exchange-file delimiters. */
export function validateIfcBytes(bytes: Uint8Array): void {
  let first = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  let last = bytes.length - 1
  while (first <= last) {
    if (whitespace(bytes[first])) {
      first++
      continue
    }
    if (bytes[first] === 47 && bytes[first + 1] === 42) {
      first += 2
      while (first < last && !(bytes[first] === 42 && bytes[first + 1] === 47)) first++
      first += 2
      continue
    }
    break
  }
  if (!startToken.every((byte, index) => bytes[first + index] === byte)) {
    throw new Error('유효한 IFC STEP 파일이 아닙니다. Revit에서 내보낸 .ifc 파일을 선택해 주세요.')
  }
  while (last >= first) {
    if (whitespace(bytes[last])) {
      last--
      continue
    }
    if (bytes[last - 1] === 42 && bytes[last] === 47) {
      last -= 2
      while (last > first && !(bytes[last - 1] === 47 && bytes[last] === 42)) last--
      last -= 2
      continue
    }
    break
  }
  const endStart = last - endToken.length + 1
  if (endStart <= first || !endToken.every((byte, index) => bytes[endStart + index] === byte)) {
    throw new Error(
      'IFC 파일의 끝이 없거나 손상되었습니다. 파일을 완전히 내보낸 뒤 다시 업로드해 주세요.',
    )
  }
}

import { MAX_IFC_FILE_BYTES } from '../ifc/limits'
import { decodeProjectFile, encodeProjectFile } from './codec'
import type { SavedProject } from './types'
import { MAX_PROJECT_METADATA_BYTES } from './validation'

export const EMBEDDED_PROJECT_ID = 'monospace-project'
export const PROJECT_HTML_MIME = 'text/html;charset=utf-8'
export const MAX_PROJECT_HTML_TEMPLATE_BYTES = 32 * 1024 * 1024
const MAX_BINARY_BYTES = 12 + MAX_PROJECT_METADATA_BYTES + MAX_IFC_FILE_BYTES
const MAX_HTML_BYTES = Math.ceil(MAX_BINARY_BYTES / 3) * 4 + MAX_PROJECT_HTML_TEMPLATE_BYTES + 1024
const BINARY_CHUNK_BYTES = 48 * 1024
const BASE64_CHUNK_CHARACTERS = (BINARY_CHUNK_BYTES / 3) * 4
const HTML_PREFIX_BYTES = 4096
const CLOSE_PAYLOAD = '</script>'

function invalidPayload(): never {
  throw new Error('HTML 프로젝트의 모델 데이터가 잘렸거나 올바르지 않습니다.')
}

function encodedLength(bytes: number): number {
  if (!Number.isSafeInteger(bytes) || bytes <= 12 || bytes > MAX_BINARY_BYTES) invalidPayload()
  return Math.ceil(bytes / 3) * 4
}

function binaryChunk(encoded: string, last: boolean): Uint8Array<ArrayBuffer> {
  if (
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
    (!last && encoded.includes('='))
  )
    invalidPayload()
  let binary: string
  try {
    binary = atob(encoded)
    // Reject noncanonical padding bits as well as invalid Base64 characters.
    if (btoa(binary) !== encoded) invalidPayload()
  } catch {
    invalidPayload()
  }
  const result = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) result[index] = binary.charCodeAt(index)
  return result
}

async function decodePayload(
  bytes: number,
  read: (start: number, end: number) => Promise<string>,
): Promise<SavedProject> {
  const length = encodedLength(bytes)
  const parts: BlobPart[] = []
  let decodedBytes = 0
  for (let start = 0; start < length; start += BASE64_CHUNK_CHARACTERS) {
    const end = Math.min(start + BASE64_CHUNK_CHARACTERS, length)
    const encoded = await read(start, end)
    if (encoded.length !== end - start) invalidPayload()
    const part = binaryChunk(encoded, end === length)
    decodedBytes += part.byteLength
    parts.push(part)
  }
  if (decodedBytes !== bytes) invalidPayload()
  return decodeProjectFile(new File(parts, 'embedded-project.monospace'))
}

/** The payload is data, never executable markup. Its decoded binary still goes
 * through the same size, schema and IFC-descriptor validation as old backups.
 */
export async function decodeEmbeddedProject(encoded: string, bytes: number): Promise<SavedProject> {
  if (encoded.length !== encodedLength(bytes)) invalidPayload()
  return decodePayload(bytes, async (start, end) => encoded.slice(start, end))
}

/** Embed the exact original IFC and workspace into the self-contained app.
 * Build Blob parts in bounded chunks, avoiding a second full binary allocation
 * or a large spread call for IFC files near the upload limit.
 */
export async function encodeProjectHtml(project: SavedProject, template: string): Promise<Blob> {
  if (
    template.length > MAX_PROJECT_HTML_TEMPLATE_BYTES ||
    new TextEncoder().encode(template).byteLength > MAX_PROJECT_HTML_TEMPLATE_BYTES ||
    !/<html\b[^>]*\bdata-monospace-standalone="1"/i.test(template.slice(0, HTML_PREFIX_BYTES)) ||
    !/<script\b[^>]*\bid="monospace-app"/i.test(template) ||
    !/<style\b[^>]*\bid="monospace-styles"/i.test(template)
  )
    throw new Error('HTML 뷰어를 준비하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.')

  const binary = await encodeProjectFile(project)
  encodedLength(binary.size)
  const title = project.name.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]
  })
  const html = template
    .replace(
      /<html\b([^>]*)>/i,
      (_tag, attributes: string) =>
        `<html${attributes.replace(/\sdata-monospace-project="[^"]*"/gi, '')} data-monospace-project="1">`,
    )
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, () => `<title>${title}</title>`)
  const head = /<head\b[^>]*>/i.exec(html.slice(0, HTML_PREFIX_BYTES))
  if (!head) throw new Error('HTML 뷰어의 문서 형식이 올바르지 않습니다.')
  const insertion = head.index + head[0].length
  const parts: BlobPart[] = [
    html.slice(0, insertion),
    '<meta charset="UTF-8" />',
    `<script id="${EMBEDDED_PROJECT_ID}" type="application/octet-stream" data-bytes="${binary.size}">`,
  ]
  for (let start = 0; start < binary.size; start += BINARY_CHUNK_BYTES) {
    const bytes = new Uint8Array(
      await binary.slice(start, start + BINARY_CHUNK_BYTES).arrayBuffer(),
    )
    let characters = ''
    for (let index = 0; index < bytes.length; index++)
      characters += String.fromCharCode(bytes[index])
    parts.push(btoa(characters))
  }
  parts.push(CLOSE_PAYLOAD, html.slice(insertion))
  return new Blob(parts, { type: PROJECT_HTML_MIME })
}

/** Import only the bounded data block, without creating a DOM or executing any
 * scripts from an HTML file. Legacy .monospace files remain readable by magic.
 */
export async function decodeProjectDocument(file: File): Promise<SavedProject> {
  if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || !file.size)
    throw new Error('프로젝트 파일이 비어 있거나 올바르지 않습니다.')
  if (file.size > MAX_HTML_BYTES) throw new Error('HTML 프로젝트 파일이 처리 한도를 초과했습니다.')

  const magic = await file.slice(0, 8).text()
  if (magic === 'MONOPRJ1') return decodeProjectFile(file)

  const prefix = await file.slice(0, HTML_PREFIX_BYTES).text()
  const marker =
    /<head\b[^>]*>\s*<meta charset="UTF-8"\s*\/?>\s*<script id="monospace-project" type="application\/octet-stream" data-bytes="(\d{1,10})">/i.exec(
      prefix,
    )
  if (
    !marker ||
    !/<html\b[^>]*\bdata-monospace-standalone="1"/i.test(prefix.slice(0, marker.index))
  )
    throw new Error('Monospace에서 내보낸 HTML 또는 .monospace 프로젝트 파일을 선택해 주세요.')

  const bytes = Number(marker[1])
  const length = encodedLength(bytes)
  const start = new TextEncoder().encode(
    prefix.slice(0, marker.index + marker[0].length),
  ).byteLength
  const end = start + length
  if (
    end + CLOSE_PAYLOAD.length > file.size ||
    file.size - end > MAX_PROJECT_HTML_TEMPLATE_BYTES + 1024 ||
    (await file.slice(end, end + CLOSE_PAYLOAD.length).text()) !== CLOSE_PAYLOAD
  )
    invalidPayload()

  return decodePayload(bytes, (from, to) => file.slice(start + from, start + to).text())
}

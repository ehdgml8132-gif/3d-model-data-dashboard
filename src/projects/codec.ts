import { MAX_IFC_FILE_BYTES } from '../ifc/limits'
import type { SavedProject } from './types'
import { MAX_PROJECT_METADATA_BYTES, validateSavedProject } from './validation'

export const PROJECT_FILE_EXTENSION = '.monospace'
export const PROJECT_FILE_MIME = 'application/octet-stream'
const MAGIC = new TextEncoder().encode('MONOPRJ1')
const HEADER_BYTES = 12
const MAX_PROJECT_FILE_BYTES = HEADER_BYTES + MAX_PROJECT_METADATA_BYTES + MAX_IFC_FILE_BYTES

type RecordValue = Record<string, unknown>
const object = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Keep the original IFC as a binary Blob part instead of expanding it into
 * JSON/base64 or serializing the viewer's potentially much larger geometry.
 */
export async function encodeProjectFile(project: SavedProject): Promise<Blob> {
  const normalized = validateSavedProject(project)
  const { ifcFile, ...snapshot } = normalized.snapshot
  const metadata = {
    ...normalized,
    snapshot: {
      ...snapshot,
      ifcFile: { name: ifcFile.name, size: ifcFile.size, lastModified: ifcFile.lastModified },
    },
  }
  const text = JSON.stringify(metadata)
  if (text.length > MAX_PROJECT_METADATA_BYTES)
    throw new Error('프로젝트의 업무 데이터와 화면 설정은 64MB 이하로 저장해 주세요.')
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength > MAX_PROJECT_METADATA_BYTES)
    throw new Error('프로젝트의 업무 데이터와 화면 설정은 64MB 이하로 저장해 주세요.')
  const header = new Uint8Array(HEADER_BYTES)
  header.set(MAGIC)
  new DataView(header.buffer).setUint32(8, bytes.byteLength, true)
  return new Blob([header, bytes, ifcFile], { type: PROJECT_FILE_MIME })
}

/** Read bounded slices before allocating metadata. There is no archive
 * decompression, and the IFC payload must exactly match its declared size.
 */
export async function decodeProjectFile(file: File): Promise<SavedProject> {
  if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || file.size <= HEADER_BYTES)
    throw new Error('프로젝트 파일이 비어 있거나 올바르지 않습니다.')
  if (file.size > MAX_PROJECT_FILE_BYTES)
    throw new Error(
      '프로젝트 파일이 처리 한도를 초과했습니다. IFC 150MB와 화면 데이터 64MB까지 지원합니다.',
    )

  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
  if (header.byteLength !== HEADER_BYTES || MAGIC.some((byte, index) => header[index] !== byte))
    throw new Error('Monospace에서 내보낸 .monospace 프로젝트 파일을 선택해 주세요.')
  const length = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(
    8,
    true,
  )
  if (!length || length > MAX_PROJECT_METADATA_BYTES)
    throw new Error('프로젝트의 화면 데이터 크기가 올바르지 않습니다.')
  const offset = HEADER_BYTES + length
  if (offset >= file.size) throw new Error('프로젝트 파일이 잘렸거나 IFC 모델 데이터가 없습니다.')

  let metadata: unknown
  try {
    const bytes = await file.slice(HEADER_BYTES, offset).arrayBuffer()
    if (bytes.byteLength !== length) throw new Error('truncated metadata')
    metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error(
      '프로젝트의 화면 데이터를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.',
    )
  }
  if (!object(metadata) || metadata.version !== 1)
    throw new Error('지원하지 않는 프로젝트 버전입니다. 이 사이트에서 내보낸 파일을 선택해 주세요.')
  const snapshot = metadata.snapshot
  const descriptor = object(snapshot) ? snapshot.ifcFile : null
  if (
    !object(snapshot) ||
    !object(descriptor) ||
    typeof descriptor.name !== 'string' ||
    !descriptor.name.trim() ||
    descriptor.name.length > 1024 ||
    !/\.ifc$/i.test(descriptor.name) ||
    !Number.isSafeInteger(descriptor.size) ||
    (descriptor.size as number) <= 0 ||
    (descriptor.size as number) > MAX_IFC_FILE_BYTES ||
    typeof descriptor.lastModified !== 'number' ||
    !Number.isSafeInteger(descriptor.lastModified) ||
    descriptor.lastModified < 0
  )
    throw new Error('프로젝트의 원본 IFC 파일 정보가 올바르지 않습니다.')
  if (file.size - offset !== descriptor.size)
    throw new Error(
      '프로젝트 파일의 IFC 크기가 일치하지 않습니다. 파일이 잘리거나 손상되었을 수 있습니다.',
    )

  const ifcFile = new File([file.slice(offset)], descriptor.name, {
    type: 'application/octet-stream',
    lastModified: descriptor.lastModified,
  })
  return validateSavedProject({ ...metadata, snapshot: { ...snapshot, ifcFile } })
}

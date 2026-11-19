import type { ProjectSnapshot, ProjectSummary, SavedProject } from './types'
import { validateSavedProject } from './validation'

const DATABASE = 'monospace:projects:v1'
const PROJECTS = 'projects'
const SUMMARIES = 'summaries'

function storageError(error: unknown): Error {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  if (name === 'QuotaExceededError')
    return new Error(
      '브라우저 저장 공간이 부족합니다. 프로젝트를 파일로 내보내거나 저장한 항목을 정리해 주세요.',
    )
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotAllowedError')
    return new Error(
      '이 브라우저에서는 프로젝트 저장소를 사용할 수 없습니다. 프로젝트 파일로 내보내 주세요.',
    )
  if (name === 'AbortError')
    return new Error(
      '프로젝트 저장 작업이 중단됐습니다. 기존 저장본은 유지됩니다. 다시 시도해 주세요.',
    )
  return new Error(
    '브라우저 프로젝트 저장소에 접근하지 못했습니다. 다시 시도하거나 프로젝트 파일을 사용해 주세요.',
  )
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(
      new Error('이 브라우저는 프로젝트 저장을 지원하지 않습니다. 프로젝트 파일을 사용해 주세요.'),
    )
  return new Promise((resolve, reject) => {
    let settled = false
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DATABASE, 1)
    } catch (error) {
      reject(storageError(error))
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PROJECTS))
        database.createObjectStore(PROJECTS, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(SUMMARIES))
        database.createObjectStore(SUMMARIES, { keyPath: 'id' })
    }
    request.onerror = () => {
      settled = true
      reject(storageError(request.error))
    }
    request.onblocked = () => {
      settled = true
      reject(
        new Error(
          '다른 탭에서 프로젝트 저장소를 사용하고 있습니다. 해당 탭을 닫은 뒤 다시 시도해 주세요.',
        ),
      )
    }
    request.onsuccess = () => {
      const database = request.result
      if (settled) {
        database.close()
        return
      }
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void) => void,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  const database = await openDatabase()
  let abort: (() => void) | undefined
  try {
    signal?.throwIfAborted()
    return await new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction
      let result: T
      try {
        tx = database.transaction(stores, mode)
      } catch (error) {
        reject(storageError(error))
        return
      }
      abort = () => {
        try {
          tx.abort()
        } catch {
          /* A completed transaction can no longer be aborted. */
        }
      }
      signal?.addEventListener('abort', abort, { once: true })
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(signal?.aborted ? signal.reason : storageError(tx.error))
      try {
        work(tx, (value) => {
          result = value
        })
      } catch (error) {
        try {
          tx.abort()
        } catch {
          /* The transaction may already have aborted. */
        }
        reject(storageError(error))
      }
    })
  } finally {
    if (abort) signal?.removeEventListener('abort', abort)
    database.close()
  }
}

export function summarizeProject(record: SavedProject): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ifcName: record.snapshot.ifcFile.name,
    ifcBytes: record.snapshot.ifcFile.size,
    elementCount: record.snapshot.elementCount,
  }
}

export function buildProjectRecord(
  name: string,
  snapshot: ProjectSnapshot,
  previous?: Pick<ProjectSummary, 'id' | 'createdAt'>,
): SavedProject {
  const now = new Date().toISOString()
  return validateSavedProject({
    version: 1,
    id: previous?.id ?? crypto.randomUUID(),
    name: name.trim(),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    snapshot,
  })
}

/** Metadata has its own store: opening the project picker never reads IFC blobs. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const values = await transaction<ProjectSummary[]>([SUMMARIES], 'readonly', (tx, result) => {
    const request = tx.objectStore(SUMMARIES).getAll()
    request.onsuccess = () => result(request.result as ProjectSummary[])
  })
  if (!Array.isArray(values)) throw storageError(undefined)
  return values.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name),
  )
}

export async function readProject(id: string): Promise<SavedProject> {
  const value = await transaction<unknown>([PROJECTS], 'readonly', (tx, result) => {
    const request = tx.objectStore(PROJECTS).get(id)
    request.onsuccess = () => result(request.result)
  })
  if (value === undefined)
    throw new Error('저장한 프로젝트를 찾을 수 없습니다. 목록을 새로고침해 주세요.')
  return validateSavedProject(value)
}

/** Both stores commit together, so quota/error never replaces only half a save. */
export async function writeProject(project: SavedProject, signal?: AbortSignal): Promise<void> {
  const validated = validateSavedProject(project)
  await transaction<void>(
    [PROJECTS, SUMMARIES],
    'readwrite',
    (tx, result) => {
      tx.objectStore(PROJECTS).put(validated)
      tx.objectStore(SUMMARIES).put(summarizeProject(validated))
      result(undefined)
    },
    signal,
  )
}

export async function deleteProject(id: string): Promise<void> {
  await transaction<void>([PROJECTS, SUMMARIES], 'readwrite', (tx, result) => {
    tx.objectStore(PROJECTS).delete(id)
    tx.objectStore(SUMMARIES).delete(id)
    result(undefined)
  })
}

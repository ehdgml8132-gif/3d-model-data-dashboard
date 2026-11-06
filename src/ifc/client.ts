import { MAX_IFC_FILE_BYTES } from './limits'
import type { IfcModel, IfcProgress, IfcWorkerRequest, IfcWorkerResponse } from './types'

export type LoadIfcOptions = {
  onProgress?: (progress: IfcProgress) => void
  signal?: AbortSignal
}

export function loadIfcFile(file: File, options: LoadIfcOptions = {}): Promise<IfcModel> {
  if (options.signal?.aborted)
    return Promise.reject(new DOMException('불러오기를 취소했습니다.', 'AbortError'))
  if (file.size > MAX_IFC_FILE_BYTES)
    return Promise.reject(new Error('IFC 파일은 150 MB 이하로 선택해 주세요.'))
  if (!file.size) return Promise.reject(new Error('IFC 파일이 비어 있습니다.'))

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ifc.worker.ts', import.meta.url), { type: 'module' })
    let finished = false
    const finish = (error?: Error, model?: IfcModel) => {
      if (finished) return
      finished = true
      worker.terminate()
      options.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else if (model) resolve(model)
    }
    const abort = () => finish(new DOMException('불러오기를 취소했습니다.', 'AbortError'))
    options.signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<IfcWorkerResponse>) => {
      const data = event.data
      if (data.type === 'progress') options.onProgress?.(data.progress)
      else if (data.type === 'complete') finish(undefined, data.model)
      else if (data.type === 'error') finish(new Error(data.message))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      finish(
        new Error('IFC 처리 작업을 시작하지 못했습니다. 페이지를 새로 고친 후 다시 시도해 주세요.'),
      )
    }
    worker.onmessageerror = () =>
      finish(new Error('IFC 결과를 읽지 못했습니다. 더 작은 모델로 다시 시도해 주세요.'))
    const request: IfcWorkerRequest = {
      file,
      wasmPath: new URL(`${import.meta.env.BASE_URL}ifc/`, document.baseURI).href,
    }
    worker.postMessage(request)
    // Catch a signal aborted between the initial check and event registration.
    if (options.signal?.aborted) abort()
  })
}

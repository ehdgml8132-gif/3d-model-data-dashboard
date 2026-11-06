import * as WebIFC from 'web-ifc'
import { extractIfcModel } from './extract'
import { MAX_IFC_FILE_BYTES } from './limits'
import { validateIfcBytes } from './validate'
import type { IfcModel, IfcWorkerRequest, IfcWorkerResponse } from './types'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<IfcWorkerRequest>) => void) | null
  postMessage: (message: IfcWorkerResponse, transfer?: Transferable[]) => void
}

scope.onmessage = (event) => {
  void load(event.data)
}

async function load(request: IfcWorkerRequest) {
  let api: WebIFC.IfcAPI | undefined
  let modelId = -1
  let result: IfcModel | undefined
  let failure: string | undefined
  try {
    if (!request.file.size || request.file.size > MAX_IFC_FILE_BYTES)
      throw new Error('IFC 파일은 비어 있지 않은 150 MB 이하 파일로 선택해 주세요.')
    scope.postMessage({
      type: 'progress',
      progress: { percent: 2, message: 'IFC 파일을 확인합니다.' },
    })
    const bytes = new Uint8Array(await request.file.arrayBuffer())
    validateIfcBytes(bytes)
    api = new WebIFC.IfcAPI()
    api.SetWasmPath(request.wasmPath, true)
    scope.postMessage({
      type: 'progress',
      progress: { percent: 6, message: 'IFC 엔진을 준비합니다.' },
    })
    // One dedicated import worker provides cancellation without requiring
    // cross-origin-isolation headers or an extra pthread worker on the host.
    await api.Init(undefined, true)
    scope.postMessage({
      type: 'progress',
      progress: { percent: 12, message: 'IFC 모델과 좌표계를 해석합니다.' },
    })
    modelId = api.OpenModel(bytes, {
      COORDINATE_TO_ORIGIN: true,
      CIRCLE_SEGMENTS: 16,
      ALLOW_INCOMPATIBLE_SCHEMA_ALIASES: false,
    })
    if (modelId < 0 || !api.IsModelOpen(modelId))
      throw new Error('IFC 모델을 열지 못했습니다. IFC2X3·IFC4·IFC4X3 형식인지 확인해 주세요.')
    result = extractIfcModel(api, modelId, request.file.name, (progress) =>
      scope.postMessage({ type: 'progress', progress }),
    )
  } catch (error) {
    failure = error instanceof Error ? error.message : 'IFC 모델을 읽지 못했습니다.'
  } finally {
    if (api && modelId >= 0) {
      try {
        api.CloseModel(modelId)
      } catch {
        /* The failed model may already be closed. */
      }
    }
    try {
      api?.Dispose()
    } catch {
      /* Worker termination also releases the isolated heap. */
    }
  }
  // Release the WASM model before the client terminates this completed worker.
  if (result) {
    const transfer = new Set<Transferable>()
    for (const mesh of result.meshes)
      for (const buffer of [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer])
        transfer.add(buffer)
    scope.postMessage({ type: 'complete', model: result }, [...transfer])
  } else scope.postMessage({ type: 'error', message: failure || 'IFC 모델을 읽지 못했습니다.' })
}

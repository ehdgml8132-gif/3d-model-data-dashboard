import type { SavedProject } from './types'
import {
  decodeEmbeddedProject,
  EMBEDDED_PROJECT_ID,
  encodeProjectHtml,
  MAX_PROJECT_HTML_TEMPLATE_BYTES,
} from './html'

let templateRequest: Promise<string> | undefined
let embeddedRequest: Promise<SavedProject> | undefined
let embeddedHandled = false

function inlineScript(id: string): string {
  const script = document.getElementById(id)
  if (!(script instanceof HTMLScriptElement)) throw new Error('HTML 실행 코드를 찾지 못했습니다.')
  return `<script id="${id}" type="${script.type}">${(script.textContent || '').replace(/<\/script/gi, '<\\/script')}</script>`
}

/** Reuse only the original runtime assets, never the rendered workspace or the
 * previous project's payload. This keeps repeated offline exports independent.
 */
function currentStandaloneTemplate(): string | null {
  if (document.documentElement.dataset.monospaceStandalone !== '1') return null
  const styles = document.getElementById('monospace-styles')
  if (!(styles instanceof HTMLStyleElement)) throw new Error('HTML 화면 스타일을 찾지 못했습니다.')
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  const favicon = icon?.href.startsWith('data:image/') ? icon.outerHTML : ''
  const license = document.getElementById('web-ifc-license') ? inlineScript('web-ifc-license') : ''
  return `<!doctype html>
<html lang="ko" data-monospace-standalone="1">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#173e35" />
<meta name="web-ifc-source" content="https://github.com/ThatOpen/engine_web-ifc; version 0.0.78; MPL-2.0" />
${favicon}
<title>모노 스페이스 · 건물 모델 대시보드</title>
<style id="monospace-styles">${(styles.textContent || '').replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body><div id="root"></div>${inlineScript('monospace-app')}${license}</body>
</html>`
}

async function fetchTemplate(): Promise<string> {
  const response = await fetch(`${import.meta.env.BASE_URL}monospace-building-preview.html`, {
    cache: 'no-cache',
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error('HTML 뷰어 파일을 불러오지 못했습니다. 다시 시도해 주세요.')
  const parts: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  const reader = response.body?.getReader()
  if (!reader) throw new Error('HTML 뷰어 파일을 읽지 못했습니다. 다시 시도해 주세요.')
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_PROJECT_HTML_TEMPLATE_BYTES)
        throw new Error('HTML 뷰어 파일 크기가 올바르지 않습니다.')
      parts.push(value)
    }
  } catch (cause) {
    await reader.cancel().catch(() => {})
    throw cause
  } finally {
    reader.releaseLock()
  }
  return new Blob(parts).text()
}

export async function exportProjectHtml(project: SavedProject): Promise<Blob> {
  const local = currentStandaloneTemplate()
  if (local !== null) return encodeProjectHtml(project, local)
  templateRequest ??= fetchTemplate().catch((cause: unknown) => {
    templateRequest = undefined
    throw cause instanceof Error && cause.name === 'TimeoutError'
      ? new Error('HTML 뷰어를 불러오는 시간이 초과됐습니다. 인터넷 연결을 확인해 주세요.')
      : cause
  })
  return encodeProjectHtml(project, await templateRequest)
}

/** Reuse the pending decode when StrictMode reruns the startup effect. */
export function embeddedProjectToOpen(): Promise<SavedProject> | null {
  if (embeddedHandled) return null
  const script = document.getElementById(EMBEDDED_PROJECT_ID)
  if (!script) return null
  embeddedRequest ??= decodeEmbeddedProject(script.textContent || '', Number(script.dataset.bytes))
  return embeddedRequest ?? null
}

export function finishEmbeddedProject(): void {
  embeddedHandled = true
  embeddedRequest = undefined
  document.getElementById(EMBEDDED_PROJECT_ID)?.remove()
}

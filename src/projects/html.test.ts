import { describe, expect, it, vi } from 'vitest'
import { MAX_IFC_FILE_BYTES } from '../ifc/limits'
import { createBuildingMetricFilters } from '../lib/buildingFilters'
import { encodeProjectFile } from './codec'
import {
  decodeEmbeddedProject,
  decodeProjectDocument,
  EMBEDDED_PROJECT_ID,
  encodeProjectHtml,
  MAX_PROJECT_HTML_TEMPLATE_BYTES,
  PROJECT_HTML_MIME,
} from './html'
import type { SavedProject } from './types'
import { MAX_PROJECT_METADATA_BYTES } from './validation'

const originalBytes = new Uint8Array([73, 83, 79, 45, 49, 48, 51, 48, 51, 45, 50, 49, 59, 0, 255])
const template = `<!doctype html><html lang="ko" data-monospace-standalone="1" data-sample="building"><head><title>모델 뷰어</title><style id="monospace-styles">body{margin:0}</style></head><body><div id="root"></div><script id="monospace-app" type="module">globalThis.appReady=true</script></body></html>`

function project(): SavedProject {
  return {
    version: 1,
    id: 'project-html-test',
    name: '서울 현장 · 공정 검토',
    createdAt: '2026-01-01T01:02:03.000Z',
    updatedAt: '2026-01-02T03:04:05.000Z',
    snapshot: {
      ifcFile: new File([originalBytes], '서울-구조.IFC', { lastModified: 1767225600000 }),
      elementCount: 1,
      business: {
        fileName: '공정표.csv',
        table: { name: '업무 표', headers: ['Tag', '상태'], rows: [['0001', '검수 완료']] },
        modelKey: 'tag',
        column: 'Tag',
      },
      workspace: {
        activeView: 'data',
        metricFilters: createBuildingMetricFilters(),
        kind: 'column',
        query: '기둥',
        selectedId: 'IFC-44',
        sectionBox: { targetId: 'IFC-44', ranges: { x: [20, 80], y: [0, 100], z: [5, 95] } },
        camera: { position: [10, 8, 10], target: [0, 0, 0], zoom: 40, viewport: [1280, 800] },
        tablePage: 0,
      },
    },
  }
}

function payload(html: string) {
  const match =
    /<script id="monospace-project" type="application\/octet-stream" data-bytes="(\d+)">([^<]*)<\/script>/.exec(
      html,
    )!
  return { tag: match[0], bytes: Number(match[1]), encoded: match[2] }
}

function htmlFile(html: string) {
  return new File([html], 'project.html', { type: PROJECT_HTML_MIME })
}

describe('self-contained HTML project data', () => {
  it('round trips original IFC bytes, linked data and the full workspace in a real HTML document', async () => {
    const original = project()
    original.snapshot.workspace.sectionBox!.rotationY = 55
    const blob = await encodeProjectHtml(original, template)
    expect(blob.type).toBe(PROJECT_HTML_MIME)
    const html = await blob.text()
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toMatch(/<html\b[^>]*data-monospace-project="1"/)
    expect(template).not.toContain('data-monospace-project=')
    expect(html).toContain('<title>서울 현장 · 공정 검토</title>')
    expect(html).toContain('id="monospace-app"')
    expect(html).toContain('id="monospace-styles"')
    // Encoding must be declared before the large data block, inside the first
    // kilobyte, so opening the HTML from disk keeps Korean app code intact.
    expect(html).toContain(`<head><meta charset="UTF-8" /><script id="${EMBEDDED_PROJECT_ID}"`)
    expect(html.indexOf('<meta charset="UTF-8"')).toBeLessThan(1024)
    const decoded = await decodeProjectDocument(htmlFile(html))
    expect(decoded.name).toBe(original.name)
    expect(decoded.snapshot.workspace).toEqual(original.snapshot.workspace)
    expect(decoded.snapshot.business).toEqual(original.snapshot.business)
    expect(decoded.snapshot.ifcFile.name).toBe(original.snapshot.ifcFile.name)
    expect(decoded.snapshot.ifcFile.lastModified).toBe(original.snapshot.ifcFile.lastModified)
    expect(new Uint8Array(await decoded.snapshot.ifcFile.arrayBuffer())).toEqual(originalBytes)
  })

  it('keeps markup in project names, query and business cells inert and preserves literal values', async () => {
    const original = project()
    original.name = '</title><script>alert("name")</script> & 서울'
    original.snapshot.business!.table.rows[0][1] = '</script><script>alert("cell")</script>'
    original.snapshot.workspace.query = '<img src=x onerror=alert(1)>'
    const html = await (await encodeProjectHtml(original, template)).text()
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(&quot;name&quot;)')
    expect(html).not.toContain('<script>alert(')
    expect(html).not.toContain('onerror=')
    expect(html.match(/<title>/g)).toHaveLength(1)
    const embedded = payload(html)
    const decoded = await decodeEmbeddedProject(embedded.encoded, embedded.bytes)
    expect(decoded.name).toBe(original.name)
    expect(decoded.snapshot.business).toEqual(original.snapshot.business)
    expect(decoded.snapshot.workspace.query).toBe(original.snapshot.workspace.query)
  })

  it('handles multiple Base64 chunks and non-ASCII bytes before the head without changing binary data', async () => {
    const original = project()
    const largeBytes = Uint8Array.from({ length: 48 * 1024 * 2 + 5 }, (_, index) => index % 256)
    original.snapshot.ifcFile = new File([largeBytes], 'chunked.ifc', { lastModified: 0 })
    const html = await (
      await encodeProjectHtml(original, template.replace('<head>', '<!-- 서울 현장 -->\n<head>'))
    ).text()
    const decoded = await decodeProjectDocument(htmlFile(html))
    expect(new Uint8Array(await decoded.snapshot.ifcFile.arrayBuffer())).toEqual(largeBytes)
  })

  it('retains content-based importing of legacy binary project backups', async () => {
    const original = project()
    const binary = await encodeProjectFile(original)
    const decoded = await decodeProjectDocument(new File([binary], 'renamed.html'))
    expect(decoded.name).toBe(original.name)
    expect(decoded.snapshot.workspace).toEqual(original.snapshot.workspace)
    expect(new Uint8Array(await decoded.snapshot.ifcFile.arrayBuffer())).toEqual(originalBytes)
  })

  it.each([
    '<html><head></head><body>unrelated page</body></html>',
    template.replace('data-monospace-standalone="1"', ''),
    template.replace('id="monospace-app"', 'id="unknown-app"'),
    template.replace('id="monospace-styles"', 'id="unknown-styles"'),
  ])('rejects unrelated or incomplete viewer templates', async (value) => {
    await expect(encodeProjectHtml(project(), value)).rejects.toThrow(/HTML 뷰어/)
  })

  it('rejects unknown HTML without interpreting or executing its scripts', async () => {
    const execute = vi.fn()
    vi.stubGlobal('projectFileExecuted', execute)
    try {
      await expect(
        decodeProjectDocument(htmlFile('<html><script>projectFileExecuted()</script></html>')),
      ).rejects.toThrow(/Monospace/)
      expect(execute).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a changed declared size, invalid Base64, and missing payload trailer', async () => {
    const html = await (await encodeProjectHtml(project(), template)).text()
    const embedded = payload(html)
    const invalidSize = html.replace(`data-bytes="${embedded.bytes}"`, 'data-bytes="13"')
    await expect(decodeProjectDocument(htmlFile(invalidSize))).rejects.toThrow(/데이터/)
    await expect(
      decodeEmbeddedProject(`!${embedded.encoded.slice(1)}`, embedded.bytes),
    ).rejects.toThrow(/데이터/)
    await expect(
      decodeEmbeddedProject(`${embedded.encoded.slice(0, -4)}AAAA`, embedded.bytes + 1),
    ).rejects.toThrow()
    const noTrailer = html.replace(embedded.tag, embedded.tag.replace('</script>', ''))
    await expect(decodeProjectDocument(htmlFile(noTrailer))).rejects.toThrow(/데이터/)
  })

  it('rejects a truncated payload and a missing data block before reading the app body', async () => {
    const html = await (await encodeProjectHtml(project(), template)).text()
    const embedded = payload(html)
    const truncated = html.slice(0, html.indexOf(embedded.encoded) + 12)
    await expect(decodeProjectDocument(htmlFile(truncated))).rejects.toThrow(/데이터/)
    await expect(decodeProjectDocument(htmlFile(template))).rejects.toThrow(/Monospace/)
  })

  it('checks outer and declared limits before reading a large payload', async () => {
    const huge = htmlFile('placeholder')
    Object.defineProperty(huge, 'size', {
      value:
        Math.ceil((12 + MAX_PROJECT_METADATA_BYTES + MAX_IFC_FILE_BYTES) / 3) * 4 +
        MAX_PROJECT_HTML_TEMPLATE_BYTES +
        1025,
    })
    const slice = vi.spyOn(huge, 'slice')
    await expect(decodeProjectDocument(huge)).rejects.toThrow(/한도/)
    expect(slice).not.toHaveBeenCalled()
    const html = await (await encodeProjectHtml(project(), template)).text()
    await expect(
      decodeProjectDocument(htmlFile(html.replace(/data-bytes="\d+"/, 'data-bytes="9999999999"'))),
    ).rejects.toThrow(/데이터/)
  })

  it('validates saved workspace schema before either export or embedded import succeeds', async () => {
    const invalid = project()
    invalid.snapshot.workspace.metricFilters.volume = { min: 10, max: 1, includeUnknown: true }
    await expect(encodeProjectHtml(invalid, template)).rejects.toThrow(/체적 범위/)
    await expect(decodeEmbeddedProject('', NaN)).rejects.toThrow(/데이터/)
    await expect(decodeEmbeddedProject('', 0)).rejects.toThrow(/데이터/)
  })
})

import { build } from 'vite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'

// A downloadable, self-contained copy. The ordinary web build keeps lazy chunks.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: { 'template-only': { type: 'boolean', default: false }, 'out-dir': { type: 'string' } },
})
const outputDirectory = values['out-dir'] ? resolve(root, values['out-dir']) : join(root, 'dist')
const favicon = await readFile(join(root, 'public/favicon.svg'))
const faviconUrl = `data:image/svg+xml;base64,${favicon.toString('base64')}`
let workerInlined = false
let wasmInlined = false
const require = createRequire(import.meta.url)
const engineRoot = dirname(require.resolve('web-ifc'))
const wasm = await readFile(join(engineRoot, 'web-ifc.wasm'))
const engineLicense = await readFile(join(engineRoot, 'LICENSE.md'), 'utf8')
const wasmUrl = `data:application/wasm;base64,${wasm.toString('base64')}`
const result = await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  base: './',
  plugins: [
    {
      name: 'standalone-ifc-worker',
      enforce: 'pre',
      transform(source, id) {
        if (id.split('?')[0] !== join(root, 'src/ifc/client.ts')) return
        const constructor =
          /new Worker\(\s*new URL\('\.\/ifc\.worker\.ts',\s*import\.meta\.url\),\s*\{\s*type:\s*'module'\s*\}\s*\)/
        if (!constructor.test(source))
          throw new Error('Expected the IFC worker constructor for the standalone build.')
        workerInlined = true
        const code = source
          .replace(constructor, 'new StandaloneIfcWorker()')
          .replace('new URL(`${import.meta.env.BASE_URL}ifc/`, document.baseURI).href', "''")
        return {
          code: `import StandaloneIfcWorker from './ifc.worker.ts?worker&inline'\n${code}`,
          map: null,
        }
      },
    },
  ],
  worker: {
    // A classic inline worker also works for downloaded HTML with an opaque
    // file/document origin; the hosted website still uses an ES module worker.
    format: 'iife',
    plugins: () => [
      {
        name: 'standalone-ifc-wasm',
        enforce: 'pre',
        transform(source, id) {
          if (id.split('?')[0] !== join(root, 'src/ifc/ifc.worker.ts')) return
          if (!source.includes('await api.Init(undefined, true)'))
            throw new Error('Expected the IFC engine initialization for the standalone build.')
          wasmInlined = true
          return {
            code: source.replace(
              'await api.Init(undefined, true)',
              `await api.Init(() => ${JSON.stringify(wasmUrl)}, true)`,
            ),
            map: null,
          }
        },
      },
    ],
  },
  build: {
    write: false,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})

if (!workerInlined || !wasmInlined)
  throw new Error('The standalone IFC worker and engine must be embedded.')

const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output
const entry = outputs.find((item) => item.type === 'chunk' && item.isEntry)
const htmlAsset = outputs.find((item) => item.type === 'asset' && item.fileName === 'index.html')
const cssAssets = outputs.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
const otherChunks = outputs.filter((item) => item.type === 'chunk' && item !== entry)
if (!entry || !htmlAsset || otherChunks.length) {
  throw new Error('Expected one JavaScript entry and an HTML asset for the standalone preview.')
}

const asText = (source) =>
  typeof source === 'string' ? source : Buffer.from(source).toString('utf8')
let html = asText(htmlAsset.source)
// Escaping protects the HTML parser even if a future dependency contains this text.
const javascript = entry.code.replace(/<\/script/gi, '<\\/script')
const css = cssAssets.map((asset) => asText(asset.source)).join('\n')
html = html.replace(/<html([^>]*)>/i, '<html$1 data-monospace-standalone="1">')
html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/g, '')
html = html.replace(/<link\b[^>]*\brel="icon"[^>]*>/, `<link rel="icon" href="${faviconUrl}" />`)
html = html.replace('</head>', () => `<style id="monospace-styles">${css}</style>\n</head>`)
html = html.replace(
  '</head>',
  '<meta name="web-ifc-source" content="https://github.com/ThatOpen/engine_web-ifc; version 0.0.78; MPL-2.0" />\n</head>',
)
html = html.replace(
  '</body>',
  () =>
    `<script type="text/plain" id="web-ifc-license">${engineLicense.replace(/<\/script/gi, '<\\/script')}</script>\n</body>`,
)

// Complete every document transform before embedding code. Runtime strings can
// themselves contain </head>, </body>, <html> and <title> markup for re-export.
html = html.replace(
  /<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/,
  () => `<script id="monospace-app" type="module">${javascript}</script>`,
)

// Runtime HTML strings must stay inside the app script. Check the final script
// body and document markers so future transform-order regressions fail builds.
let application
const scaffold = html.replace(
  /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  (_script, attributes, code) => {
    if (/\bid="monospace-app"/.test(attributes)) application = code
    return `<script${attributes}></script>`
  },
)
if (
  application !== javascript ||
  !scaffold.includes('<style id="monospace-styles">') ||
  !scaffold.includes('id="web-ifc-license"')
)
  throw new Error('The standalone app script or document assets were corrupted during embedding.')
if (/(?:src|href)="(?:\.\/)?assets\//.test(scaffold))
  throw new Error('A local asset reference remains in the standalone preview.')

await mkdir(outputDirectory, { recursive: true })
if (!values['template-only']) {
  const destination = join(outputDirectory, 'monospace-preview.html')
  await writeFile(destination, html)
  console.log(
    `Standalone preview: ${destination} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`,
  )
}

const buildingDestination = join(outputDirectory, 'monospace-building-preview.html')
await writeFile(buildingDestination, html)
console.log(`Building preview: ${buildingDestination}`)

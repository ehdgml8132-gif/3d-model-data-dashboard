import { build } from 'vite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// A downloadable, self-contained copy. The ordinary web build keeps lazy chunks.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const csv = await readFile(join(root, 'public/sample-products.csv'))
const favicon = await readFile(join(root, 'public/favicon.svg'))
const csvUrl = `data:text/csv;charset=utf-8;base64,${csv.toString('base64')}`
const faviconUrl = `data:image/svg+xml;base64,${favicon.toString('base64')}`
const sampleUrlExpression = '`${import.meta.env.BASE_URL}sample-products.csv`'
let sampleUrlInlined = false
let workerInlined = false
let wasmInlined = false
const require = createRequire(import.meta.url)
const engineRoot = dirname(require.resolve('web-ifc'))
const wasm = await readFile(join(engineRoot, 'web-ifc.wasm'))
const engineLicense = await readFile(join(engineRoot, 'LICENSE.md'), 'utf8')
const wasmUrl = `data:application/wasm;base64,${wasm.toString('base64')}`
const embeddedExamples = new Map()
for (const name of ['authored-building.ifc', 'authored-building-data.csv']) {
  const bytes = await readFile(join(root, 'public/examples', name))
  embeddedExamples.set(
    `examples/${name}`,
    `data:${name.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'application/octet-stream'};base64,${bytes.toString('base64')}`,
  )
}

const result = await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  base: './',
  plugins: [
    {
      name: 'standalone-sample-download',
      enforce: 'pre',
      transform(source, id) {
        const file = id.split('?')[0]
        let code = source.replace(
          /`\$\{import\.meta\.env\.BASE_URL\}(examples\/[^`]+)`/g,
          (expression, name) => {
            const embedded = embeddedExamples.get(name)
            return embedded ? JSON.stringify(embedded) : expression
          },
        )
        if (file === join(root, 'src/ifc/client.ts')) {
          const constructor =
            /new Worker\(\s*new URL\('\.\/ifc\.worker\.ts',\s*import\.meta\.url\),\s*\{\s*type:\s*'module'\s*\}\s*\)/
          if (!constructor.test(code))
            throw new Error('Expected the IFC worker constructor for the standalone build.')
          workerInlined = true
          code = code
            .replace(constructor, 'new StandaloneIfcWorker()')
            .replace('new URL(`${import.meta.env.BASE_URL}ifc/`, document.baseURI).href', "''")
          return {
            code: `import StandaloneIfcWorker from './ifc.worker.ts?worker&inline'\n${code}`,
            map: null,
          }
        }
        if (file !== join(root, 'src/App.tsx'))
          return code !== source ? { code, map: null } : undefined
        if (code.split(sampleUrlExpression).length !== 2) {
          throw new Error('Expected one base-aware sample CSV URL expression in App.tsx.')
        }
        sampleUrlInlined = true
        return { code: code.replace(sampleUrlExpression, JSON.stringify(csvUrl)), map: null }
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

if (!sampleUrlInlined) throw new Error('The standalone sample CSV URL was not inlined.')
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
html = html.replace(
  /<script\b[^>]*\bsrc="[^\"]+"[^>]*><\/script>/,
  () => `<script type="module">${javascript}</script>`,
)
html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/g, '')
html = html.replace(/<link\b[^>]*\brel="icon"[^>]*>/, `<link rel="icon" href="${faviconUrl}" />`)
html = html.replace('</head>', () => `<style>${css}</style>\n</head>`)
html = html.replace(
  '</head>',
  '<meta name="web-ifc-source" content="https://github.com/ThatOpen/engine_web-ifc; version 0.0.78; MPL-2.0" />\n</head>',
)
html = html.replace(
  '</body>',
  () =>
    `<script type="text/plain" id="web-ifc-license">${engineLicense.replace(/<\/script/gi, '<\\/script')}</script>\n</body>`,
)
if (html.includes('/sample-products.csv') || /(?:src|href)="(?:\.\/)?assets\//.test(html)) {
  throw new Error('A local asset reference remains in the standalone preview.')
}
if (!html.includes(csvUrl))
  throw new Error('The sample CSV is missing from the standalone preview.')

const destination = join(root, 'dist/monospace-preview.html')
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, html)
console.log(
  `Standalone preview: ${destination} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`,
)

// The same app can start with the building example, while preserving the café
// as the default in the original artifact. Both files include the sample switch.
const buildingHtml = html
  .replace(/<html([^>]*)>/i, '<html$1 data-sample="building">')
  .replace(/<title>[^<]*<\/title>/, '<title>모노 스페이스 · 건물 모델 대시보드</title>')
const buildingDestination = join(root, 'dist/monospace-building-preview.html')
await writeFile(buildingDestination, buildingHtml)
console.log(`Building preview: ${buildingDestination}`)

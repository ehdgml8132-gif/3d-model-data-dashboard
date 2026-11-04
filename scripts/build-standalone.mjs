import { build } from 'vite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A downloadable, self-contained copy. The ordinary web build keeps lazy chunks.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const csv = await readFile(join(root, 'public/sample-products.csv'))
const favicon = await readFile(join(root, 'public/favicon.svg'))
const csvUrl = `data:text/csv;charset=utf-8;base64,${csv.toString('base64')}`
const faviconUrl = `data:image/svg+xml;base64,${favicon.toString('base64')}`
const sampleUrlExpression = '`${import.meta.env.BASE_URL}sample-products.csv`'
let sampleUrlInlined = false

const result = await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  base: './',
  plugins: [
    {
      name: 'standalone-sample-download',
      enforce: 'pre',
      transform(source, id) {
        if (id.split('?')[0] !== join(root, 'src/App.tsx')) return
        if (source.split(sampleUrlExpression).length !== 2) {
          throw new Error('Expected one base-aware sample CSV URL expression in App.tsx.')
        }
        sampleUrlInlined = true
        return { code: source.replace(sampleUrlExpression, JSON.stringify(csvUrl)), map: null }
      },
    },
  ],
  build: {
    write: false,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})

if (!sampleUrlInlined) throw new Error('The standalone sample CSV URL was not inlined.')

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

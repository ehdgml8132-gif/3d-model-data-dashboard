import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

const require = createRequire(import.meta.url)
const engineDirectory = dirname(require.resolve('web-ifc'))
const assetNames = ['web-ifc.wasm', 'LICENSE.md']

// Serve the locked npm package locally. IFC files never visit a CDN or API.
export function ifcAssets(): Plugin {
  return {
    name: 'local-ifc-engine-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        const name = assetNames.find((asset) => pathname.endsWith(`/ifc/${asset}`))
        if (!name) return next()
        const bytes = readFileSync(join(engineDirectory, name))
        response.setHeader(
          'Content-Type',
          name.endsWith('.wasm')
            ? 'application/wasm'
            : name.endsWith('.js')
              ? 'text/javascript; charset=utf-8'
              : 'text/plain; charset=utf-8',
        )
        response.setHeader('Cache-Control', 'no-cache')
        response.end(bytes)
      })
    },
    generateBundle() {
      for (const name of assetNames) {
        this.emitFile({
          type: 'asset',
          fileName: `ifc/${name}`,
          source: readFileSync(join(engineDirectory, name)),
        })
      }
    },
  }
}

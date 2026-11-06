import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { ifcAssets } from './scripts/ifc-assets'

export default defineConfig({
  // Relative assets work at both a custom domain root and a project subpath.
  base: './',
  plugins: [react(), ifcAssets()],
  // Discover lazily used parsers before the first upload, so development does
  // not reload the page and discard a file being read by the worker.
  optimizeDeps: { include: ['web-ifc', 'exceljs', 'fflate'] },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})

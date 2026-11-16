import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

const templateName = 'monospace-building-preview.html'

/** Build on first export in development. Ordinary dev startup stays fast, and
 * the production command emits this same self-contained file after Vite.
 */
export function projectHtmlTemplate(): Plugin {
  return {
    name: 'project-html-export-template',
    configureServer(server) {
      const root = server.config.root
      const outputDirectory = join(root, 'node_modules/.cache/monospace-html')
      let revision = 0
      let cachedRevision = -1
      let cached: Buffer | undefined
      let pending: Promise<void> | undefined
      let child: ChildProcess | undefined

      const invalidate = (file: string) => {
        const path = resolve(file)
        if (
          ['src', 'public', 'scripts'].some((directory) =>
            path.startsWith(join(root, directory) + sep),
          ) ||
          path === join(root, 'index.html') ||
          path === join(root, 'vite.config.ts') ||
          path === join(root, 'package.json') ||
          path === join(root, 'package-lock.json')
        )
          revision++
      }
      server.watcher.on('all', (_event, file) => invalidate(file))
      server.httpServer?.once('close', () => child?.kill())

      async function template(): Promise<Buffer> {
        // Serialize builds if sources change during a request; an older result
        // never becomes the cached template for a newer source revision.
        while (cachedRevision !== revision) {
          if (!pending) {
            const buildingRevision = revision
            pending = new Promise<void>((resolveBuild, rejectBuild) => {
              child = spawn(
                process.execPath,
                [
                  join(root, 'scripts/build-standalone.mjs'),
                  '--template-only',
                  '--out-dir',
                  outputDirectory,
                ],
                { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
              )
              let log = ''
              const collect = (chunk: Buffer) => {
                log = (log + chunk.toString()).slice(-64 * 1024)
              }
              child.stdout?.on('data', collect)
              child.stderr?.on('data', collect)
              child.once('error', rejectBuild)
              child.once('close', (code) => {
                child = undefined
                if (code !== 0)
                  rejectBuild(new Error(`Project HTML template build failed.\n${log}`))
                else resolveBuild()
              })
            })
              .then(async () => {
                cached = await readFile(join(outputDirectory, templateName))
                cachedRevision = buildingRevision
              })
              .finally(() => {
                pending = undefined
              })
          }
          await pending
        }
        return cached!
      }

      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        if (!pathname.endsWith(`/${templateName}`)) return next()
        void template().then(
          (bytes) => {
            if (response.destroyed) return
            response.setHeader('Content-Type', 'text/html; charset=utf-8')
            response.setHeader('Cache-Control', 'no-store')
            response.end(request.method === 'HEAD' ? undefined : bytes)
          },
          (error: unknown) => {
            server.config.logger.error(error instanceof Error ? error.message : String(error))
            if (response.destroyed) return
            response.statusCode = 500
            response.setHeader('Content-Type', 'text/plain; charset=utf-8')
            response.end(
              '프로젝트 HTML 파일을 준비하지 못했습니다. 개발 서버 로그를 확인해 주세요.',
            )
          },
        )
      })
    },
  }
}

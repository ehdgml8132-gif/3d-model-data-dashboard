import { execFileSync } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Package only the regular web build. Downloadable single-file previews and
// other archives in dist are deliberately excluded from the deployed site.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'dist')
for (const name of ['index.html', 'assets', 'favicon.svg', 'sample-products.csv']) {
  await access(join(output, name))
}

const destination = join(output, 'monospace-website.zip')
const zipScript = `
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
files = [root / name for name in ('index.html', 'favicon.svg', 'sample-products.csv')]
files.extend(sorted((root / 'assets').rglob('*')))
with ZipFile(destination, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for path in files:
        if path.is_file():
            resolved = path.resolve()
            if not resolved.is_relative_to(root):
                raise RuntimeError('A deployment asset points outside the build directory.')
            archive.write(path, path.relative_to(root).as_posix())
    archive.writestr('.nojekyll', '')
`
execFileSync('python3', ['-c', zipScript, output, destination], { stdio: 'inherit' })
const { size } = await stat(destination)
console.log(`Website package: ${destination} (${(size / 1024 / 1024).toFixed(2)} MB)`)

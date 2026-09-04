import { fileURLToPath, URL } from 'node:url'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

function filesIn(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? filesIn(path.join(directory, entry.name)) : [path.join(directory, entry.name)],
  ).sort()
}

export function literaShellPlugin(): Plugin {
  let publicDir = fileURLToPath(new URL('./public', import.meta.url))
  const require = createRequire(import.meta.url)
  const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'))
  return {
    name: 'litera-offline-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { publicDir = config.publicDir },
    buildStart() {
      // Stable URLs consumed by PDF.js; all contents participate in the build hash.
      for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
        for (const filename of filesIn(path.join(pdfRoot, directory))) {
          this.emitFile({ type: 'asset', fileName: 'pdfjs/' + path.relative(pdfRoot, filename).split(path.sep).join('/'), source: fs.readFileSync(filename) })
        }
      }
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const resources = new Map<string, string | Uint8Array>()
        for (const output of Object.values(bundle)) {
          if (output.fileName.endsWith('.map')) continue
          resources.set('/' + output.fileName, output.type === 'chunk' ? output.code : output.source)
        }
        for (const filename of [path.join(publicDir, 'manifest.webmanifest'), ...filesIn(path.join(publicDir, 'icons'))]) {
          resources.set('/' + path.relative(publicDir, filename).split(path.sep).join('/'), fs.readFileSync(filename))
        }
        if (!resources.has('/index.html')) this.error('Offline shell build requires index.html')
        const template = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8')
        const urls = [...resources.keys()].sort()
        const hash = createHash('sha256').update(template)
        for (const url of urls) hash.update(url).update('\0').update(resources.get(url)!).update('\0')
        const build = hash.digest('hex').slice(0, 24)
        const source = template.replace("'__LITERA_BUILD__'", JSON.stringify(build))
          .replace('/* __LITERA_PRECACHE__ */ []', JSON.stringify(urls))
        this.emitFile({ type: 'asset', fileName: 'sw.js', source })
      },
    },
  }
}

export default defineConfig({
  plugins: [vue(), literaShellPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)), '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  build: { outDir: 'dist/web', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000', '/content': 'http://localhost:3000', '/legacy': 'http://localhost:3000' } },
})

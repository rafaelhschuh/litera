import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { ensureOptimizedCover, optimizeCover, storeOptimizedCover } from '../src/server/covers.js'

describe('web cover optimization', () => {
  it('never downloads PDF content to render a catalog cover in the browser', async () => {
    const component = await fs.readFile(path.resolve('src/web/components/BookCover.vue'), 'utf8')
    expect(component).not.toContain('pdfjs-dist')
    expect(component).not.toContain('/content')
  })

  it('creates a progressive JPEG within the web display bounds', async () => {
    const source = await sharp({ create: { width: 1600, height: 2400, channels: 4, background: '#74394b' } }).png().toBuffer()
    const optimized = await optimizeCover(source)
    const metadata = await sharp(optimized).metadata()

    expect(metadata).toMatchObject({ format: 'jpeg', width: 640, height: 960, isProgressive: true })
    expect(optimized.length).toBeLessThan(100_000)
  })

  it('stores new covers atomically and upgrades legacy files', async () => {
    const directory = await fs.mkdtemp(path.join('/tmp', 'litera-cover-'))
    try {
      const source = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#315e49' } }).png().toBuffer()
      const legacyPath = path.join(directory, 'legacy.png')
      await fs.writeFile(legacyPath, source)

      const upgradedPath = await ensureOptimizedCover(legacyPath)
      expect(upgradedPath).toBe(path.join(directory, 'legacy.web.jpg'))
      expect((await sharp(upgradedPath).metadata()).format).toBe('jpeg')
      expect(await ensureOptimizedCover(upgradedPath)).toBe(upgradedPath)

      const storedPath = await storeOptimizedCover(source, path.join(directory, 'manual'))
      expect(storedPath).toBe(path.join(directory, 'manual.web.jpg'))
      expect((await fs.stat(storedPath)).mode & 0o777).toBe(0o600)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
})

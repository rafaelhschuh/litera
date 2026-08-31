import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const MAX_COVER_WIDTH = 640
const MAX_COVER_HEIGHT = 960
const MAX_INPUT_PIXELS = 40_000_000

export class InvalidCoverError extends Error {}

export async function optimizeCover(data: Buffer): Promise<Buffer> {
  try {
    return await sharp(data, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, pages: 1 })
      .rotate()
      .resize({ width: MAX_COVER_WIDTH, height: MAX_COVER_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#f4f1ec' })
      .jpeg({ quality: 80, progressive: true, chromaSubsampling: '4:2:0', mozjpeg: true })
      .toBuffer()
  } catch (error) { throw new InvalidCoverError('Cover image is invalid or corrupt', { cause: error }) }
}

export async function storeOptimizedCover(data: Buffer, destinationBase: string): Promise<string> {
  const coverPath = `${destinationBase}.web.jpg`
  const temporaryPath = `${coverPath}.${randomUUID()}.tmp`
  fs.mkdirSync(path.dirname(coverPath), { recursive: true })
  try {
    const optimized = await optimizeCover(data)
    await fs.promises.writeFile(temporaryPath, optimized, { mode: 0o600 })
    await fs.promises.rename(temporaryPath, coverPath)
    return coverPath
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true })
    throw error
  }
}

export async function ensureOptimizedCover(coverPath: string): Promise<string> {
  if (coverPath.endsWith('.web.jpg')) return coverPath
  const extension = path.extname(coverPath)
  const destinationBase = extension ? coverPath.slice(0, -extension.length) : coverPath
  return storeOptimizedCover(await fs.promises.readFile(coverPath), destinationBase)
}

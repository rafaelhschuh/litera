import type { BookFormat } from './progress.js'
export { readerTapZone } from './reader-interaction.js'

export type ReaderCapabilities = { toc: boolean; search: boolean; typography: boolean; themes: boolean; zoom: boolean; pages: boolean; fullscreen: boolean }
export function readerCapabilities(format: BookFormat): ReaderCapabilities {
  return format === 'epub'
    ? { toc: true, search: true, typography: true, themes: true, zoom: false, pages: false, fullscreen: true }
    : { toc: false, search: true, typography: false, themes: false, zoom: true, pages: true, fullscreen: true }
}

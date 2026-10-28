import { readerFonts, resolveReaderTypography, type ReaderTypography } from './reader-typography.js'

export type EpubNavigationItem = { id: string; label: string; depth: number; href?: string; chapterHref?: string }

export type EpubAppearance = Partial<ReaderTypography> & {
  flow?: 'scroll' | 'paginated'
  fontScale: number
  theme: 'light' | 'sepia' | 'dark'
  lineHeight: 'compact' | 'normal' | 'relaxed'
  margins: 'narrow' | 'normal' | 'wide'
}

// Same reader palette and layout as the server document; appearance is not part
// of a downloaded chapter's identity.
export function epubAppearanceCss(preferences: EpubAppearance): string {
  const palette = preferences.theme === 'dark' ? ['#20201e', '#eeeeea'] : preferences.theme === 'sepia' ? ['#f4ead6', '#302a21'] : ['#ffffff', '#272520']
  const scale = Math.min(200, Math.max(80, Number(preferences.fontScale) || 100))
  const typography = resolveReaderTypography(preferences), lineHeight = typography.lineSpacing
  const measure = ({ narrow: 42, normal: 56, wide: 72 })[preferences.margins] ?? 56
  const flow = preferences.flow === 'paginated' ? `html,body{height:100%;overflow:hidden;overscroll-behavior:none}body{margin:0}.reader-pages{position:relative;width:100%;height:100%;overflow:hidden;scroll-behavior:auto;overflow-anchor:none}.reader-pages::after{content:"";position:absolute;left:calc(var(--epub-page-count,1)*100% - 1px);top:0;width:1px;height:1px;pointer-events:none}.reader-pages>.reader-document{box-sizing:border-box;width:100%!important;height:100%;min-height:0;margin:0;padding:var(--epub-top) var(--epub-gutter) var(--epub-bottom);--epub-gutter:max(${typography.marginSize}px,calc((var(--epub-viewport-width) - ${measure}rem)/2));column-count:1;column-width:auto;column-fill:auto;column-gap:calc(2 * var(--epub-gutter));column-rule:none;overflow-wrap:anywhere}.reader-document img,.reader-document svg{max-height:max(1px,calc(var(--epub-viewport-height) - var(--epub-top) - var(--epub-bottom)));object-fit:contain}.reader-document p,.reader-document blockquote{break-inside:auto}` : `.reader-document{box-sizing:border-box;padding-left:${typography.marginSize}px!important;padding-right:${typography.marginSize}px!important;padding-top:${typography.marginTop}px!important;padding-bottom:${typography.marginBottom}px!important;column-count:1!important;column-width:auto!important;overflow-anchor:none}`
  const font = typography.fontFamily === 'publisher' ? '' : `.reader-document{font-family:${readerFonts[typography.fontFamily].css}!important}.reader-document *{font-family:inherit!important}.reader-document pre,.reader-document code{font-family:monospace!important}`
  const align = typography.textAlign === 'publisher' ? '' : `text-align:${typography.textAlign}!important;`
  return `html{--epub-viewport-width:100vw;--epub-viewport-height:100vh;--epub-top:min(${typography.marginTop}px,max(0px,calc((var(--epub-viewport-height) - 6rem)/2)));--epub-bottom:min(${typography.marginBottom}px,max(0px,calc((var(--epub-viewport-height) - 6rem)/2)))}html,body{background:${palette[0]}!important;color:${palette[1]}!important;scroll-behavior:auto!important}.reader-document{font-size:${18 * scale / 100}px!important;line-height:${lineHeight}!important;letter-spacing:${typography.letterSpacing}em!important;width:min(${measure}rem,100%)!important;${align}}.reader-document p{margin-top:0!important;margin-bottom:${typography.paragraphSpacing}em!important;line-height:inherit!important;${align}}${font}${flow}`
}

const cssUrlPattern = () => /url\(\s*(?:"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|((?:\\.|[^\s)'"\\])+))\s*\)/gi
const cssString = (value: string) => value.replace(/\\([\\"'()])/g, '$1')

/** References in already-sanitized CSS; quoted URLs may legally contain parentheses. */
export function cssResourceReferences(css: string): string[] {
  const references = [...css.matchAll(cssUrlPattern())].map(match => cssString(match[1] ?? match[2] ?? match[3] ?? ''))
  const imports = /@import\s+(?!url\()(?:(?:"((?:\\.|[^"\\\n])*)")|(?:'((?:\\.|[^'\\\n])*)'))/gi
  for (const match of css.matchAll(imports)) references.push(cssString(match[1] ?? match[2] ?? ''))
  return references
}

export async function rewriteCssResources(css: string, resolve: (url: string) => Promise<string>): Promise<string> {
  // Server-sanitized CSS only. Resolve quoted and unquoted url() references,
  // including font-face and background images, without evaluating CSS.
  const matches = [...css.matchAll(cssUrlPattern())]
  let output = '', end = 0
  for (const match of matches) {
    output += css.slice(end, match.index)
    const target = await resolve(cssString(match[1] ?? match[2] ?? match[3] ?? ''))
    output += `url(${JSON.stringify(target)})`
    end = match.index! + match[0].length
  }
  return output + css.slice(end)
}

/** Input must be the existing server-sanitized reader document, never raw EPUB. */
export async function prepareEpubDocument(html: string, preferences: EpubAppearance, resolve?: (url: string) => Promise<string>, stylesheet?: (url: string) => Promise<string>): Promise<string> {
  const document = new DOMParser().parseFromString(html, 'text/html')
  if (!document.querySelector('.reader-document')) throw new Error('O capítulo não retornou conteúdo legível.')
  // Keep the sandbox boundary even if a stored document predates the CSP meta.
  document.querySelectorAll('script,object,embed,iframe,base,form,meta[http-equiv="refresh" i]').forEach(node => node.remove())
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name)
  }
  const csp = document.createElement('meta')
  csp.httpEquiv = 'Content-Security-Policy'
  csp.content = "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  document.head.prepend(csp)
  if (resolve) {
    for (const image of document.querySelectorAll('img[src],image[href],image[xlink\\:href]')) {
      for (const attribute of ['src', 'href', 'xlink:href']) {
        const url = image.getAttribute(attribute)
        if (url) image.setAttribute(attribute, await resolve(url))
      }
    }
    for (const style of document.querySelectorAll('style')) style.textContent = await rewriteCssResources(style.textContent ?? '', resolve)
    for (const element of document.querySelectorAll('[style]')) element.setAttribute('style', await rewriteCssResources(element.getAttribute('style') ?? '', resolve))
    for (const link of document.querySelectorAll('link[rel="stylesheet"][href]')) {
      if (!stylesheet) throw new Error('A folha de estilos não está disponível offline.')
      const style = document.createElement('style')
      style.textContent = await stylesheet(link.getAttribute('href')!)
      link.replaceWith(style)
    }
  }
  if (preferences.flow === 'paginated') {
    const viewport = document.createElement('div')
    viewport.className = 'reader-pages'
    const content = document.querySelector('.reader-document')!
    content.replaceWith(viewport); viewport.append(content)
  }
  const appearance = document.createElement('style')
  appearance.dataset.literaAppearance = 'true'
  appearance.textContent = epubAppearanceCss(preferences)
  document.head.append(appearance)
  return '<!doctype html>' + document.documentElement.outerHTML
}

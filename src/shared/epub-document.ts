export type EpubAppearance = {
  fontScale: number
  theme: 'light' | 'sepia' | 'dark'
  lineHeight: 'compact' | 'normal' | 'relaxed'
  margins: 'narrow' | 'normal' | 'wide'
}

// Same reader palette and layout as the server document; appearance is not part
// of a downloaded chapter's identity.
export function epubAppearanceCss(preferences: EpubAppearance): string {
  const palette = preferences.theme === 'dark' ? ['#20201e', '#eeeeea'] : preferences.theme === 'sepia' ? ['#f4ead6', '#302a21'] : ['#ffffff', '#272520']
  const scale = Math.min(140, Math.max(80, Number(preferences.fontScale) || 100))
  const lineHeight = ({ compact: 1.45, normal: 1.65, relaxed: 1.85 })[preferences.lineHeight] ?? 1.65
  const measure = ({ narrow: 42, normal: 56, wide: 72 })[preferences.margins] ?? 56
  return `html,body{background:${palette[0]}!important;color:${palette[1]}!important}.reader-document{font-size:${18 * scale / 100}px!important;line-height:${lineHeight}!important;width:min(${measure}rem,100%)!important}@media(min-width:1100px) and (orientation:landscape){.reader-document{width:min(${measure + 24}rem,calc(100% - 4rem))!important}}`
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
  const appearance = document.createElement('style')
  appearance.dataset.literaAppearance = 'true'
  appearance.textContent = epubAppearanceCss(preferences)
  document.head.append(appearance)
  return '<!doctype html>' + document.documentElement.outerHTML
}

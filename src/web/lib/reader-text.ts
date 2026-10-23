import type { TextAnchor } from '../../shared/text-highlights'

/** A stable text stream: styling/mark wrappers never change its character offsets. */
export function readerTextNodes(root: Node): Text[] {
  const document = root.ownerDocument!, walker = document.createTreeWalker(root, 4)
  const nodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node.textContent && !node.parentElement?.closest('style,script,noscript')) nodes.push(node as Text)
  }
  return nodes
}

export function selectionAnchor(root: HTMLElement, range: Range, scope: TextAnchor['scope']): TextAnchor | undefined {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
  // Range.toString includes style contents; use the same filtered stream as rendering.
  const nodes = readerTextNodes(root)
  let start = 0, end = 0
  for (const node of nodes) {
    const probe = root.ownerDocument.createRange(); probe.selectNodeContents(node)
    if (range.startContainer === node) start += range.startOffset
    else if (range.compareBoundaryPoints(Range.START_TO_START, probe) >= 0) start += node.length
    if (range.endContainer === node) end += range.endOffset
    else if (range.compareBoundaryPoints(Range.END_TO_END, probe) >= 0) end += node.length
  }
  const text = nodes.map(node => node.data).join(''), exact = text.slice(start, end)
  if (!exact.trim() || exact.length > 10000) return
  return { version: 1, scope, start, end, exact, prefix: text.slice(Math.max(0, start - 48), start), suffix: text.slice(end, end + 48) }
}

export function rangeAtTextOffset(root: HTMLElement, offset: number): Range | undefined {
  for (const node of readerTextNodes(root)) {
    if (offset < node.length) {
      const range = root.ownerDocument.createRange(); range.setStart(node, Math.max(0, offset)); range.setEnd(node, Math.min(node.length, offset + 1)); return range
    }
    offset -= node.length
  }
}

/** First character actually visible in a paginated column, including split paragraphs. */
export function visibleTextOffset(root: HTMLElement): number {
  const width = root.ownerDocument.defaultView!.innerWidth, height = root.ownerDocument.defaultView!.innerHeight
  let offset = 0
  for (const node of readerTextNodes(root)) {
    const range = root.ownerDocument.createRange(); range.selectNodeContents(node)
    if ([...range.getClientRects()].some(rect => rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height)) {
      for (let index = 0; index < node.length; index++) {
        range.setStart(node, index); range.setEnd(node, index + 1)
        const rect = range.getBoundingClientRect()
        if (rect.width && rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height) return offset + index
      }
    }
    offset += node.length
  }
  return 0
}

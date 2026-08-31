export type TextHighlightRange = { chunkIndex: number; start: number; end: number }

type NormalizedText = {
  text: string
  sourceIndexes: number[][]
  owners: number[]
}

function normalizeText(chunks: string[]): NormalizedText {
  let text = ''
  const owners: number[] = []
  const sourceIndexes = chunks.map(() => [] as number[])

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex] ?? ''
    if (text && !text.endsWith(' ') && chunk && !/^\s/.test(chunk)) {
      text += ' '
      owners.push(chunkIndex)
    }
    for (let sourceIndex = 0; sourceIndex < chunk.length; sourceIndex++) {
      const character = chunk[sourceIndex]!
      if (/\s/.test(character)) {
        if (text && !text.endsWith(' ')) {
          text += ' '
          owners.push(chunkIndex)
        }
      } else {
        text += character.toLocaleLowerCase()
        owners.push(chunkIndex)
      }
      sourceIndexes[chunkIndex]![sourceIndex] = Math.max(0, text.length - 1)
    }
  }

  return { text: text.trimEnd(), sourceIndexes, owners }
}

export function findTextHighlightRanges(chunks: string[], quote: string, preferredChunk?: number): TextHighlightRange[] {
  const normalized = normalizeText(chunks)
  const needle = quote.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  if (!needle) return []

  let matchStart = normalized.text.indexOf(needle)
  if (matchStart < 0) return []
  if (preferredChunk !== undefined) {
    let bestDistance = Math.abs((normalized.owners[matchStart] ?? 0) - preferredChunk)
    for (let next = normalized.text.indexOf(needle, matchStart + 1); next >= 0; next = normalized.text.indexOf(needle, next + 1)) {
      const distance = Math.abs((normalized.owners[next] ?? 0) - preferredChunk)
      if (distance < bestDistance) { matchStart = next; bestDistance = distance }
    }
  }

  const matchEnd = matchStart + needle.length
  return normalized.sourceIndexes.flatMap((indexes, chunkIndex) => {
    let start = -1, end = -1
    for (let sourceIndex = 0; sourceIndex < indexes.length; sourceIndex++) {
      const normalizedIndex = indexes[sourceIndex]!
      if (normalizedIndex >= matchStart && normalizedIndex < matchEnd) {
        if (start < 0) start = sourceIndex
        end = sourceIndex + 1
      }
    }
    return start < 0 ? [] : [{ chunkIndex, start, end }]
  })
}

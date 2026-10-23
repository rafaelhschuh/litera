type Prepared = { release: () => void }
type Entry<T> = { controller: AbortController; claimed: boolean; promise: Promise<T> }

/** Only adjacent content lives here. Taking an entry transfers its ownership. */
export class ReaderPreparation<T extends Prepared> {
  private entries = new Map<string, Entry<T>>()
  constructor(private readonly limit = 2) {}

  warm(key: string, load: (signal: AbortSignal) => Promise<T>): void {
    if (this.entries.has(key)) return
    while (this.entries.size >= this.limit) this.remove(this.entries.keys().next().value!)
    const entry = { controller: new AbortController(), claimed: false } as Entry<T>
    entry.promise = Promise.resolve().then(() => {
      if (entry.controller.signal.aborted) throw new DOMException('Preparação cancelada.', 'AbortError')
      return load(entry.controller.signal)
    }).then(value => {
      if (entry.controller.signal.aborted) { value.release(); throw new DOMException('Preparação cancelada.', 'AbortError') }
      return value
    }).catch(error => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    })
    this.entries.set(key, entry)
    // Optional work must never cause an unhandled rejection or a reader error.
    void entry.promise.catch(() => undefined)
  }

  take(key: string): Promise<T> | undefined {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key); entry.claimed = true
    return entry.promise
  }

  retain(keys: string[]): void { for (const key of this.entries.keys()) if (!keys.includes(key)) this.remove(key) }
  clear(): void { for (const key of this.entries.keys()) this.remove(key) }
  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key); entry.controller.abort()
    void entry.promise.then(value => { if (!entry.claimed) value.release() }, () => undefined)
  }
}

type Timer = ReturnType<typeof setTimeout>

export class QueuedProgressSaver<T> {
  private pending: T | undefined
  private timer: Timer | undefined
  private running: Promise<void> | undefined

  constructor(private readonly save: (value: T) => Promise<void>, private readonly delayMs = 650) {}

  schedule(value: T): void {
    this.pending = value
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined) }, this.delayMs)
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.running) {
      await this.running
      if (this.pending) await this.flush()
      return
    }
    if (!this.pending) return
    const value = this.pending
    this.pending = undefined
    this.running = this.save(value)
    try {
      await this.running
    } catch (error) {
      if (!this.pending) this.pending = value
      throw error
    } finally {
      this.running = undefined
    }
    if (this.pending) await this.flush()
  }

  async dispose(): Promise<void> {
    await this.flush()
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}

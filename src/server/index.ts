import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { startAutomaticScans } from './jobs.js'

const config = loadConfig()
const { app, db } = createApp(config)
const stopAutomaticScans = startAutomaticScans(db, config)
const server = app.listen(config.port, '0.0.0.0', () => console.log(JSON.stringify({ level: 'info', event: 'server_started', port: config.port, version: '0.4.0' })))

let stopping = false
function shutdown(signal: string): void {
  if (stopping) return
  stopping = true
  stopAutomaticScans()
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }))
  server.close(() => {
    const deadline = Date.now() + 10_000
    const wait = setInterval(() => {
      const running = (db.prepare(`SELECT COUNT(*) AS count FROM scan_jobs WHERE status='running'`).get() as { count: number }).count
      if (!running || Date.now() >= deadline) {
        clearInterval(wait)
        if (running) db.prepare(`UPDATE scan_jobs SET status='queued',started_at=NULL,error='Interrupted during shutdown' WHERE status='running'`).run()
        db.close()
        process.exit(0)
      }
    }, 100)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

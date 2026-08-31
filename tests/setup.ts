import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { createApp } from '../src/server/app.js'
import type { AppConfig } from '../src/server/config.js'
import { writeEpub, writePdf } from './fixtures.js'

export async function testContext() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litera-test-'))
  const books = path.join(root, 'books'); const data = path.join(root, 'data')
  await fs.mkdir(books); await writeEpub(path.join(books, 'island.epub')); await writePdf(path.join(books, 'caderno.pdf'))
  const config: AppConfig = { port: 0, dataDir: data, allowedBookRoots: [books], adminUsername: 'admin', adminPassword: 'test-password-strong-123', secureCookies: false, openLibraryEnabled: false, maxBookBytes: 512 * 1024 * 1024 }
  const created = createApp(config)
  const agent = request.agent(created.app)
  return { ...created, config, agent, root, books, cleanup: async () => { created.db.close(); await fs.rm(root, { recursive: true, force: true }) } }
}

export async function login(agent: ReturnType<typeof request.agent>, username = 'admin', password = 'test-password-strong-123') {
  return agent.post('/api/v1/auth/login').send({ username, password })
}

import { auth } from './auth'

export type UploadResult = { filename: string; job: { id: number; status: string } }

/** Streaming browser upload, with real byte progress and the active account boundary. */
export function uploadBook(libraryId: number, file: File, signal: AbortSignal, progress: (sent: number, total: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Envio cancelado.')); return }
    const userId = auth.user?.id
    if (!userId) { reject(new Error('Entre novamente antes de enviar livros.')); return }
    const request = new XMLHttpRequest()
    request.open('POST', `/api/v1/admin/libraries/${libraryId}/upload?filename=${encodeURIComponent(file.name)}`)
    request.setRequestHeader('Content-Type', 'application/octet-stream')
    request.setRequestHeader('X-Litera-User', String(userId))
    request.timeout = 10 * 60 * 1000
    request.upload.onprogress = event => progress(event.loaded, event.lengthComputable ? event.total : file.size)
    const abort = () => request.abort()
    const release = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    request.onload = () => {
      release()
      if (auth.user?.id !== userId) { reject(new Error('A conta ativa mudou. Entre novamente.')); return }
      let body: any
      try { body = JSON.parse(request.responseText) } catch { reject(new Error('O servidor retornou uma resposta inválida.')); return }
      if (request.status < 200 || request.status >= 300) reject(new Error(body?.error?.message ?? 'Não foi possível enviar o livro.'))
      else resolve(body as UploadResult)
    }
    request.onerror = () => { release(); reject(new Error('A conexão caiu. Confira a biblioteca antes de tentar novamente.')) }
    request.ontimeout = () => { release(); reject(new Error('O envio demorou demais. Confira a biblioteca e tente novamente.')) }
    request.onabort = () => { release(); reject(new Error('Envio cancelado. Se a transferência já terminou, confira a catalogação em Jobs.')) }
    request.send(file)
  })
}

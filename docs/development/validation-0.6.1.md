# Validação 0.6.1 — 2026-10-23

Ambiente local: Node 22.23.4, SQLite, Chromium, Playwright WebKit e Docker. Escopo web/backend; sem validação de APK ou de aparelho físico.

## Checks

- `npm run typecheck`, `npm run lint` e `npm run build`: passaram.
- `npm test`: 199 testes em 21 arquivos passaram, incluindo identidade/capas, upload/job, erros em rescan, migração, autorização, seleção exata e conteúdo alterado com tamanho/data preservados.
- `npm run test:e2e -- --project=chromium --project=chromium-mobile`: 51 testes passaram na regressão completa. Após os ajustes finais de preparação de capas e do harness de transporte, os 12 casos de EPUB, offline, feedback de sync e startup pertinentes foram repetidos nesses motores.
- WebKit: regressão do leitor executada; os casos de EPUB, seleção, paginação, rotação e startup passaram. A falha no teste de feedback de sync foi corrigida no harness com service worker bloqueado para interceptação determinística e conferência da revisão real na API. O cenário de API indisponível passou após isolar a limitação de `setOffline` descrita em [testing.md](testing.md).
- `LITERA_STORAGE_BROWSER=webkit npm test -- tests/offline-store.test.ts tests/offline-sync.test.ts`: 29 testes passaram.
- `docker build -t litera:0.6.1 .`: passou.

## Upgrade real em container

Instalação da imagem 0.6.0 com biblioteca EPUB/PDF, progresso e capa manual; simulação de associação errada de capa automática no banco anterior; atualização para a imagem 0.6.1 usando os mesmos volumes.

Verificado pelo fluxo HTTP real:

1. Migration 7 → 8 agenda o job de reparação automaticamente.
2. A capa automática volta a corresponder ao próprio EPUB; a capa manual permanece igual.
3. IDs, progresso e capítulos continuam disponíveis.
4. Upload seguido de job publica o novo livro sem duplicar registros anteriores.
5. Preferência `paginated` e progresso sobrevivem ao restart do container.

Os containers de verificação e seus volumes temporários foram removidos. Nenhuma fonte de livro foi alterada pelo scanner.

## Limites práticos

- Páginas EPUB são locais ao capítulo e dependem da tela, fonte e margens. A posição salva continua textual/semântica.
- Destaques anteriores sem Range exato não permitem reconstruir com segurança uma seleção ambígua; nesses casos é necessário refazer o destaque.
- A primeira revisão do catálogo lê integralmente os arquivos dentro do limite configurado. Scans continuam em jobs observáveis.
- WebKit automatizado não comprova modo avião em Safari físico. Chromium desktop/mobile cobrem offline do contexto e reabertura real do navegador.

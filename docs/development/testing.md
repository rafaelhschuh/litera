# Testing Strategy

## Principles

Tests should trace to requirements and reader behavior. The highest-risk area is the reader/progress boundary, followed by filesystem reconciliation and metadata matching.

## Test layers

### Unit

- EPUB/PDF locator normalization.
- Progress calculations and restore rules.
- Metadata normalization and matching confidence.
- Library identity/reconciliation logic.
- Cover optimization and server-side PDF first-page rendering.
- Authorization policies.

### Integration

- Scan -> catalog -> metadata enrichment.
- Rescan backfill of missing PDF covers without source-file changes.
- Provider timeout/failure handling.
- Progress persistence and concurrent updates.
- Protected library access.

### Browser/E2E

- Login.
- Browse/search/open book.
- EPUB reading and position restore.
- PDF reading and page restore.
- Continue Reading.
- Responsive layouts.
- Reduced-capability/legacy-compatible path.

## Compatibility testing

The project should maintain a practical matrix containing at least one current Chromium/WebKit/Firefox environment and a legacy reference environment representative of the iOS 10.x / old WebKit generation. When exact emulator availability is constrained, keep a documented manual-device acceptance path.

## Acceptance priority

1. Reader can open and resume.
2. Progress survives reload/device changes.
3. Legacy reference can complete the core reading flow.
4. Scanning is idempotent.
5. Metadata enrichment improves results without breaking local use.
6. Authorization boundaries hold.


## Regressões 0.6.1

- `tests/catalog-identity.test.ts`: upload seguido de job com colisão de inode determinística, reparação/versionamento de capas, hard links, substituição atômica, prioridade manual e erro persistente em rescan.
- `tests/reader-stability.test.ts`: offsets exatos, seleção entre chunks, contexto único e rejeição de citações antigas ambíguas.
- `tests/e2e/reader.spec.ts`: início do capítulo por sumário/avanço, segunda palavra repetida no mesmo nó, seleção invertida/aninhada, reload/tema, paginação por viewport, rotação, retorno entre capítulos e troca de modo.
- `tests/integration.test.ts`: preferência EPUB e compatibilidade de payloads antigos, validação do escopo das âncoras, capas e autorização existentes.
- `tests/beta.test.ts`: migration aditiva agenda reparo durável preservando usuários, catálogo e progresso.
- `/legacy` mantém navegação conservadora; Android não faz parte desta entrega. Safari físico continua sendo uma validação do mantenedor, separada do WebKit automatizado.

No WebKit automatizado desta rodada, `BrowserContext.setOffline(true)` faz até `new Blob(['hello']).text()` e `FileReader` falharem com `NotReadableError`. O novo E2E de paginação offline induz respostas 503 da API exclusivamente para aquele browser no servidor de testes e dispara o evento offline nesse motor, confirma a indisponibilidade da API e que a preferência não chegou ao servidor antes da reconexão. Chromium desktop/mobile usam o modo offline do contexto. Isso é evidência de comportamento sob falha de transporte no WebKit; não substitui modo avião em Safari físico. O teste de feedback de sync bloqueia service workers para poder segurar a requisição determinísticamente e verifica o estado persistido pela API.

## Regressões 0.7.0

- `tests/reader-preparation.test.ts`: deduplicação, limite de vizinhança, transferência de propriedade, cancelamento e liberação tardia, falha/retry e isolamento da chave de aparência.
- `tests/e2e/mobile-reader.spec.ts`: ordem/seleção da barra, painel Outros/foco/Escape/rota administrativa, desktop/leitor, alvos a 320px, redução de movimento; contagem real de fetch EPUB antecipado e reutilização, keyframes sem opacity e sem transform no iframe, gesto horizontal; canvas PDF antecipado reutilizado por identidade; PDF adaptado antecipado sem abrir o binário; leitura sem APIs opcionais de apresentação.
- `tests/e2e/offline.spec.ts` usa Outros para logout em celulares e mantém os mesmos critérios de isolamento e limpeza de conta.
- A suíte de reader continua cobrindo capítulos/páginas, rotação, seleção/destaques, preferências, restauração, CSP e os dois modos PDF. A suíte offline continua cobrindo edição local, assets, fila de sync e mudanças de conta.

O teste de erro em PDF adaptado instala a falha antes de preparar a página vizinha: uma resposta já preparada permanece utilizável quando a rede falha depois. O helper de leitura aceita também **Reler** para livros concluídos. Inicie o servidor E2E somente depois de encerrar o build; substituir `dist` durante a execução invalida chunks do bundle que já está aberto.

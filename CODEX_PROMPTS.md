# Litera — Codex Implementation Prompts

Run Codex from the repository root. Use the prompts **in order**. Each prompt is intentionally full-stack and vertical: do not split a stage into “frontend only” or “backend only”. Every stage must end with a runnable integrated Litera.

---

## Prompt 1 — MVP funcional end-to-end

```text
Você está na raiz do repositório Litera. Sua tarefa é IMPLEMENTAR o MVP funcional do produto, não apenas planejar ou criar scaffolding.

Antes de alterar qualquer arquivo, leia integralmente:
- AGENTS.md
- README.md
- docs/product/vision-and-scope.md
- docs/product/requirements.md
- docs/frontend/frontend-foundation.md
- docs/frontend/ui-ux-technical-spec.md
- docs/architecture/overview.md
- docs/architecture/data-and-integrations.md
- docs/security/threat-model.md
- docs/development/testing.md
- docs/development/git-and-ci.md
- docs/development/definition-of-ready-and-done.md
- docs/development/implementation-roadmap.md
- todos os ADRs em docs/decisions/

Trate esses arquivos como contrato. Se uma decisão de implementação relevante não estiver definida, escolha a opção mais simples, mantida, segura e reversível que respeite a foundation; documente decisões arquiteturais significativas em ADR. Não pare para pedir confirmação sobre escolhas comuns de engenharia. Não reescreva o produto para caber em uma biblioteca.

REGRA DE EXECUÇÃO:
Trabalhe verticalmente e mantenha o sistema executável ao longo do trabalho. Não implemente o backend inteiro primeiro para só depois implementar o frontend inteiro, nem entregue uma SPA com mocks ou uma API sem UI. Para cada fluxo crítico, implemente UI + API + persistência + autorização + testes suficientes para o fluxo funcionar de verdade.

OBJETIVO DO MVP:
Ao final, uma instalação nova via Docker Compose deve permitir que um administrador entre no Litera, configure uma pasta de biblioteca montada no servidor, faça scan de EPUB/PDF reais, veja o catálogo, pesquise, abra detalhes, leia EPUB/PDF no browser, tenha progresso por usuário persistido/restaurado, veja Continue Reading e consiga usar o fluxo essencial no /legacy quando o modo legacy estiver habilitado.

Implemente no mínimo:

1. Fundação executável
- Estrutura TypeScript coerente para servidor, app moderno, cliente legacy e packages compartilhados quando fizer sentido.
- npm como package manager.
- Scripts reais e documentados para dev, build, typecheck, lint, test e start.
- Dockerfile(s) e docker-compose.yml funcionais com volumes persistentes e mount de biblioteca.
- Configuração por env com exemplo seguro; sem segredos commitados.
- Healthcheck de aplicação.

2. Backend/API e persistência reais
- Aplicação HTTP TypeScript mantida e adequada ao projeto.
- Banco persistente com migrations versionadas.
- Modelo mínimo real para User, Library, BookFile/Book, ReadingProgress e configuração do sistema; mantenha a separação física/lógica prevista na foundation.
- Bootstrap seguro do primeiro administrador, com senha hasheada por algoritmo atual apropriado.
- Login/logout/sessão seguros para aplicação web; autorização server-side para admin e dados por usuário.
- API versionável ou boundary estável, sem API duplicada para /legacy.
- Erros HTTP consistentes e validação de input.

3. Bibliotecas e scanner
- Admin consegue cadastrar uma library apontando apenas para caminhos permitidos/montados.
- Scan manual funcional para EPUB e PDF.
- Scan idempotente: re-scan de arquivo inalterado não duplica livro.
- Remoção/ausência é reconciliada sem apagar/modificar arquivo fonte.
- Extraia metadados embarcados mínimos (título/autor/identificadores/capa quando disponível) com bibliotecas maduras e seguras.
- Arquivo corrompido vira erro de ingestão visível, não derruba scan inteiro.
- Nunca aceite path arbitrário vindo do browser fora das roots configuradas.

4. Catálogo moderno
Implemente usando os tokens/components/patterns da UI spec, evitando componentes duplicados por tela:
- /login
- / com Continue Reading + Recently Added
- /library
- /search
- /books/:id
- navegação responsiva/AppShell
- estados loading, empty, filtered-empty e error relevantes
- BookCard/BookGrid/BookCover/BookProgress reutilizáveis
- favoritos podem ficar fora somente se a foundation os tratar como opcionais; não crie fake feature.

5. Reader real
- ReaderShell separado do AppShell.
- Contrato de Reader Core/format adapters independente da UI sempre que possível.
- EPUB abre conteúdo real no browser usando engine madura sob adapter.
- PDF abre conteúdo real usando engine madura sob adapter.
- EPUB salva locator semântico estável quando tecnicamente disponível + progressRatio derivado.
- PDF salva página/posição + progressRatio derivado.
- Persistência é debounced/batched.
- Reload e reabertura restauram a posição mais próxima válida.
- Toolbar, TOC quando disponível, navegação básica e controles apropriados ao formato.
- Não renderize livro inteiro de forma descontrolada quando a engine permite paginação/render incremental.
- Conteúdo de livro é não confiável: isole/sanitize conteúdo ativo conforme threat model; scripts do EPUB não podem executar no origin privilegiado da aplicação.

6. Admin mínimo, porém real
- /admin dashboard simples.
- /admin/libraries e detalhe com criar/editar library, disparar scan, último status e erros.
- /admin/compatibility com Switch reutilizável para legacy.enabled.
- /admin/system com informações essenciais de versão/saúde/configuração não secreta.
- AdminShell e componentes compartilhados; não crie um segundo design system.

7. /legacy funcional
Siga ADR-0003.
- Cliente separado em /legacy, sem depender de Vue moderno se isso comprometer o WebKit antigo.
- Bundle conservador e pequeno, CSS simples e JS compatível com a baseline legacy definida.
- /legacy/login
- /legacy
- /legacy/library
- /legacy/search
- /legacy/books/:id
- /legacy/read/:bookId para EPUB obrigatoriamente.
- Mesma autenticação/API/progresso do produto moderno.
- Quando legacy.enabled=false, /legacy/* falha de forma controlada.
- PDF legacy é best-effort nesta fase: implemente somente se a engine escolhida puder ser validada sem comprometer o MVP; caso contrário mostre indisponibilidade explícita, não uma tela quebrada.

8. Metadata enrichment mínimo
- Implemente o provider boundary da foundation.
- Se houver uma fonte pública atual, documentada e legalmente adequada que possa ser integrada sem credencial obrigatória, implemente pelo menos um provider opcional; verifique documentação/licença atual antes de escolher.
- Se nenhuma opção puder ser usada responsavelmente, entregue o adapter contract + provider desabilitado por padrão + documentação do bloqueio real; não invente API nem faça scraping frágil só para marcar requisito.
- Falha externa nunca impede leitura local.

9. Qualidade mínima obrigatória
- Unit tests para locator/progress, autorização e identidade/reconciliação do scanner.
- Integration tests para login, scan->catalog, progress persistence/restore e autorização.
- E2E/smoke test pelo menos para login -> library -> book -> reader -> salvar progresso -> reabrir.
- E2E ou smoke específico do /legacy nas capacidades automatizáveis.
- CI real substituindo o sanity check: install, typecheck, lint, tests, build e container smoke quando viável.
- Sem TypeScript errors, lint errors ou testes ignorados sem justificativa.

REGRAS DE UI:
- Reuse os componentes definidos na UI spec.
- Não crie HomeBookCard/SearchBookCard/FavoriteBookCard se BookCard + variant resolve.
- Não invente cores/spacing/radius locais.
- Desktop, tablet e mobile precisam ser utilizáveis.
- Não sacrifique legibilidade do reader por efeitos visuais.

REGRAS DE SEGURANÇA:
- Siga docs/security/threat-model.md.
- Books, filenames, metadata, HTML EPUB e provider responses são input não confiável.
- Autorize toda leitura/escrita protegida no servidor.
- Previna traversal, XSS, CSRF conforme o modelo de sessão escolhido, SSRF de providers e exposição de segredos.

NÃO CONSIDERE A TAREFA CONCLUÍDA até cumprir este GATE DE SAÍDA:
A. `docker compose up` (ou comando documentado equivalente) sobe uma instalação limpa sem edição manual de código.
B. Um admin real consegue autenticar.
C. Uma pasta montada contendo ao menos um EPUB e um PDF reais pode ser cadastrada e escaneada.
D. Os livros aparecem na biblioteca e busca.
E. EPUB e PDF abrem no reader moderno.
F. Fechar/reabrir salva/restaura progresso real.
G. Continue Reading reflete o progresso persistido.
H. /legacy pode ser habilitado no admin e o fluxo login -> library -> EPUB -> progresso funciona usando a mesma API.
I. /legacy desabilitado é tratado de forma controlada.
J. typecheck, lint, testes e build de produção passam.
K. Container/deployment smoke test passa.
L. README contém instruções exatas de execução, bootstrap do admin, mount de books e comandos de verificação.
M. Não existem mocks/fake responses/pendências marcadas no código bloqueando nenhum item A-L.

Quando terminar, faça uma revisão final do diff e da documentação. Corrija o que encontrar. Só então apresente um resumo curto contendo: arquitetura implementada, comandos para subir/testar, credenciais/bootstrap esperado, funcionalidades entregues, limitações reais conhecidas e qualquer ADR criado.
```

---

## Prompt 2 — Beta integrada e utilizável diariamente

```text
Você está na raiz de um repositório Litera cujo MVP anterior DEVE estar funcional. Sua tarefa é evoluí-lo para uma BETA integrada e utilizável diariamente. Não reinicie o projeto nem troque stack/arquitetura sem evidência forte. Primeiro leia AGENTS.md, README.md, CODEX_PROMPTS.md, toda a foundation relevante, ADRs e o código/testes existentes. Rode a suíte e suba a aplicação antes de mudanças para conhecer o baseline.

REGRA CENTRAL:
Continue trabalhando verticalmente. Cada melhoria que cruza UI/API/banco/reader/admin deve ser entregue end-to-end. Não aceite regressões do MVP para “arrumar depois”. A aplicação deve permanecer executável durante a evolução.

OBJETIVO DA BETA:
Transformar o MVP em um servidor de biblioteca confiável para uso real por múltiplos usuários: scans/reconciliação robustos, metadata utilizável, reader confortável, progresso concorrente consistente, administração operacional, /legacy estável, segurança/observabilidade/testes suficientes para detectar regressões.

Implemente e estabilize, no mínimo:

1. Auditoria do MVP
- Rode install/typecheck/lint/unit/integration/E2E/build/container smoke.
- Corrija falhas e dívida que viole a foundation antes de adicionar complexidade.
- Remova mocks, fixtures acopladas à produção e pendências marcadas no código que afetem fluxos do produto.
- Faça migrations aditivas/seguras para dados já existentes.

2. Scanner/reconciliação Beta
- Suporte múltiplas libraries.
- Defina e implemente uma estratégia explícita e testada de identidade de arquivo/reconciliação de rename/move dentro das libraries usando características seguras e eficientes; documente em ADR se a escolha tiver tradeoffs relevantes.
- Jobs de scan com status queued/running/completed/failed/cancelled quando apropriado.
- Retry controlado e recuperação após restart.
- Relatório de arquivos adicionados/alterados/removidos/falhos.
- Scans concorrentes da mesma library não podem corromper catálogo.
- Limites de recurso e tratamento de arquivos grandes/corrompidos.

3. Metadata Beta
- Provider adapters reais configuráveis conforme documentação/licença atual.
- Matching com evidência local, confidence/provenance e política clara para não sobrescrever metadata melhor.
- Cache, timeout, retries limitados e rate-limit handling.
- Admin /admin/metadata para habilitar/desabilitar/configurar providers sem expor segredos.
- Admin consegue revisar estado/erro de enrichment por livro quando útil.
- Capas armazenadas/servidas de forma segura e eficiente, com fallback consistente.

4. Usuários/autorização
- /admin/users funcional para criar/desativar/gerenciar usuários e roles necessárias ao escopo.
- Políticas server-side centralizadas e testadas.
- Sessões expiradas/revogadas tratadas corretamente.
- Troca de senha e fluxo mínimo de segurança de conta apropriado ao self-hosted.
- Dados/progresso continuam estritamente separados por usuário.

5. Catálogo/UI Beta
- Completar as rotas previstas na UI spec que pertencem ao escopo 1.0: Authors, Series, Genres, Favorites se suportado pelo modelo, Settings.
- Ordenação/filtros úteis de library sem transformar a UI em dashboard genérico.
- Paginação ou estratégia equivalente para bibliotecas grandes.
- Skeleton/empty/error/toast/dialog padrões compartilhados.
- Layout responsivo refinado sem componentes duplicados por breakpoint.
- Acessibilidade: teclado, foco, labels, landmarks, contraste e reduced motion.

6. Reader Beta
- Melhorar EPUB: TOC, typography, tamanho de fonte, line height/margens quando suportado, temas acessíveis, in-book search quando a engine suporta de modo seguro, navegação touch/keyboard e fullscreen/focus mode.
- Melhorar PDF: page navigation, zoom e search quando tecnicamente suportados.
- ReaderCapabilities compartilhado para evitar toolbars duplicadas por formato.
- Persistir ReaderPreference por usuário de forma coerente.
- Definir e implementar política de conflito de progress entre abas/dispositivos: revision/version, stale update handling e resolução previsível. Documente a política e teste concorrência.
- Tratar locator inválido após arquivo/edição mudar com fallback seguro e explicável.
- Critério consistente de completed/reopen.
- Testar livros grandes sem carregar conteúdo inteiro desnecessariamente.

7. Continue Reading e domínio de progresso
- Continue Reading ordenado e consistente.
- Conclusão, retomada e remoção de item da seção funcionam com regras claras.
- ProgressRatio é display/derivado, nunca substitui locator semântico.
- Testes multi-user, multi-tab e concorrência.

8. Admin Beta
- Dashboard com estado real, não métricas decorativas.
- Libraries/jobs/users/metadata/system/compatibility operacionais.
- /admin/jobs com histórico/status/erros acionáveis.
- /admin/system mostra versão, build, banco/migrations, storage e saúde sem revelar secrets.
- Configuração legacy.enabled persiste e aplica-se sem restart se a arquitetura permitir de forma segura; se restart for necessário, deixe explícito.

9. /legacy Beta
- Preserve o mesmo backend/API e semântica de progresso.
- Refine performance e tamanho de payload/assets.
- Valide recursos contra a matriz realista de iOS 10.x/old WebKit e registre incompatibilidades.
- Evite CSS/JS não suportado no core flow.
- Implementar Reader EPUB confortável e estável.
- Avalie PDF no dispositivo/baseline. Se viável, entregue; se não, mantenha indisponibilidade explícita e documentada.
- Não implemente painel admin legacy.

10. Segurança/privacidade/operabilidade
- Refaça threat-model review sobre o código real.
- Testes para traversal, authorization bypass e XSS sanitization relevantes.
- Proteções de auth (rate limiting, cookies/CSRF ou equivalente conforme arquitetura).
- CSP/isolamento de conteúdo EPUB conforme a implementação real.
- Logs estruturados com correlation/request id suficiente para diagnóstico, sem secrets/passwords/book content.
- Comportamento de shutdown/restart seguro para jobs e banco.
- Documente dados pessoais locais, retenção básica e como excluir/desativar usuário de forma coerente ao self-hosted.

11. Testes/CI Beta
- Amplie unit/integration/E2E para os critérios acima.
- Teste migrations de uma instalação MVP para Beta.
- Teste scan repetido e rename/removal.
- Teste provider failure/offline.
- Teste progress conflict.
- Teste authorization multi-user.
- Teste responsivo automatizável e smoke legacy.
- CI deve falhar em typecheck/lint/test/build/container failures.

NÃO CONSIDERE BETA CONCLUÍDA até este GATE DE SAÍDA passar:
A. Instalação MVP existente migra para Beta sem perda de catálogo/progresso.
B. Instalação limpa continua funcional via Docker Compose.
C. Dois usuários conseguem ler o mesmo livro com progresso independente.
D. Multi-library + re-scan + rename/removal não geram duplicação/corrupção evidente.
E. Provider indisponível não impede catálogo/leitura local.
F. EPUB/PDF modernos são confortáveis e restauram posição; conflitos/stale updates têm comportamento testado.
G. Admin consegue operar libraries, jobs, users, metadata, system e compatibility.
H. /legacy continua completando login -> catálogo/busca -> EPUB -> progresso e respeita legacy.enabled.
I. UI usa o component system compartilhado e não introduziu sopa de componentes/tokens arbitrários.
J. Testes de segurança críticos passam.
K. typecheck, lint, suíte completa, production build e container smoke passam.
L. Não há bug conhecido P0/P1 no core flow; P2 relevantes estão documentados com reprodução.
M. README/changelog/docs explicam upgrade MVP -> Beta, backup, config e limitações.

Ao finalizar, faça uma rodada de dogfooding automatizável/manual via navegador local, corrija regressões encontradas e só então entregue o resumo: mudanças principais, migrations, comandos, compatibilidade, riscos/bugs conhecidos e evidência dos gates executados.
```

---

## Prompt 3 — 1.0 Release Candidate estável e completa

```text
Você está na raiz do Litera após uma Beta funcional. Sua tarefa é produzir uma versão 1.0 RELEASE CANDIDATE estável, completa dentro do escopo definido e pronta para virar 1.0 sem reescrita arquitetural.

Antes de modificar código: leia AGENTS.md, README.md, CODEX_PROMPTS.md, requirements, UI spec, arquitetura, threat model, testing, DoR/DoD, roadmap, todos os ADRs e documentação de upgrade/deploy. Rode o pipeline atual completo e suba uma cópia com dados Beta/migration test antes de começar.

REGRA CENTRAL:
Não faça um “hardening só de backend” ou “polimento só de frontend”. Feche release blockers por fluxo vertical. Preserve compatibilidade de dados e API. Mudanças breaking só são aceitáveis se indispensáveis, acompanhadas de migration/documentação e sem deixar instalação Beta órfã.

OBJETIVO RC:
Entregar uma versão reproduzível, segura e bem documentada do Litera 1.0: core reading completo, administração consistente, scanner/metadata robustos, modern UI refinada, /legacy previsível, migrations confiáveis, observabilidade, acessibilidade, performance e testes de regressão suficientes para recomendar uso real self-hosted.

Execute uma revisão sistemática e complete:

1. Fechamento de escopo/requisitos
- Faça uma matriz FR/NFR -> implementação -> testes.
- Para FR-001..FR-012 e NFR-001..NFR-006, identifique gaps reais e implemente os que pertencem ao 1.0.
- Não adicione features fora de escopo só por serem interessantes.
- Resolva marcadores de pendência/FIXME/HACK em caminho crítico; documente apenas dívida não bloqueante.

2. Estabilidade de dados/migrations
- Migrations testadas: instalação limpa, MVP->Beta->RC quando snapshots/fixtures de schema existirem, e Beta->RC.
- Backup/restore documentado e smoke-tested para os dados persistentes relevantes.
- Constraints/indexes corretos para integridade e performance.
- Falha de migration deve ser explícita e não continuar silenciosamente com schema inconsistente.
- Defina política segura para scan/reconcile após atualização.

3. API/domain stability
- Normalize contratos e error semantics usados por modern e legacy.
- Documente endpoints/contratos públicos necessários para futuros clientes sem acoplar ao browser.
- Evite breaking changes desnecessárias.
- Validação, authorization e ownership cobrem todos os recursos protegidos.
- Progress concurrency/versioning está estável e documentado.

4. Scanner/catalog production hardening
- Bibliotecas grandes: paginação/queries/índices e scan incremental adequados.
- Renames/moves/removals/corrupt files/restart/concurrent scans cobertos.
- Nenhum fluxo modifica book source sem requisito explícito.
- Erros são acionáveis no admin e logs.
- Testes de performance razoáveis com dataset sintético representativo; corrija gargalos óbvios.

5. Metadata production hardening
- Providers implementados seguem documentação/licenciamento atual e possuem timeout/retry/rate-limit/cache/provenance.
- Provider secrets/config não vazam para frontend/log.
- Matching reduz falso positivo; ações de atualização respeitam evidência local.
- O produto continua totalmente utilizável sem internet/providers.

6. Reader 1.0
- EPUB e PDF modernos completos no escopo: abrir, navegar, restaurar, buscar quando suportado, preferências pertinentes, touch/keyboard, estados de erro e livros grandes.
- ReaderShell/ReaderCapabilities/adapters permanecem compartilhados e coesos.
- Conteúdo EPUB/PDF malicioso é contido conforme threat model.
- Mudança de arquivo/edição e locator inválido têm recuperação robusta.
- Progress não retrocede silenciosamente por stale update.
- Continue Reading e completed semantics consistentes.
- Memory/performance profile aceitável para livros representativos; não manter DOM/render desnecessário.

7. Modern UI 1.0
- Revise todas as rotas da IA/UI spec.
- Component audit: elimine duplicatas semânticas, valores visuais arbitrários e variants desnecessários.
- Todos estados relevantes: loading/loaded/empty/filtered-empty/error/disabled/read-only.
- Desktop/tablet/mobile sem overflow/posição quebrada nos viewports principais.
- Acessibilidade: teclado completo nos fluxos principais, focus management em dialog/drawer, labels, semantics, contraste, reduced motion e touch targets.
- Admin permanece visualmente parte do mesmo design system.

8. /legacy 1.0
- Mantenha-o separado do app moderno e usando a mesma API.
- Finalize matriz de compatibilidade com o aparelho físico iOS 10.x/old WebKit assim que disponível, registrando modelo/iOS exatos; se o hardware não estiver disponível no ambiente, preserve um checklist manual objetivo para execução pelo mantenedor.
- Core obrigatório: login, home/library, search, detail, EPUB reader, progress, logout.
- Otimize payload, imagens, DOM e CSS para hardware antigo.
- PDF só pode ser declarado suportado se realmente validado na baseline; caso contrário marque claramente como unavailable/best-effort.
- legacy.enabled e comportamento disabled testados.
- Modern UI nunca deve ser forçada ao legacy baseline.

9. Segurança 1.0
- Faça revisão threat-model -> código com checklist.
- Dependências: audite vulnerabilidades conhecidas e atualize/substitua onde houver risco relevante sem quebrar compatibilidade.
- Auth/session/cookies/CSRF/rate limiting conforme arquitetura.
- Path traversal/filesystem boundary testado.
- XSS/HTML EPUB/metadata/provider content containment testado.
- SSRF/provider outbound boundaries testados.
- Headers de segurança e CSP adequados.
- Secrets management/documentação segura.
- Logs sem dados sensíveis desnecessários.

10. Operação/release
- Docker images reproduzíveis e enxutas; usuário não-root onde viável.
- docker-compose de produção documentado com volumes, permissions, ports, healthcheck e upgrade.
- Graceful shutdown.
- Health/readiness behavior útil.
- Version/build information visível no admin e logs.
- Config validation na inicialização com mensagens úteis.
- Guia de instalação, upgrade, backup/restore, troubleshooting e legacy.
- LICENSE/third-party notices quando necessários pelas dependências escolhidas.
- CHANGELOG e release notes RC.

11. Testes/release pipeline
- Unit/integration/E2E cobrindo a matriz de requisitos.
- Browser E2E para fluxo principal moderno.
- Legacy smoke automatizado no que for tecnicamente representativo + checklist de aparelho físico.
- Migration tests.
- Security regression tests relevantes.
- Container clean-install e upgrade smoke.
- CI determinística: clean install, typecheck, lint, tests, build, container checks.
- Remova flaky tests ou corrija a causa; não esconda com retries indiscriminados.

12. Release audit final
- Procure marcadores de pendência/FIXME/HACK, console debug, secrets, fixtures acidentais, rotas sem auth, componentes duplicados, CSS arbitrário, endpoints mortos e dependências não usadas.
- Verifique logs e mensagens de erro.
- Faça uma instalação limpa final e uma atualização de Beta final.
- Execute o fluxo manual/E2E completo de admin e usuário.

NÃO CONSIDERE O RC CONCLUÍDO até este GATE DE SAÍDA:
A. Todos os FR/NFR do escopo 1.0 têm implementação e evidência de teste/documentação, ou uma exceção explícita e justificada que não contradiga o escopo.
B. Clean install via Docker Compose funciona a partir de instruções do README.
C. Upgrade de uma instalação Beta suportada funciona preservando usuários, catálogo, libraries e progresso.
D. Admin consegue configurar/operar o sistema 1.0 inteiro sem editar banco manualmente.
E. Usuário moderno completa login -> browse/search -> detail -> EPUB/PDF -> progress -> resume -> settings sem erro conhecido crítico.
F. Dois usuários e dois clientes não misturam progresso/autorização.
G. Scanner é idempotente e robusto a add/change/rename/remove/corrupt/restart nos testes definidos.
H. Falha de provider/internet não impede leitura local.
I. /legacy completa seu core flow quando habilitado e falha controladamente quando desabilitado.
J. Segurança crítica do threat model possui controles implementados e regressions tests onde aplicável.
K. Acessibilidade e responsividade dos fluxos principais foram revisadas e blockers resolvidos.
L. typecheck, lint, unit, integration, E2E, migrations, production build e container clean-install/upgrade smoke passam.
M. Nenhum P0/P1 conhecido permanece. P2 somente se claramente documentado e não bloquear release.
N. README, install, upgrade, backup/restore, troubleshooting, compatibility matrix, API notes e CHANGELOG estão atualizados.
O. O produto não depende de mocks/pendências marcadas no código/fake data em nenhum core flow.

Depois dos gates, faça uma última revisão como release engineer, security reviewer e usuário final. Corrija regressões encontradas. Gere um resumo final curto com: versão RC, comandos exatos de install/upgrade/test, migrations executadas, matriz de compatibilidade, checks de segurança, limitações conhecidas e lista objetiva do que impediria promover este RC para 1.0 final (idealmente nenhuma).
```

# ADR-0009 — Pacotes offline, fontes locais e fila de sincronização

Status: Accepted. Substitui as decisões de implementação de ADR-0006; mantém seus limites de segurança e o cliente `/legacy` online.

## Contexto

O cache de respostas da 0.4 não garante cold start, tipografia EPUB, PDF adaptado nem sincronização fora do reader. Um usuário global no Service Worker também não representa corretamente várias abas. A experiência offline deve funcionar em Chromium e WebKit, sem Background Sync obrigatório.

## Decisão

- O Service Worker armazena somente o shell público. O build produz uma lista determinística de HTML, chunks, CSS, ícones e recursos auxiliares da versão do PDF.js usada pelo reader. Um hash identifica o cache. API, Range, administração e `/legacy` não são interceptados.
- Downloads são explícitos. IndexedDB guarda `Blob`s e metadados por conta/livro/geração. Recursos entram numa geração de preparação; apenas uma transação confirmada publica o ponteiro do pacote completo. Falha, cancelamento ou atualização interrompida não substituem a cópia anterior. Estado pessoal tem ciclo de vida separado.
- O EPUB continua no reader incremental de capítulos sanitizados. O pacote contém capítulos canônicos, manifesto e recursos internos autorizados; aparência é aplicada localmente. Não introduzimos um segundo reader nem carregamos EPUB bruto no iframe. CSS editorial e fontes passam por sanitização, mantendo o controle de tema e paginação do Litera.
- O PDF original é um arquivo completo e entra no PDF.js via `data`, sem servidor de Range no Service Worker. Livros sem download mantêm o transporte online existente. O modo adaptado preserva o pipeline de ADR-0008: baixamos todas as páginas preparadas, figuras e fontes junto com o original. Reimplementar essa extração no navegador perderia fidelidade de glifos e figuras; não é necessário para ler sem rede.
- `BookSource` escolhe a geração local quando há download completo, inclusive online. Object URLs existem somente na sessão de leitura e são revogadas ao liberar a página/capítulo. URLs temporárias não são persistidas.
- Estado de leitura e operações pendentes são gravados localmente antes do envio. A fila é persistente, isolada por conta, com envio em startup, foreground, reconexão e ação manual. Retry usa backoff; não depende de API exclusiva de Chromium. Destaques usam chave idempotente no servidor. Progresso usa revisão, incluindo a ausência inicial; percentual maior não é resolução de conflito.
- A biblioteca offline é derivada de downloads completos, não de respostas antigas de busca. Busca, favoritos e Continuar leitura consultam esses livros e seu estado local. Não há promessa de administração offline.
- A última identidade autenticada pode abrir o contexto local sem rede. Senhas, tokens e cookies não são persistidos pela camada offline. Logout oculta imediatamente a conta, cancela downloads e apaga seus dados locais; a intenção persistente inclui apenas o `userId`, permitindo repetir limpeza e revogação até ambas concluírem sem reabrir o cookie HttpOnly.
- Mudanças de identidade entre abas invalidam o contexto antigo; requests usam identificação adicional de conta verificada contra a sessão no servidor. Essa identificação não é credencial nem concede autorização.
- Expiração/rejeição da sessão oculta o contexto e exige nova autenticação, mas não equivale a logout explícito: a fila permanece isolada por usuário para não perder alterações ainda não enviadas. Ela só volta a ser acessível após autenticar a mesma conta.
- Recibos idempotentes são mantidos numa janela ampla das operações mais recentes por usuário e compactados acima de 2.500 entradas. O cliente envia em série e só remove a operação local após receber o recibo; assim, qualquer retry possível permanece na janela sem crescimento ilimitado do banco.
- Quota e persistência são capacidades opcionais. Mostramos bytes realmente conhecidos e estimativas identificadas como aproximadas. Erros de storage não podem ser apresentados como download completo nem tornar a leitura online dependente de IndexedDB.
- Atualizações do aplicativo são oferecidas para aplicação voluntária; não há reload forçado no meio da leitura. Limpeza do shell é independente dos pacotes e da fila.

## Alternativas e consequências

Cache cego de toda a API foi rejeitado: confunde dados públicos/privados, queries e versões. Simular Range no worker foi rejeitado: exige materializar/cortar arquivos completos em cada request e complica isolamento. Base64/localStorage para livros aumentaria memória e tamanho sem benefício. Recriar EPUB/PDF engines não é necessário.

O pacote PDF ocupa o tamanho do original mais os derivados de leitura. Downloads grandes podem exigir espaço temporário adicional durante uma atualização. O browser controla a retenção; um pedido de persistência não equivale a garantia. [Política oficial de armazenamento do WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/).

Conteúdo local não é DRM nem criptografia por usuário: alguém que controla o perfil do navegador pode inspecioná-lo. Revogação remota não alcança um dispositivo desconectado. Apagar dados do site pelo browser remove downloads e operações ainda não sincronizadas.

Pacotes incompletos antigos não são promovidos automaticamente a downloads completos 0.5. Seus recursos são preservados para compatibilidade até a atualização explícita; baixar novamente prepara o contrato completo. Migrations futuras são aditivas e nunca apagam o banco por mudança da versão do aplicativo.

## Verificação

Os gates incluem navegação profunda e cold start offline, imagens/fontes EPUB, PDF original/adaptado, restauração de locators, fila sobrevivendo a reload, sincronização fora do reader, idempotência, isolamento, quota/cancelamento e regressão online. Playwright WebKit não substitui validação física de Safari/PWA. Checklist em `docs/development/offline-validation.md`.

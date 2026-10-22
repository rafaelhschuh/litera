# Arquitetura Android

Decisão autoritativa: [ADR-0010](../../docs/decisions/ADR-0010-native-android-client.md). Entrada: [README](../README.md) e [AGENTS](../AGENTS.md).

```text
Telas e navegação Kotlin / Android Views
  -> LiteraRepository (HTTP, sessão, modelos e erros)
       -> API Litera existente -> autorização/persistência no servidor
  -> NativeReaderActivity / adapters
       -> EPUB: Readium (publicação local)
       -> PDF: Android PdfRenderer (arquivo local)
       -> locator/revisão -> mesma API de progresso
```

## Responsabilidades

| Android | Servidor / contratos compartilhados |
|---|---|
| Login, biblioteca, busca, detalhe e configurações nativas | Autenticação, sessão e autorização em cada endpoint |
| Adapters de publicação, controles e ciclo de vida | Arquivos/revisões, metadados e acesso aos livros |
| Barras, insets, teclado, Voltar e acessibilidade | Semântica dos locators EPUB/PDF e conflitos concorrentes |
| Sessão cifrada, arquivos privados e cache local | Persistência autoritativa de progresso por usuário |

Não hospedar o site Litera nem depender de rotas SPA, IndexedDB, Service Worker, bridge de aparência ou perfis WebView para a aplicação. O toolkit Readium renderiza conteúdo EPUB internamente; esse limite de engine é distinto de carregar a UI do servidor. Não construir engine EPUB própria nem converter PDFs para HTML no Android.

## Rede e sessão

O repositório de dados centraliza chamadas HTTP via OkHttp. A origem é normalizada por esquema, host e porta; HTTPS é padrão, HTTP depende de consentimento. A sessão existente da API continua sendo validada no backend. Cookie persistente é cifrado por Android Keystore, sem senha em preferências. Cada origem tem identidade local distinta, inclusive portas diferentes no mesmo host. Redirecionamentos não recebem credenciais de outra origem. O leitor recebe somente o arquivo autorizado e estado necessário, nunca a sessão HTTP.

Login expirado, acesso negado, transporte indisponível e arquivo alterado são estados diferentes; mostrar ação adequada em vez de tela vazia. Configuração do servidor e preferências de apresentação não se tornam novo modelo de domínio.

## Leitura e progresso

EPUB usa Readium e PDF usa PdfRenderer atrás de adapters. A UI oferece somente capacidades implementadas por cada engine. O PdfRenderer não equivale ao modo PDF Adaptado web; busca, destaques e recursos web avançados exigem implementação/validação própria antes de promessa de paridade.

Persistir locators no contrato comum: EPUB preserva capítulo/href, localização textual quando disponível e progressão dentro do capítulo; PDF preserva página. A extensão opcional de progressão de capítulo deve ser aditiva no contrato da API e restaurada também pelos outros clientes que a suportam. Não confundir totalProgression com chapterProgression nem CFI EPUB.js com locator Readium. Capítulos/revisões incompatíveis precisam de fallback explícito, sem inventar precisão. A revisão do último arquivo aberto é registrada por conta/livro: uma alteração conhecida oferece reiniciar ou tentar restauração aproximada, antes de aplicar pendências. O contrato remoto atual não vincula o locator à revisão de arquivo; uma edição alterada em outro cliente antes da primeira abertura Android pode não ser detectada por esse marcador local.

Transações de fragmentos e apresentação de diálogos aguardam a Activity voltar ao estado RESUMED, inclusive se a abertura terminou em background. Download cancelado verifica cancelamento antes de promover o arquivo; uma pausa não equivale a cancelar.

Salvar em pausa e saída pelo adapter, evitando escritas concorrentes regressivas. O diário faz uma pequena gravação síncrona durável antes do encerramento da Activity; o envio HTTP é separado, serial e não bloqueia esse registro. Uma operação sem confirmação mantém sua chave, e só sua sucessora ainda não enviada é coalescida. Uma tentativa em memória na pausa não é um serviço/worker de background nem garante entrega com processo encerrado. Enviar revisão esperada e tratar conflito com escolha explícita; maior percentual nunca decide a posição vencedora. Barras e controles acompanham o tema da leitura (incluindo PDF invertido), sem recriar a publicação; diálogos recebem contexto claro/escuro coerente. Barras/insets acompanham tema nativo, controles respeitam teclado/cutout, e manter tela acesa só atua durante leitura em foreground.

## Arquivos locais e limites offline

Downloads usam armazenamento privado, escrita temporária e promoção atômica depois de completos. Identidade inclui origem, conta, livro e revisão; arquivo parcial nunca é livro disponível. Uma cópia já obtida pode ser reutilizada pelo leitor sem novo download quando válida.

Esse cache não implementa automaticamente catálogo offline, outbox completo de favoritos/destaques ou background sync. O repositório mantém rascunhos duráveis de progresso por conta/livro antes do envio, com revisão esperada e chave de idempotência; reenvio ocorre em foreground ao retomar a Home/leitura, sem serviço em background. Conflitos preservam o rascunho até escolha explícita. Logout remove a sessão e o acesso, mas preserva rascunhos isolados para recuperação somente após autenticar a mesma conta. [ADR-0009](../../docs/decisions/ADR-0009-offline-packages-and-outbox.md) continua sendo contrato do cliente web. O Android deve anunciar somente capacidades implementadas e testadas. Se rede falhar, não confirmar salvamento remoto; se houver pendência local, preservar revisão e resolver conflito antes de reenvio. Process death, logout e troca de conta/origem exigem testes específicos de isolamento e retenção.

PWA/Chrome e APK não compartilham sessão ou arquivos. Limpeza/desinstalação pode apagar estado local; backup Android é desabilitado. Não existe promessa de DRM, retenção garantida ou observação instantânea de revogação enquanto offline.

Consulte [segurança](security.md), [validação](testing.md) e [build](build-and-release.md) antes de ampliar capacidades.

## Mapa de manutenção

- [MainActivity](../app/src/main/java/io/github/rafaelhschuh/litera/MainActivity.kt), [MainViewModel](../app/src/main/java/io/github/rafaelhschuh/litera/ui/MainViewModel.kt) e [NativeBookAdapter](../app/src/main/java/io/github/rafaelhschuh/litera/ui/NativeBookAdapter.kt): telas, estado e uma única apresentação de livro usada por catálogo/busca/favoritos/início.
- [LiteraRepository](../app/src/main/java/io/github/rafaelhschuh/litera/data/LiteraRepository.kt), NativeTransport e EncryptedCookieJar: API, limites, autorização esperada, sessão e arquivos. Capas têm cache de memória por sessão e concorrência limitada; não são catálogo offline.
- [ProgressJournal](../app/src/main/java/io/github/rafaelhschuh/litera/data/ProgressJournal.kt): transições duráveis, confirmação de operação em voo, sucessora e escolha de conflito. Não segurar o monitor de disco durante HTTP.
- [NativeReaderActivity](../app/src/main/java/io/github/rafaelhschuh/litera/reader/NativeReaderActivity.kt) e ReaderEngine: controles, insets, pausa, preferência de tela acesa e adapters Readium/PdfRenderer. Rotação não recria a engine; recriação por processo/tema reabre a publicação usando o diário/API, sem restaurar fragmentos antes da factory Readium existir.
- [SafeEpub](../app/src/main/java/io/github/rafaelhschuh/litera/reader/SafeEpub.kt): cópia privada de segurança, sem alterar original nem substituir parsing/layout do Readium. Mudança de versão Readium exige rever esta fronteira e executar instrumentação.
- [Contrato compartilhado](../../src/shared/progress.ts): `chapterProgression` opcional preserva avanço no capítulo sem simular equivalência entre CFI web e locator Readium. A web mantém seu locator de elemento mais preciso quando disponível; restauração entre engines é aproximada.

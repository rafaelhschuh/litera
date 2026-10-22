# ADR-0010 — Cliente Android nativo sobre a API Litera

Status: Accepted. Implementação e evidência acompanham o [subprojeto Android](../../android/README.md); esta decisão não declara gates físicos, paridade web ou RC concluídos.

## Contexto

O Litera possui API, autorização, catálogo e progresso por locator, além de PWA e cliente legacy. O aplicativo Android deve oferecer navegação, telas e leitura confortáveis no celular, aproveitando esses contratos sem novo backend. O usuário rejeitou hospedar o site em um wrapper: o reaproveitamento sustentável é do domínio/API e de engines maduras, não de uma WebView da interface existente. A origem self-hosted é definida pelo usuário.

## Decisão

Criar android/ como cliente Kotlin com AndroidX Views, telas nativas de configuração, login, biblioteca, busca, detalhe e preferências, e Activity de leitura com adapters. O repositório central usa OkHttp para a mesma API. O servidor mantém autenticação, autorização, arquivos/revisões e persistência autoritativa de progresso. Não há backend duplicado nem protocolo de progresso independente.

EPUB utiliza Readium; PDF utiliza Android PdfRenderer. O HTML renderizado internamente pelo toolkit EPUB pertence à publicação local, sem carregar o site Litera. Não desenvolver engine EPUB artesanal, parser/layout próprio ou replicar o modo PDF Adaptado web sem requisito/implementação explícitos. A UI expõe capacidades reais de cada engine.

O contrato de locator é compartilhado e extensível de forma aditiva. EPUB precisa preservar capítulo/href e progressão dentro do capítulo quando disponível, sem confundir progressão total ou CFI de outro engine. PDF preserva página. Gravação usa revisão esperada e conflitos pedem escolha explícita; maior percentual não é política de resolução. Alterações no contrato exigem integração e regressões web/legacy pertinentes.

## Segurança, armazenamento e ciclo de vida

Aceitar origem HTTP(S) normalizada, sem credenciais, caminhos, query/fragmento; HTTPS é padrão e HTTP exige consentimento. Cleartext no manifest é concessão global para servidor configurável, compensada pela fronteira no repositório; não garante bloqueio por domínio no SO nem protege tráfego. TLS inválido é recusado. Sessão não atravessa redirect de origem e senha não é persistida.

Persistência de sessão é cifrada com Android Keystore e privada por origem. Arquivos locais são isolados por origem, conta, livro e revisão, baixados de forma atômica; reader recebe conteúdo autorizado, nunca cookie de API. Backup desabilitado, permissões mínimas e links externos somente com gesto e validação. Publicações são entradas não confiáveis; nenhuma bridge privilegiada dá acesso a intents, sessão ou filesystem amplo.

Barras e contraste seguem tokens Litera com insets/cutout/IME explícitos; ícone adaptativo respeita margens seguras e camada monocromática. Posição é capturada pelo adapter em pausa/saída, sem eventos do site. Manter tela acesa é preferência de leitura ativa em foreground.

Chrome/PWA e APK têm sessão/storage independentes. Cache nativo de arquivo permite reutilizar cópia local válida; não implica catálogo offline, fila geral de mutações ou sincronização com aplicativo fechado. Progresso tem diário nativo durável restrito, com revisão/idempotência; favoritos e destaques não herdam a outbox web. ADR-0009 continua específico do cliente web. Capacidades Android devem ser implementadas e testadas antes de anunciadas; process death, expiração, logout e troca de origem/conta têm gates próprios. Não prometer paridade automática de favoritos/destaques ou PDF Adaptado.

## Build e distribuição

Baseline: min SDK 28, compile/target SDK 36, JDK 17, AGP 9.0.1 e Gradle 9.1.0. Versão deriva de package.json raiz; versionCode = major * 1_000_000 + minor * 1_000 + patch. Preview usa application ID io.github.rafaelhschuh.litera.debug.

Workflow adicional read-only gera APK debug, SHA-256 e relatórios, com unitários/lint/build e instrumentação em emulador separada. Assinatura debug efêmera não garante atualização entre artifacts. Release estável exige keystore externo e política explícita; não há anexo automático à GitHub Release nem mudança no pipeline Docker.

## Alternativas

- **WebView hospedando o site:** reaproveitaria toda a UI/PWA, mas foi rejeitada pelo usuário por não entregar a experiência nativa desejada. Perfis WebView, bridge de aparência e storage de browser não integram a arquitetura escolhida.
- **Trusted Web Activity:** mantém a experiência web e exige associação de domínio/certificado, inadequada como padrão para instalações self-hosted dinâmicas e para o objetivo nativo.
- **Somente PWA:** permanece suportado como cliente próprio; não atende ao pedido de aplicativo nativo.
- **Engines EPUB/PDF próprias:** aumentariam custo, risco de fidelidade e retrabalho; rejeitadas em favor de Readium/PdfRenderer atrás de adapters.
- **Duplicar backend ou sincronização incompatível:** rejeitado; reuso é feito nos contratos de API/domínio.

## Consequências e gates

Haverá UI específica Android e manutenção de adapters; essa duplicação de apresentação é intencional, sem duplicar autorização e semântica de domínio. Dependências de publicação ficam encapsuladas e devem ser atualizadas com testes de arquivos reais. Mudanças na API precisam preservar clientes existentes.

Unitários e instrumentação cobrem origem, sessão, cache e locator. Servidor real e aparelho físico precisam comprovar login, biblioteca, EPUB/PDF, restauração/conflitos, isolamento, ícone e barras. Build sozinho não comprova esses fluxos. [Arquitetura](../../android/docs/architecture.md), [segurança](../../android/docs/security.md), [testes](../../android/docs/testing.md), [build](../../android/docs/build-and-release.md) e AGENTS ligados da raiz mantêm a decisão acessível em chats futuros.

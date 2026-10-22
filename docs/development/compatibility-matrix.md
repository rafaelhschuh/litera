# Compatibility Matrix — Beta

| Cliente | Estado | Evidência / restrição |
|---|---|---|
| Chromium atual | Suportado | Fluxo moderno e E2E automatizado no browser local |
| Firefox/WebKit atuais | Alvo suportado | Vue/Vite, EPUB.js e PDF.js; checklist manual antes de RC |
| `/legacy` old WebKit / iOS 10.x | Core conservador | XHR, ES5 IIFE, CSS sem Grid/Flex no core; login, catálogo, busca, detalhe, EPUB incremental, tamanho do texto e progresso |
| PDF em `/legacy` | Indisponível | Mantido explícito; PDF.js não é declarado compatível sem aparelho físico |
| Android nativo | Alvo Android 9/API 28+ | Kotlin/AndroidX Views, API compartilhada, Readium EPUB e Android PdfRenderer; compile/target SDK 36. Gates e limitações em [Android testing](../../android/docs/testing.md); build não comprova experiência física ou paridade com o reader web |
| Cache de publicações no APK | Escopo nativo, validação física pendente | Arquivos privados por origem/conta/revisão, independentes de Chrome/PWA. Reuso de arquivo não implica catálogo offline, outbox, PDF Adaptado ou sincronização em background |

O aparelho físico exato ainda não está disponível neste ambiente. Antes de 1.0, registrar modelo e versão do iOS e executar: login, busca, abrir EPUB, anterior/próximo, alterar texto, fechar/reabrir, logout e modo desabilitado. Incompatibilidades observadas devem ser registradas com URL, passo e screenshot.

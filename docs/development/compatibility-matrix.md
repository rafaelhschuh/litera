# Compatibility Matrix — Beta

| Cliente | Estado | Evidência / restrição |
|---|---|---|
| Chromium atual | Suportado | Fluxo moderno e E2E automatizado no browser local |
| Firefox/WebKit atuais | Alvo suportado | Vue/Vite, EPUB.js e PDF.js; checklist manual antes de RC |
| `/legacy` old WebKit / iOS 10.x | Core conservador | XHR, ES5 IIFE, CSS sem Grid/Flex no core; login, catálogo, busca, detalhe, EPUB incremental, tamanho do texto e progresso |
| PDF em `/legacy` | Indisponível | Mantido explícito; PDF.js não é declarado compatível sem aparelho físico |

O aparelho físico exato ainda não está disponível neste ambiente. Antes de 1.0, registrar modelo e versão do iOS e executar: login, busca, abrir EPUB, anterior/próximo, alterar texto, fechar/reabrir, logout e modo desabilitado. Incompatibilidades observadas devem ser registradas com URL, passo e screenshot.

## Android APK preview

| Cliente / condição | Estado | Evidência / restrição |
|---|---|---|
| Android 9/API 28+ com provedor WebView capaz de múltiplos perfis | Alvo do preview | Verificação `MULTI_PROFILE` obrigatória em runtime; versão Android sozinha não basta |
| Provedor WebView sem múltiplos perfis | Não carrega servidor | Orientar atualização; sem fallback silencioso para perfil padrão |
| Origem HTTPS válida | Caminho recomendado | Offline depende também das capacidades reais do provedor e downloads explícitos |
| HTTP remoto com aceite | Online com restrições | Sem garantia de secure context, Service Worker ou offline completo |
| APK em aparelho físico | Aceitação pendente | Registrar modelo/Android/provedor e executar [checklist](../../android/docs/testing.md) |

O APK usa o mesmo catálogo/reader web em WebView; armazenamento do perfil é independente do Chrome/PWA. Evidências do preview nativo rejeitado não são reutilizadas. Consulte [ADR-0010](../decisions/ADR-0010-android-webview-host.md).

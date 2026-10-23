# Segurança Android

Herdar o [threat model](../../docs/security/threat-model.md), [privacidade](../../docs/security/privacy-and-operations.md) e [ADR-0010](../../docs/decisions/ADR-0010-android-webview-host.md). Livro, metadado, URL e documento web são entradas não confiáveis.

## Transporte e navegação

Validar origem HTTP(S) por esquema/host/porta efetiva; rejeitar credenciais, path, query, fragmento e schemes arbitrários. HTTPS é padrão. HTTP exige consentimento e expõe sessão e conteúdo; cleartext permitido no manifest para instalações configuráveis não equivale a allowlist do Android. O host deve aplicar seu limite de origem.

TLS inválido é cancelado, sem bypass ou TrustManager permissivo. Bloquear conteúdo misto, cookies de terceiros e acesso direto file/content da WebView. O seletor nativo usa Storage Access Framework e URIs de conteúdo escolhidas pelo usuário, sem permissão de armazenamento amplo. Não aceitar janelas pop-up ou intents arbitrários. Navegação externa requer gesto e URL HTTP(S) validada e sai para o navegador; outras origens não recebem a bridge nem viram documento confiável do host. Erros de subrecursos não devem permitir trocar o documento por tela externa.

## Perfis e dados

Exigir suporte a `MULTI_PROFILE` e escolher perfil persistente por origem antes da navegação com `WebViewCompat.setProfile`. Não usar perfil padrão como fallback. Cookies/DOM storage pertencem ao perfil WebView privado ao app; nenhuma senha é persistida em preferências Kotlin. Não há importação de sessão do Chrome/PWA, cookie jar próprio ou cópia de tokens para bridge/log/intents.

O armazenamento por conta, logout, outbox e revogação seguem a implementação web. Revogação remota só pode ser observada quando houver conexão. O usuário deve sincronizar antes de logout/reinstalação para preservar operações pendentes. Perfis não são DRM. Backup Android fica desabilitado; permissões de câmera, notificações e armazenamento amplo não são necessárias.

## Mensagens de apresentação

Usar `WebViewCompat.addWebMessageListener`, com allowlist da origem canônica, `isMainFrame` e verificação de que o documento de primeiro nível ainda é confiável. Nunca usar `addJavascriptInterface`. Mensagens declarativas têm esquema/tamanho validados e só podem ajustar aparência e estado do reader, ou solicitar abertura do diálogo limitado de ajustes do host. A preferência de tela acesa é controlada no host. Não oferecer filesystem, leitura de cookies, rede privilegiada, intents ou avaliação arbitrária de código.

Frames do EPUB, documentos externos e mensagens malformadas são rejeitados. Requests de recursos externos e de Service Worker também respeitam a restrição de origem; permitir links externos com gesto não autoriza carregá-los dentro do perfil. Sanitização/CSP e limites de renderização do leitor web continuam obrigatórios; a bridge não torna o livro confiável. Eventos host→web de pausa/Voltar não carregam credenciais nem aceitam caminhos/comandos externos.

## Ciclo de vida e distribuição

Manter tela acesa usa a flag da janela somente em leitura ativa foreground com preferência habilitada. Não há serviço de sincronização/monitoramento permanente. Web debugging é restrito a builds debug; release não expõe depuração remota.

Artifacts debug não possuem assinatura estável entre runners. Não versionar keystore/segredos nem apresentar preview como release estável. Atualização incompatível pode exigir reinstalação e apagar estado local. Validar isolamento, navegação, TLS e rejeição da bridge em [testing.md](testing.md).

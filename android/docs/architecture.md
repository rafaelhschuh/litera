# Arquitetura Android

Decisão: [ADR-0010](../../docs/decisions/ADR-0010-android-webview-host.md). Entrada: [README](../README.md) e [AGENTS](../AGENTS.md).

```text
Setup e janela Kotlin
  -> origem canônica + perfil WebView persistente por origem
  -> WebView de primeiro nível
       -> Litera web existente / Service Worker / IndexedDB
       -> API existente / sessão e autorização do servidor
  <- estado declarativo de aparência/leitura
  -> evento de pausa e navegação Voltar
```

## Responsabilidades

| Host Android | Aplicativo web e servidor |
|---|---|
| Configurar origem e verificar capacidades do provedor | Login, catálogo, conta, administração e permissões |
| Barras, contraste, cutout, teclado e ciclo de vida | Componentes, temas e leitores EPUB/PDF existentes |
| Voltar e abertura controlada de links externos | Locators, revisão concorrente, conflito e restauração |
| Escolher perfil WebView por origem | Downloads, IndexedDB e outbox por conta |

O site ocupa a WebView de primeiro nível, sem iframe de aplicação. Iframes internos usados pelo leitor EPUB continuam no limite de conteúdo do reader existente. O host não reimplementa catálogo, autenticação, engines ou regras de domínio.

## Origem, perfil e sessão

A origem é normalizada por esquema, host e porta efetiva, com HTTPS por padrão e HTTP mediante consentimento. `WebViewFeature.MULTI_PROFILE` é pré-requisito verificado em runtime. O host associa o perfil por `WebViewCompat.setProfile` antes da primeira navegação; perfis persistentes distintos impedem que duas instalações na mesma hostname, mas portas/esquemas diferentes, usem o mesmo armazenamento por acidente. Sem suporte, mostrar orientação de atualização; não degradar para o perfil padrão.

Cookies, localStorage, IndexedDB e Service Worker permanecem no armazenamento do provedor, privado ao app e ao perfil selecionado. Não há repositório API nem cookie jar Kotlin concorrentes. Autorização continua no servidor. Trocar origem seleciona outro perfil; logout usa a limpeza por conta do app web. Chrome/PWA não compartilham sessão ou downloads com o APK.

## Integração restrita com o documento

O host observa estado de apresentação, sem acessar livros, sessão ou senha. `WebViewCompat.addWebMessageListener` recebe mensagens com allowlist exata da origem, somente main frame e documento de primeiro nível confiável. Payloads são validados e limitados à aparência/leitura ou abertura do diálogo nativo de ajustes; não há `addJavascriptInterface` ou comandos privilegiados.

A aparência efetiva vem de `theme-color` e tokens CSS do aplicativo/reader. Troca de tema, PDF original/adaptado e saída da leitura atualizam barras e contraste sem recarregar a página. Insets nativos mantêm conteúdo fora da câmera/barras e acomodam o IME; não aplicar a mesma safe area duas vezes. Manter a tela acesa depende simultaneamente de Activity em foreground, reader ativo e preferência habilitada.

Voltar resolve primeiro controles web/diálogos e fullscreen, depois router/histórico, e finalmente sai do host. A Activity não deve executar um retorno de histórico cegamente enquanto há modal aberto. Na página confiável, `history.back()` preserva o fluxo SPA depois de resolver overlays; a API de retorno do browser pode pular entradas criadas sem ativação de usuário, conforme o [Chromium](https://chromium.googlesource.com/chromium/src/+/refs/tags/135.0.7049.0/docs/history_manipulation_intervention.md). O callback Android `doUpdateVisitedHistory` acompanha mudanças de rota, sem sobrescrever `pushState`/`replaceState` nem manter outro router. Janela, decor e conteúdo recebem a mesma cor para cobrir também a área da câmera fora dos bounds do conteúdo. URLs externas só saem com gesto e esquema HTTP(S) validado; não substituem a origem confiável da WebView.

## Progresso, pausa e offline

Os locators EPUB/PDF, revisão esperada, idempotência e conflitos continuam no fluxo web existente. O host emite `litera-host-pause` para capturar posição e acionar persistência/flush existentes. Não criar diário Kotlin: duas filas teriam regras de concorrência e recuperação diferentes. A pausa é melhor esforço; encerramento abrupto pode interromper execução JavaScript/rede. Outbox durável reenvia nas condições já definidas pelo cliente web, sem serviço Android de sincronização.

O [ADR-0009](../../docs/decisions/ADR-0009-offline-packages-and-outbox.md) rege downloads explícitos e shell offline também neste cliente. A capacidade exige origem segura e suporte real do provedor. HTTP remoto normalmente não oferece secure context e não deve ser anunciado como offline completo. Cache HTTP sozinho não comprova disponibilidade de livros.

Falhas de subrecursos não substituem o shell por tela nativa. Uma falha de rede principal deve preservar conteúdo offline utilizável; quando não há documento recuperável, apresentar erro com tentativa novamente/configuração do servidor. Pausa/retomada, teclado e tema não devem disparar reload. Limpeza/desinstalação e política de espaço do WebView podem remover dados; não prometer DRM ou retenção garantida.

Confira [segurança](security.md), [testes](testing.md) e [build](build-and-release.md) ao mudar qualquer fronteira.

## Mapa de manutenção

- `MainActivity`: setup, perfil, WebView, navegação, erros, janela, fullscreen nativo e diálogo limitado de ajustes do host.
- `ServerOrigin`: canonicalização e identidade por origem; `HostState`: validação das mensagens de estado.
- `HostScripts`: observação DOM de `theme-color`, rota e estado de leitura, sem polling nem redesign por CSS. O listener `LiteraAndroid` recebe `{type: "state", color: "#rrggbb", dark: boolean, reader: boolean}` ou `{type: "settings"}` após validar origem/main frame/documento superior.
- `src/web/lib/android-host.ts`: integração opcional e detectável pelo cliente web; Preferências usa o `UiButton` existente para abrir Ajustes Android quando o host está disponível. Browsers comuns não dependem disso.
- Reader web existente: captura/flush ao receber `litera-host-pause`; conserva locators, fila e conflitos existentes.

O seletor de arquivos usa o Storage Access Framework e URIs temporárias de conteúdo escolhidas pelo usuário, sem conceder navegação arbitrária `file:`/`content:` à WebView. Recursos externos, inclusive requests de Service Worker por perfil, seguem a restrição de origem do host. Fullscreen nativo (`CustomView`) é tratado pelo ciclo de vida e Voltar; se a primeira rota for um reader, retornar também deve permitir chegar à biblioteca sem depender de um histórico inexistente.

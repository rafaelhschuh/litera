# Validação Android

Este arquivo separa o contrato a testar da evidência realmente obtida. Resultados do preview nativo rejeitado não validam este host WebView. Build, teste de browser, emulador e aparelho físico são evidências distintas.

## Gates automatizados

Na pasta `android`, com JDK 17 e SDK 36:

```bash
./gradlew testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
./gradlew connectedDebugAndroidTest
```

O segundo comando requer emulador/aparelho e provedor compatível. Registrar commit, versão Android/API, versão do provedor WebView, comando e resultado. A ausência de suporte a múltiplos perfis deve produzir orientação utilizável; não pular a verificação na versão de produção para acomodar um emulador antigo.

Os testes devem cobrir origem/canonicalização, HTTP opt-in, validação de payloads, allowlist/main frame, restrição de navegação e lifecycle. Instrumentação deve abrir documento real dentro da WebView e exercitar persistência/isolamento, Voltar, tema e pausa. Fixtures de transporte são válidas para esses limites, mas não provam o fluxo integrado Litera offline.

Executar também `npm run verify` e E2E web pertinentes quando mudar o contrato de pausa/Voltar/estado: restauração de EPUB/PDF, outbox, conflito, modal e temas. O CI web/container continua obrigatório.

## Checklist integrado no aparelho

1. Instalar APK; registrar modelo, Android, provedor/versão WebView, commit e origem HTTPS de teste. Conferir ícone em máscara circular/arredondada e ícone temático, sem recorte.
2. Verificar setup, URL inválida, HTTP sem aceite, TLS inválido e provedor sem múltiplos perfis. Não pode haver tela branca nem fallback silencioso de isolamento.
3. Entrar no Litera real, navegar catálogo/busca/detalhe/preferências/admin conforme permissão. Comparar funcionalidades com o mesmo servidor no Chrome.
4. Abrir EPUB e PDF original/adaptado; navegar capítulos/páginas, buscar, ajustar texto, tema e destaques. Voltar com modal aberto deve fechá-lo antes de sair da leitura; fullscreen e links externos devem respeitar o mesmo fluxo.
5. Verificar barras/cutout em claro, sépia e escuro, na leitura e ao voltar ao catálogo. Abrir teclado/login/busca, girar aparelho e usar navegação por gestos e três botões; evitar padding duplo e controles encobertos.
6. Avançar, enviar app ao background e retomar, fechar/reabrir e encerrar processo. Conferir locator por formato e recuperação pela persistência web; não aceitar percentual como única evidência. Sincronizações bem-sucedidas devem ser silenciosas.
7. Na mesma conta em outro cliente, criar conflito de progresso. Preservar escolha explícita entre posições e ausência de regressão silenciosa.
8. Em HTTPS, salvar EPUB/PDF para offline, aguardar confirmação, desligar rede e abrir catálogo, detalhe e reader. Testar cold start/reload em rota profunda; reconectar e verificar outbox. HTTP remoto deve informar seus limites de secure context.
9. Trocar entre origens (inclusive portas distintas no mesmo host), retornar e confirmar perfis/sessões/dados separados. Verificar que Chrome/PWA não herdam sessão/downloads. Trocar conta e logout online/offline sem expor dados da conta anterior.
10. Testar desconexão com shell já aberto, falha de subrecurso e cold start sem cache. Conteúdo offline não deve ser substituído por erro nativo; primeira carga sem documento oferece retry/configuração.
11. Tentar navegação externa, schemes não HTTP(S), mensagens de subframe/outra origem e payload malformado. Não podem obter bridge privilegiada ou substituir a origem confiável.
12. Ativar/desativar manter tela acesa, sair do reader e pausar o app. A janela só permanece acordada em leitura foreground quando a preferência permite.

## Evidência desta implementação

Beta 0.5.5 preparada em 2026-10-23 na branch `codex/android-webview`, PR [#2](https://github.com/rafaelhschuh/litera/pull/2). O PR #1 foi encerrado sem merge; nenhuma evidência do cliente nativo rejeitado conta como aprovação deste host.

- Build local com JDK 17/SDK 36: `testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest` aprovado, 9 testes unitários (6 de origem e 3 de payload), zero falhas; APK e instrumentação compilados. Código do APK: `dc1cbc2`; commits posteriores desta rodada ajustam somente testes/documentação.
- Web: `npm run verify` aprovado com 182 testes, lint, typecheck e builds. Rodada E2E Chromium: 24 de 25 aprovados; o teste de atualização do Service Worker esgotou o tempo sob builds concorrentes e passou na execução isolada (1/1). Isso não representa 25/25 numa única rodada.
- Emulador Android 15/API 35, WebView `124.0.6367.219`: **7/7 testes instrumentados aprovados, zero falhas/skips**, código `355be4b`, [execução 39963585995](https://github.com/rafaelhschuh/litera/actions/runs/39963585995). Os dois jobs Android (build e emulador) passaram. Cobertura: HTTP opt-in, histórico SPA/Back, diálogo web, pixel real da área da câmera, sessão/rota após recriação, perfis separados por porta, bloqueio de bridge em subframe, tela acesa/ciclo de vida e restauração do tema ao trocar servidor.
- O teste integrado passou com PWA de produção + API/SQLite reais sobre fixtures sintéticas: login, navegação, EPUB com CFI/chapterHref/elementIndex persistidos, recriação da Activity, PDF.js na página 2 com locator `pdf-page`, ajustes Android e downloads explícitos EPUB/PDF. Após bloquear rede tanto da WebView quanto do Service Worker por perfil, os dois readers abriram por reload em rota profunda usando os pacotes offline. Isso comprova esse cenário em emulador; não comprova cold start após process death nem outbox entre aparelhos.
- Capturas revisadas da execução aprovada: [EPUB offline](assets/webview-epub-offline.png), [PDF offline na página 2](assets/webview-pdf-offline.png) e [ajustes Android](assets/webview-settings.png). A captura automática chamada biblioteca ainda mostra a tela inicial por atraso de composição; ela não é usada como prova visual da Biblioteca.
- APK local debug assinado: `android/build/artifacts/litera-0.5.5-debug.apk`; SHA-256 `adfc80a00bf1d864091363b8b702443e3fea3b63efd6aad8a40f559bbb6f0c30`. Assinatura verificada com `apksigner verify`. O checksum do artifact de CI pode diferir devido à chave debug do runner.

O mirror principal Ubuntu destravou o CI web: lint, typecheck, 182 testes e builds passaram na execução [39963585954](https://github.com/rafaelhschuh/litera/actions/runs/39963585954). O gate adicional WebKit teve 27/29 aprovados e dois timeouts no hook de preparação do primeiro contexto, antes das asserções. A preparação agora roda com um worker e limite de hook de 30 segundos; as asserções mantêm seus limites. O CI deve ser repetido; E2E/container dessa execução ficaram bloqueados pelo gate WebKit. Não apresentar o pipeline inteiro como aprovado.

Checklist físico, origem HTTPS real, ícone em diferentes launchers, teclado/cutout, fonte grande, conflito entre clientes e cold start após encerramento do processo permanecem pendentes até teste desta beta no aparelho do usuário.

O PR fica em draft, sem merge e sem merge automático até teste e autorização expressa do usuário. CI aprovado não revoga esse requisito.

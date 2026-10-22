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

Validação do novo host WebView ainda deve ser registrada após a execução dos gates. Não reutilizar contagens, capturas ou aprovações do PR nativo anterior. Checklist físico permanece pendente até o usuário testar este APK.

O PR fica em draft, sem merge e sem merge automático até teste e autorização expressa do usuário. CI aprovado não revoga esse requisito.

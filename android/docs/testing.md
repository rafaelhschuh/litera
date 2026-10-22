# Validação Android

Build, unitários, emulador e aparelho físico são evidências diferentes. Registre comando, resultado, commit/APK, Android/API e versão da engine EPUB quando aplicável. Um APK compilado não comprova UX ou funcionamento com servidor real. Veja a [matriz principal](../../docs/development/compatibility-matrix.md); o [checklist offline web](../../docs/development/offline-validation.md) não certifica o cliente Android.

## Gates automatizados

Na pasta android, com JDK 17 e SDK configurado:

```bash
./gradlew testDebugUnitTest lintDebug assembleDebug
./gradlew connectedDebugAndroidTest
```

O segundo comando requer emulador/aparelho. O [workflow](../../.github/workflows/android.yml) mantém instrumentação em job separado e publica relatórios; consulte a execução efetiva. Alterações compartilhadas de API/locator/web exigem os gates npm/Playwright pertinentes.

Unitários devem cobrir normalização de origem/portas, esquemas e credenciais inválidos, opt-in HTTP, escopo de sessão, parsing de respostas e conversão/restauração de locators. Instrumentação deve exercitar telas nativas e engines reais. Fixtures isoladas não substituem a sequência integrada sobre Litera.

## Escopo da instrumentação versionada

`NativeHostTest` usa MainActivity/Views reais, Espresso e servidor HTTP local com o schema da API: sessão não autenticada, login/cookie, preferências e catálogo. Cobre consentimento HTTP antes do primeiro request, formulário nativo, listagem RecyclerView, recriação da Activity com sessão e login rejeitado sem acesso ao catálogo. Também contém arquivos EPUB/PDF válidos, abre as engines reais, verifica texto EPUB sem script da publicação, navegação para capítulo/página seguinte, gravação do locator, troca para tema escuro com contraste de barras sem substituir o fragmento e restauração após recriação da Activity. A fixture não serve o site e não substitui servidor Litera real, TLS ou cenários físicos. O job preserva capturas da biblioteca, EPUB escuro e PDF em `app/build/outputs/connected_android_test_additional_output/` (diretório fornecido pelo runner antes de desinstalar o app), junto dos relatórios, para inspeção visual. Teste versionado não significa teste executado; consultar relatórios do workflow para a evidência.

## Checklist de integração

Estes itens são requisitos; não declaram testes já executados:

- [ ] Configurar HTTPS, autenticar em formulário nativo, listar/buscar e abrir detalhe com API real; loading, vazio, acesso negado e erro/retry funcionam.
- [ ] HTTP sem consentimento e certificados inválidos falham; redirects não levam cookie a outra origem.
- [ ] Duas origens no mesmo host com portas diferentes mantêm sessões/arquivos separados. Trocar conta não expõe livros privados anteriores.
- [ ] Sessão sobrevive a reinício cifrada; senha não aparece no disco, logs ou renderer. Sessão inválida/Keystore indisponível exige login sem fallback em claro.
- [ ] EPUB real abre via Readium preservando capítulos, imagens e estilos; PDF real abre via PdfRenderer com página correta.
- [ ] Restaurar EPUB após pausa, recriação e process death mantém capítulo/progressão; abrir o mesmo livro na web preserva a semântica aditiva do locator.
- [ ] Restaurar PDF mantém página; arquivo revisado não reutiliza cache/locator como se fosse a revisão anterior.
- [ ] Dois clientes gravando progresso recebem conflito por revisão e escolha explícita; nunca vencer pelo maior percentual.
- [ ] Falha no envio de progresso não mostra confirmação falsa; rascunho durável sobrevive a novo processo e reenvia com a mesma chave de idempotência. Confirmação perdida não duplica operação; logout bloqueia acesso e somente novo login da mesma conta recupera pendência.
- [ ] Download cancelado/interrompido não é anunciado completo; cópia válida existente não é trocada por arquivo parcial.
- [ ] Reabrir arquivo já baixado confirma exatamente quais ações funcionam sem rede; registrar separadamente catálogo, autenticação e gravação/reenvio de progresso. Não tratar cache do arquivo como offline completo.
- [ ] Logout, expiração, troca de origem e remoção de dados informam impacto nas pendências e preservam isolamento.
- [ ] Link externo exige gesto; EPUB malicioso não recebe sessão, filesystem amplo ou privilégios nativos.

## Checklist de experiência no aparelho

- [ ] Ícone adaptativo não é cortado em máscaras círculo, quadrado arredondado e temática/monocromática; identidade Litera permanece reconhecível.
- [ ] Claro/escuro/sépia e cores do reader mantêm contraste de barras sem faixa branca no recorte da câmera.
- [ ] Android 15/16: gestos, três botões, recorte, teclado e rotação não cobrem controles.
- [ ] Voltar fecha diálogo antes de sair, preserva posição e retorna ao catálogo sem reiniciar a sessão.
- [ ] Controles nativos são acessíveis por TalkBack, fonte ampliada e toque; capacidades indisponíveis não aparecem como funcionais.
- [ ] Manter tela acesa só vale durante leitura ativa em foreground; pausa/retorno não muda posição nem duplica gravações.
- [ ] Atualizar preview, reinstalar e limpar dados têm efeitos documentados; assinatura debug não é apresentada como release estável.

## Evidência física

Pendente até execução e registro. Não inferir os resultados abaixo de um build ou testes de navegador.

| Commit / APK | Aparelho | Android / API | Engine | Cenário | Resultado / evidência |
|---|---|---|---|---|---|
| A registrar | A registrar | A registrar | Readium / PdfRenderer | Ícone, barras, login, leitura, restauração e cache | Não validado em aparelho físico |

## Evidência — 2026-10-22

Código Android no commit `674ac70`, baseado na release web 0.5.5 (`8ecda20`):

- Local: JDK 17, SDK/target 36, mínimo 28; `testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest` aprovado com 21 unitários, sem falhas nem skips. APK e instrumentação compilados; assinatura debug verificada por apksigner. O build limpo anterior também passou. `adb devices` local não apresentou aparelho/emulador.
- APK local `litera-0.5.5-debug.apk`: versionCode `5005`; SHA-256 `ece911b6bfb297aa44cc81486604d7cc17555df5b0fa4de4c83bea032d5db51f`. CI tem assinatura/timestamps próprios; conferir o `SHA256SUMS` do artifact correspondente.
- Web/API: `npm run verify` local aprovado, com 183 testes e builds web/servidor. O [CI web integrado](https://github.com/rafaelhschuh/litera/actions/runs/39713726855) aprovou 183 testes, 29 verificações de storage/sync em WebKit, 34 E2E Chromium desktop/móvel e build Docker. As alterações posteriores são restritas ao Android/documentação/workflow, sem alteração do código web validado.
- CSP verificada separadamente no Chromium com os hosts/caminhos sintéticos Readium: script da engine permitido, script inline e arquivo JavaScript da publicação bloqueados. Complementa os testes de sanitização e a instrumentação Android.
- Ícone conferido no [preview de máscaras](assets/icon-preview.png), sem inferir resultado de launcher físico.
- [CI Android aprovado](https://github.com/rafaelhschuh/litera/actions/runs/39782367159), código `674ac70`: unitários/lint/APK e 4 cenários instrumentados em Android 15/API 35, sem falhas, erros ou skips. Engines reais Readium 3.2.0/PdfRenderer; login/cookie, cliente independente com sessão cifrada persistida, EPUB sanitizado, navegação capítulo/página, tema e cores da engine sem substituir fragmento, gravação e restauração após recriação. O servidor desses cenários é a fixture de API versionada; não é evidência de servidor Litera real.
- Capturas dessa execução conferidas: [catálogo](assets/native-catalog.png), [EPUB escuro](assets/native-epub-dark.png), [PDF](assets/native-pdf.png). A revisão visual corrigiu o contraste da capa padrão e alinhou o papel/tinta Readium aos controles/barras. As capturas mostram uma tela pequena com fixtures; não certificam launcher físico, recorte real ou todos os arquivos EPUB/PDF.

Aparelho físico e integração com servidor Litera real continuam pendentes nos checklists acima. O PR permanece em draft, sem merge até o teste e autorização do usuário.

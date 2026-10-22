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

`NativeHostTest` usa MainActivity/Views reais, Espresso e servidor HTTP local com o schema da API: sessão não autenticada, login/cookie, preferências e catálogo. Cobre consentimento HTTP antes do primeiro request, formulário nativo, listagem RecyclerView, recriação da Activity com sessão e login rejeitado sem acesso ao catálogo. Também contém arquivos EPUB/PDF válidos, abre as engines reais, verifica texto EPUB sem script da publicação, navegação para capítulo/página seguinte, gravação do locator, troca para tema escuro com contraste de barras sem substituir o fragmento e restauração após recriação da Activity. A fixture não serve o site e não substitui servidor Litera real, TLS ou cenários físicos. O job preserva capturas da biblioteca, EPUB escuro e PDF em `build/device-screenshots/`, junto dos relatórios, para inspeção visual. Teste versionado não significa teste executado; consultar relatórios do workflow para a evidência.

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

## Evidência local — 2026-10-21

Workspace baseado em `8ecda20` (release web 0.5.5), com a implementação nativa deste subprojeto:

- JDK 17, SDK/target 36, mínimo 28; `clean testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest` aprovado com 21 unitários, sem falhas nem skips. Instrumentação compilada; `adb devices` não apresentou dispositivo/emulador, portanto **não executada localmente**.
- `npm run verify` aprovado: typecheck, ESLint, 183 testes e builds web/servidor. E2E desktop/móvel: 33 de 34 na execução ampla; o cenário de atualização de download móvel atingiu timeout com controles auto-ocultos. O helper passou a revelar controles pela interação de teclado suportada; esse cenário reexecutado passou. Após o ajuste final de restauração, os 3 cenários de EPUB, notas/responsividade e locator nativo também passaram.
- CSP verificada separadamente no Chromium usando os hosts/caminhos sintéticos da engine: script Readium permitido, script inline e arquivo JavaScript da publicação bloqueados. Isso complementa os testes de sanitização; não substitui instrumentação Readium Android.
- Ícone conferido no [preview de máscaras](assets/icon-preview.png), sem inferir resultado de launcher físico.
- APK local `litera-0.5.5-debug.apk`: versionCode `5005`, assinatura debug verificada por apksigner; SHA-256 `b23aeeb189e487f7685764c70e1ab5429d129e7488d4648ab439d1719112374b` (este hash é do build local; CI tem assinatura/timestamps próprios).

Execução Android no GitHub e validação física devem registrar seus resultados separadamente abaixo, sem converter compilação em evidência de execução.

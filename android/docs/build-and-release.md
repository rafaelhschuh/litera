# Build e distribuição Android

## Ferramentas e versão

O subprojeto usa Kotlin, AndroidX Views, Readium EPUB e Android PdfRenderer, Android Gradle Plugin 9.0.1, Gradle Wrapper 9.1.0, JDK 17 e SDK 36 (compile/target); mínimo Android 9/API 28. Use o wrapper versionado e valide sua integridade. Não dependa de Gradle global nem copie SDK/keystore para o repositório. O target deste preview é explicitamente API 36 (ADR-0010), mesmo quando o runner tem um SDK posterior instalado. O aviso consultivo `OldTargetApi` é desabilitado com justificativa no módulo; os demais diagnósticos funcionais continuam falhando o build. Subir o target exige revisar mudanças de comportamento e executar os gates de engines/ciclo de vida/barras, além das exigências de distribuição aplicáveis.

A versão vem de [`package.json`](../../package.json) na raiz. `versionName` acompanha a versão semântica; `versionCode = major * 1_000_000 + minor * 1_000 + patch`. Minor/patch precisam caber em três dígitos e o código deve respeitar o limite Android. Não altere versão Android isoladamente nem faça bump automático ao executar o build.

## Build local

Instale Android SDK/platform/build tools exigidos pelo projeto, aceite as licenças e configure `ANDROID_HOME` ou `local.properties` local com `sdk.dir` (não versionado). Na pasta `android`:

```bash
./gradlew testDebugUnitTest lintDebug assembleDebug
./gradlew connectedDebugAndroidTest
```

Application ID de preview: `io.github.rafaelhschuh.litera.debug`, separado do identificador release.

Saída debug local: `app/build/outputs/apk/debug/app-debug.apk`. No CI, o artifact renomeia o arquivo para `litera-<versão>-debug.apk` e inclui `SHA256SUMS`; a versão é a da raiz e o nome do artifact também inclui versão/commit. Os relatórios ficam em `app/build/reports/` e resultados de testes em `app/build/test-results/`. `connectedDebugAndroidTest` requer emulador/aparelho disponível via adb.

## CI adicional

O [workflow Android](../../.github/workflows/android.yml) é independente dos pipelines web/container existentes. Roda em PR/push com filtros dos caminhos Android, workflow e arquivos de versão, em tags e por disparo manual. Permissão padrão é `contents: read`.

Os gates são testes unitários, lint e montagem do APK debug, além de instrumentação em emulador em job separado. Artifacts contêm APK, checksum SHA-256 e relatórios. O workflow não publica em loja, não anexa APK automaticamente à GitHub Release e não substitui os gates web/Docker de [`git-and-ci.md`](../../docs/development/git-and-ci.md).

Um artifact gerado não comprova os testes físicos. Registre a execução efetiva e os resultados em [testing.md](testing.md), incluindo gaps do ambiente.

## Aprovação deste preview

O PR de implementação nativa permanece em draft: por instrução explícita do usuário, não fazer merge antes de ele testar o APK e autorizar a integração. Publicar artifacts de teste e enviar commits à branch do PR não autoriza merge nem release estável.

## Assinatura e preview

O APK debug de CI usa chave debug efêmera do runner. É um **preview**, sem identidade de assinatura estável entre execuções. Instalar um artifact sobre outro pode falhar por incompatibilidade de assinatura; reinstalação pode apagar arquivos privados, sessão e progresso ainda não sincronizado. Sincronize antes.

Distribuição estável futura exige keystore externo persistente, secrets no CI, política de recuperação/backup da chave e assinatura release explícita. Nunca versione keystore, senhas, certificados privados ou arquivos de configuração secretos. Não ofereça um APK unsigned como atualização instalável. A release web atual permanece com seu pipeline próprio e esta adição não muda sua versão.

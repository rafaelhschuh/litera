# Litera para Android

Aplicativo Kotlin que hospeda o Litera completo em uma WebView de primeiro nível. Catálogo, conta, leitor EPUB, PDF original/adaptado, busca, destaques e downloads continuam na mesma implementação web. O Android cuida da configuração inicial, barras do sistema, teclado, navegação e ciclo de vida. Essa divisão evita manter duas interfaces e dois leitores.

A decisão está no [ADR-0010](../docs/decisions/ADR-0010-android-webview-host.md). O preview anterior com telas/engines nativas foi rejeitado e não foi integrado à branch principal. Este trabalho segue em outro PR, sem merge até teste e autorização do usuário.

## Instalação e conexão

1. Obtenha o APK de preview nos artifacts do [workflow Android](../.github/workflows/android.yml); veja [build e distribuição](docs/build-and-release.md).
2. Instale e informe a origem do servidor, por exemplo `https://livros.example.org`, sem subdiretório.
3. Entre pela própria tela de login Litera. O servidor continua instalado conforme o [README principal](../README.md).

Requer Android 9/API 28 ou superior e provedor Android System WebView/Chrome com suporte a múltiplos perfis. O app verifica a capacidade antes de carregar a origem; se indisponível, pede atualização do provedor. A versão do Android isoladamente não comprova esse suporte.

No celular, localhost aponta para o próprio aparelho. Use endereço alcançável e preferencialmente HTTPS com certificado válido. HTTP exige aceite explícito, expõe dados à rede e, fora de localhost, pode impedir Service Worker e offline completo. Certificados inválidos são recusados.

Sessão e downloads ficam no perfil privado do APK por origem. Não são compartilhados com Chrome/PWA: entre e escolha **Salvar para offline** novamente no app. O comportamento de conta, logout, quota e conflitos permanece o [contrato offline web](../docs/decisions/ADR-0009-offline-packages-and-outbox.md). Não há fila Android paralela ou garantia de sincronização com o app fechado.

Se usou o preview nativo rejeitado, sincronize nele antes da troca. Seus arquivos e diário nativos não são importados pelo host WebView; o que já foi confirmado no servidor permanece disponível. Artifacts debug podem ter assinaturas diferentes e exigir reinstalação, que apaga dados locais.

![Ícone Litera em máscaras circular, arredondada e temática](docs/assets/icon-preview.png)

Os ajustes do host ficam em **Preferências → Aplicativo Android**. Também é possível manter pressionado o ícone no launcher e escolher **Ajustes do Android**, inclusive quando o servidor ainda usa um frontend anterior a esta integração.

## Desenvolvimento

Requer JDK 17 e Android SDK 36. O projeto usa Gradle Wrapper 9.1.0, AGP 9.0.1 e AndroidX WebKit 1.15.0. Na pasta `android`:

```bash
./gradlew testDebugUnitTest lintDebug assembleDebug
./gradlew connectedDebugAndroidTest
```

Instrumentação exige emulador/aparelho e provedor WebView compatível. A versão deriva do package.json raiz, atualmente `0.5.5`; preview usa application ID `io.github.rafaelhschuh.litera.debug`.

## Contratos

- [Instruções para agentes](AGENTS.md)
- [Arquitetura](docs/architecture.md)
- [Segurança](docs/security.md)
- [Testes e checklist físico](docs/testing.md)
- [Build, CI e assinatura](docs/build-and-release.md)

O APK é preview, sem assinatura de distribuição estável e sem publicação automática em loja/GitHub Release. Evidência de emulador/browser não substitui o teste do usuário em aparelho físico.

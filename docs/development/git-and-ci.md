# Git and CI

## Pre-MVP

Optimize for speed. Small coherent commits to `main` are acceptable. Avoid branch bureaucracy.

## Parallel/post-MVP development

Use short-lived branches or worktrees with required checks before merge when multiple agents are active.

## CI gates

`.github/workflows/ci.yml` roda em pull requests e pushes para `main` com os gates reais:

- `npm ci`;
- lint;
- typecheck;
- testes unitários e de integração;
- build de produção;
- E2E Chromium e WebKit com instalação dos motores pelo Playwright;
- build da imagem Docker.

Falhas não são ignoradas. O workflow normal tem somente `contents: read`.

## Imagens e releases

`.github/workflows/container.yml` publica `ghcr.io/rafaelhschuh/litera:main` e `sha-<commit>` em pushes para `main`, usando `GITHUB_TOKEN` com `packages: write`.

`.github/workflows/release.yml` roda para tags `v*.*.*`, exige que a tag corresponda à versão de `package.json`, repete todos os gates, publica as tags semânticas da imagem e só então cria a GitHub Release. Para `v0.5.5`, as tags são `0.5.5`, `0.5`, `0` e `latest`.

Processo de release:

```bash
git tag -a v0.5.5 -m "Litera 0.5.5"
git push origin v0.5.5
```

## APK Android adicional

O cliente Android é nativo Kotlin/Views sobre a API compartilhada, com Readium/PdfRenderer; veja [ADR-0010](../decisions/ADR-0010-native-android-client.md). O [workflow Android](../../.github/workflows/android.yml) é independente: PR/push com filtros de caminhos do subprojeto/workflow/versão, tags e disparo manual. Usa `contents: read`, valida o wrapper e executa testes unitários, lint e `assembleDebug`; instrumentação roda em job separado de emulador. Publica APK preview, SHA-256 e relatórios como artifacts. Veja [build/release Android](../../android/docs/build-and-release.md).

Versão Android deriva de `package.json` da raiz, sem bump próprio. Chave debug efêmera de CI não oferece atualização estável entre artifacts; assinatura release futura exige keystore externo. Este workflow não anexa APK automaticamente à GitHub Release, não altera a publicação Docker atual e não comprova validação em aparelho físico. Gates de [Android testing](../../android/docs/testing.md) continuam explícitos.

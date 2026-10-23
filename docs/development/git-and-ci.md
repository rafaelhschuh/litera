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

Na instalação das dependências de sistema do Playwright, o CI substitui o mirror Ubuntu da Azure pelo arquivo primário HTTPS do Ubuntu quando o runner usa `/etc/apt/apt-mirrors.txt`. O mirror da Azure esgotou o limite de 30 minutos durante os downloads; essa escolha mantém os mesmos pacotes e gates, sem suprimir a instalação ou seus erros. O gate WebKit roda com um worker e permite 30 segundos nos hooks de preparação dos contextos; o limite das asserções permanece inalterado. Isso evita que o primeiro contexto exceda 10 segundos sob concorrência no runner compartilhado.

## Imagens e releases

`.github/workflows/container.yml` publica `ghcr.io/rafaelhschuh/litera:main` e `sha-<commit>` em pushes para `main`, usando `GITHUB_TOKEN` com `packages: write`.

`.github/workflows/release.yml` roda para tags `v*.*.*`, exige que a tag corresponda à versão de `package.json`, repete todos os gates, publica as tags semânticas da imagem e só então cria a GitHub Release. Para `v0.6.0`, as tags são `0.6.0`, `0.6`, `0` e `latest`.

Processo de release:

```bash
git tag -a v0.6.0 -m "Litera 0.6.0"
git push origin v0.6.0
```

## Android preview

O [workflow Android](../../.github/workflows/android.yml) é adicional e independente: testes unitários, lint, APK debug e instrumentação em emulador. Artifacts incluem APK, SHA-256 e relatórios; não publicam automaticamente em loja ou GitHub Release. Versão vem do package.json raiz, atualmente `0.5.5`; não alterar tags existentes para distribuir preview.

Consulte [build/assinatura](../../android/docs/build-and-release.md) e [evidência Android](../../android/docs/testing.md). A chave debug do runner não fornece identidade estável entre execuções. O PR nativo anterior foi rejeitado sem merge; o novo PR WebView deve permanecer em draft, sem merge automático nem integração, até teste do APK e autorização expressa do usuário. Push de ajustes e geração de artifacts não equivalem a essa autorização.

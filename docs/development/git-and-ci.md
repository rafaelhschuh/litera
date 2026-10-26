# Git and CI

## Pre-MVP

Optimize for speed. Small coherent commits to `main` are acceptable. Avoid branch bureaucracy.

## Parallel/post-MVP development

Use short-lived branches or worktrees with required checks before merge when multiple agents are active.

## CI e publicação

- **CI** roda em PRs e pushes para `main`. Lint/tipos/testes, build/E2E Chromium desktop/mobile e storage/sync WebKit executam em paralelo. A imagem oficial Playwright, fixada na versão do lockfile, já contém navegadores e dependências: não há instalação apt a cada execução.
- Checkout, setup e instalação de dependências usam o usuário padrão do container; depois o workspace passa a pertencer a `pwuser`. Lint, tipos, builds, servidor de fixtures e testes executam como `pwuser`, sem privilégios de root, preservando a cobertura real das permissões de upload (`chmod 0555` deve impedir escrita). O teste de pasta somente leitura permanece obrigatório.
- `CI / verify` exige todas as verificações e o build Docker de PR. Em `main`, o próprio CI constrói/publica `main` e `sha-<commit>` somente após aprovação, com cache BuildKit. O workflow Container separado foi removido.
- Novos pushes cancelam CIs anteriores da mesma branch/PR. As suítes têm limite de 15 minutos; E2E para após três falhas, mantendo todos os casos nas execuções aprovadas.
- **Release** responde a tags estáveis `vMAJOR.MINOR.PATCH` ou disparo manual com uma tag existente. Confere versão/commit, exige CI bem-sucedido em `main` para o mesmo SHA e promove o digest de `sha-<commit>` para versão completa, minor, major e `latest`. Não reinstala navegadores, repete testes ou reconstrói a imagem. Aguarda um CI pendente por até 40 minutos, abrangendo os limites sequenciais de validação (15), verificação (2) e publicação (15), e recusa imediatamente CI concluído sem sucesso. O polling termina assim que houver aprovação; esse teto não adiciona espera a um CI já aprovado. Tags completas existentes só podem apontar ao mesmo digest.
- A GitHub Release é criada após a promoção. Retentativas reutilizam a tag original e a imagem aprovada; não mova tags Git existentes.

```bash
git tag -a v0.7.0 -m "Litera 0.7.0"
git push origin v0.7.0
# Retomar uma publicação pelo workflow atualizado na main:
gh workflow run release.yml --ref main -f tag=v0.7.0
```

O workflow normal tem `contents: read`; somente o job de publicação recebe `packages: write`. Release recebe leitura de Actions para verificar o CI e escrita para imagem/release.

## Android preview

O [workflow Android](../../.github/workflows/android.yml) roda automaticamente somente quando arquivos nativos sob `android/` mudam (excluindo documentação), ou manualmente. Alterações web, backend, versão raiz e tags web não o disparam. Mudanças somente no próprio workflow são validadas estaticamente; a execução nativa pode ser solicitada manualmente. Seus gates continuam: testes unitários, lint, APK debug e instrumentação em emulador. Artifacts incluem APK, SHA-256 e relatórios; não publicam automaticamente em loja ou GitHub Release. Versão vem do package.json raiz, atualmente `0.5.5`; não alterar tags existentes para distribuir preview.

Consulte [build/assinatura](../../android/docs/build-and-release.md) e [evidência Android](../../android/docs/testing.md). A chave debug do runner não fornece identidade estável entre execuções. O PR nativo anterior foi rejeitado sem merge; o novo PR WebView deve permanecer em draft, sem merge automático nem integração, até teste do APK e autorização expressa do usuário. Push de ajustes e geração de artifacts não equivalem a essa autorização.

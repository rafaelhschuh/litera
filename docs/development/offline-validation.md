# Validação offline 0.5

## Baseline desta implementação

- Versão inicial: 0.4.3; branch `main`.
- `npm ci`: aprovado após execução autorizada fora do sandbox (o sandbox bloqueava subprocesso do esbuild).
- `npm run typecheck` e `npm run build`: aprovados.
- `npm run lint`: cinco erros em arquivo local não rastreado `.codex-local/validate-sofia.mjs`; arquivos preservados e diretório excluído do lint/contexto Docker.
- `npm test`: 60 testes aprovados após autorizar portas locais do Supertest.
- `npm run test:e2e`: cinco Chromium aprovados. WebKit inicialmente não iniciava por `libavif.so.16` ausente no host; bibliotecas oficiais foram extraídas em diretório temporário, sem alterar o sistema, e os cinco testes WebKit passaram com esse runtime.

## Pipeline reproduzível

```sh
npm ci
npx playwright install --with-deps chromium webkit
npm run lint
npm run typecheck
npm test
LITERA_STORAGE_BROWSER=webkit npm test -- tests/offline-store.test.ts tests/offline-sync.test.ts
npm run build
npm run test:e2e
docker build -t litera:offline-validation .
```

O E2E usa o build de produção e um servidor real com acervo sintético. Não usar o Vite dev server como prova de Service Worker/offline. Em host com dependências especiais, `LITERA_WEBKIT_EXECUTABLE` aponta ao runtime WebKit preparado; no CI Ubuntu use a instalação padrão Playwright.

## Checklist em hardware real (pendente)

Registrar modelo, OS, versão do navegador, modo browser/standalone e versão do Litera. Executar em iPhone/iPad Safari, macOS Safari, Android Chrome e desktop Chromium conforme dispositivos disponíveis.

1. Acessar por HTTPS, entrar e instalar/adicionar à Tela de Início (no Mac, Dock).
2. Salvar um EPUB com capítulos, imagens, CSS/fontes e um PDF representativo. Esperar “Disponível offline”.
3. Fechar o app. Desligar **Wi-Fi e dados móveis**; abrir pelo ícone instalado, sem app residente na memória.
4. Conferir biblioteca, capas e busca local. Abrir uma rota profunda diretamente e recarregar sem rede.
5. Abrir EPUB, navegar entre telas/capítulos, mudar tema/tamanho, conferir imagens e fonte embarcada. Criar destaque, fechar/reabrir e conferir posição e destaque.
6. Abrir PDF Original, renderizar/navegar páginas e alternar para Adaptado. Conferir texto, figuras e glifos; fechar/reabrir em ambos os modos mantendo a posição.
7. Bloquear/desbloquear o aparelho durante a leitura, girar a tela e continuar sem perder posição.
8. Favoritar e remover destaque offline. Recarregar e conferir o estado local.
9. Religar a internet e abrir a biblioteca. Conferir sincronização sem precisar reabrir cada livro; validar progresso/destaques/favoritos no servidor ou outro cliente.
10. Repetir tentativa após falha de rede; nenhum destaque duplicado. Produzir conflito de progresso em outro dispositivo e conferir o aviso de preservação da revisão remota.
11. Cancelar um download pela metade, depois repetir. Falha nunca deve aparecer como disponível. Atualizar um download interrompendo a rede e conferir que a cópia anterior abre.
12. Remover download em Preferências. Conferir liberação dos bytes e preservação do estado pessoal no servidor/fila.
13. Sair da conta offline, reconectar e reabrir: deve permanecer no login. Entrar com outra conta e confirmar ausência dos downloads anteriores.
14. Publicar uma atualização com livro aberto: nenhum reload automático. Aceitar atualização num momento seguro e conferir manutenção dos downloads.

Nenhuma validação automatizada neste host deve ser descrita como teste em iPhone/iPad físico ou instalação real pela Tela de Início.

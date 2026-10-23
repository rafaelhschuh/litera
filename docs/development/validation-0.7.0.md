# Validação 0.7.0 — 2026-10-23

## Escopo

Barra inferior de celulares e painel Outros, seleção móvel, transições laterais do reader, preparação de capítulos/recursos EPUB e páginas PDF vizinhas. Nenhuma migration nova, alteração de locators, scanner, fontes de livros ou Android.

## Gates locais

Node 22.23.4:

- `npm run typecheck`: passou.
- `npm run lint`: passou.
- `npm test -- --maxWorkers=2`: **204 testes / 22 arquivos**, passou.
- `npm run build`: passou, web e servidor.
- `docker build -t litera:0.7.0 .`: passou.

## Navegadores

`npx playwright test --project=chromium --project=chromium-mobile`: **59 E2E passaram**, incluindo os fluxos offline, PWA update, reader, catálogo, upload e os casos novos da barra/preparação.

A rodada final dos cinco casos novos em Chromium desktop, Chromium móvel e WebKit passou: **15/15**. Inclui leitura sem Web Animations e sem Shadow DOM, com navegação direta funcional. Os casos de reader EPUB/PDF no WebKit também passaram nas rodadas e retestes; o reteste direcionado de navegação, erro de adaptação e troca de modos foi **7/7**, nos três projetos aplicáveis.

O teste de erro PDF agora induz a falha antes da preparação do vizinho, evitando esperar erro depois de uma página já ter sido carregada com sucesso. O helper de abertura reconhece a ação legítima **Reler** quando testes anteriores concluíram o livro. Uma rodada local colidiu com a substituição do bundle durante build (404 de chunk antigo); o reteste usa servidor iniciado após o build concluído.

## Container real

Smoke com biblioteca EPUB e dados persistidos criados na imagem **0.6.1**, atualizados para **0.7.0**:

- health/version e assets do bundle de produção;
- autenticação, catálogo e manifesto EPUB;
- locator EPUB e preferência de páginas pela tela preservados;
- restart e reautenticação com progresso intacto.

Containers e diretórios temporários foram removidos. A imagem local permanece disponível. Sem alteração de arquivos fonte pelo scan.

## Critérios cobertos

- Ordem Favoritos/Biblioteca/Início/Busca/Outros, seleção e contraste por tokens, painel/modal com foco/Escape/retorno de foco, seleção em rotas secundárias/admin e ausência de Administração para leitores.
- Alvos de toque a 320px, desktop com sidebar, ausência de barra no leitor e redução de movimento.
- EPUB seguinte solicitado antes da navegação e reutilizado sem outro fetch; frames de animação sem opacity, duração de 240ms no bundle otimizado, direção nos dois sentidos, swipe e ausência de transform no iframe.
- Canvas PDF vizinho pré-renderizado reutilizado pela identidade do objeto; PDF adaptado seguinte reutilizado sem abrir o binário original no navegador.
- Cache limitado, descarte/abort, transferência de propriedade, falha/retry e liberação de conclusão tardia.
- Regressões de capítulos/páginas, rotação, restauração, destaques repetidos, CSP, conflitos de progresso, offline, logout e isolamento de conta.

## Limites

WebKit automatizado não substitui Safari/iPhone físico. A preparação é opcional: vizinhos muito pesados, mudanças de escala e comandos antes da preparação terminar usam o carregamento normal. Canvas vizinhos acima do orçamento não reduzem a qualidade do render visível. O cache não cria downloads offline. `/legacy` preserva o fluxo conservador existente.

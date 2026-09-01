# Validação do Reader moderno — setembro/2026

## Baseline e reprodução

Antes das alterações, lint/typecheck passavam. `npm ci` no sandbox falhou por EPERM em subprocesso; os primeiros testes ficaram sem SQLite nativo. Após instalação autorizada fora do sandbox, os testes de integração precisaram igualmente de permissão para porta local. Essas falhas eram ambientais.

Causas confirmadas em código e testes: filtro PDF 9%/91%; descarte de gráficos; transformação do iframe; substituição antecipada do documento; estado de capítulo não associado ao documento ativo; swipe desabilitado; bloqueio de listeners pelo sandbox WebKit. Não foi fornecido o EPUB/PDF específico dos vídeos, portanto não se afirma reprodução byte a byte desses documentos.

## Comandos reproduzíveis

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run smoke
npm run build
npx playwright install --with-deps chromium webkit
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=webkit
docker build -t litera:reader-stability .
```

O E2E inicia servidor real isolado, cria EPUB/PDF próprios, faz login e abre pela biblioteca. Não requer livros privados. A fixture PDF contém texto no topo, meio e fim, parágrafos e imagem em outra página. Chromium/WebKit verificam navegação repetida, posição, configuração, rotação, seleção, notas, touch, troca real Original/Adaptado, fallback, política de scripts e metadados PWA. Viewports: 360×800, 390×844, 393×852, 430×932, 768×1024 e 1024×768.

Neste host Zorin, WebKit foi executado de uma cópia em `/tmp/litera-webkit` com libavif16/libgav1/libyuv extraídas, sem instalação no sistema. `LITERA_WEBKIT_EXECUTABLE` permite apontar esse executável; normalmente deve ser omitida. Os resultados de navegador não equivalem a iPhone físico nem a instalação standalone real.

Debug de desenvolvimento: acrescentar `?readerDebug=true`. Eventos de input, viewport, restore/save e gerações PDF/adaptação são registrados somente com esse modo em DEV; nenhum texto de livro é enviado a telemetria.

## Resultado desta rodada

- `npm ci`, lint, typecheck, 49 testes unitários/integração, smoke e build: aprovados.
- Chromium: cinco E2E aprovados. WebKit 26.5: cinco E2E aprovados.
- Docker: imagem `litera:reader-stability` construída.
- A imagem PDF é verificada também por pixel do canvas, não apenas pela existência do elemento. Range testado em PDF de mais de 8 MiB, incluindo suffix, intervalo inválido e resposta completa para múltiplos intervalos.
- Capturas em `test-results/transition-*.png` e `pdf-*.png` inspecionadas: transição separada do iframe e imagem de fallback presente. Arquivos de teste são ignorados pelo Git/Docker.
- Segunda revisão corrigiu rollback de capítulo, notas em srcdoc, preferências durante carga, seleção durante resize, adaptação após await e rotação do fallback.

## Checklist em Safari físico / standalone

Registrar modelo, versão iOS/iPadOS/macOS e modo navegador/instalado.

- EPUB: abrir → conteúdo → tap direita avança uma tela → tap esquerda volta → swipe horizontal → diagonal/vertical não viram página → toolbar → nota/link → seleção longa e handles → portrait/landscape/portrait → fechar/reabrir na posição correta.
- Repetir pelo menos 20 mudanças, incluindo capítulos, tamanho de texto e tema. Observar continuidade da animação, sem branco ou exposição de colunas internas.
- PDF: original completo → Adaptado → início/meio/final visíveis → rolar até último parágrafo → imagem aparece no original de fallback → voltar Original na mesma página → zoom e rotação.
- PWA: adicionar à tela inicial, verificar ícone Litera e nome; abrir sem barra do Safari; verificar notch, toolbar, controles inferiores e rotação. Manifest possui PNG 192/512, maskable 512 e Apple 180; viewport-fit e safe areas estão configurados.
- Mouse/teclado: foco visível, seleção, links e botões sem page turn acidental. Touch: sem flash azul, com feedback pressed. Reduced motion: sem movimento de snapshot.

Offline reading não foi implementado/corrigido nesta etapa e permanece para o próximo prompt.

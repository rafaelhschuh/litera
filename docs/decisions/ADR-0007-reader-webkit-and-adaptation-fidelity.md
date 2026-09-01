# ADR-0007 — Reader WebKit, transição e fidelidade de adaptação

Status: Accepted

## Contexto

O Reader moderno atual usa capítulos EPUB sanitizados em iframe, não `rendition` do EPUB.js. A animação anterior transformava diretamente esse iframe, enquanto a navegação substituía seu documento antes de o seguinte estar pronto. Capturas durante essa janela podiam associar o documento antigo ao capítulo novo.

WebKit bloqueia listeners registrados pelo pai em iframe sem `allow-scripts`, mesmo quando a função pertence ao pai: [WebKit 218086](https://bugs.webkit.org/show_bug.cgi?id=218086). Foi reproduzido nos testes desta rodada: notas navegavam o frame e seleção/touch não acionavam o controller.

A adaptação PDF descartava linhas nas faixas superior/inferior de 9% e ignorava todos os operadores gráficos. Isso perdia conteúdo legítimo.

## Decisão

- Dois slots de iframe, limitados ao capítulo ativo e à preparação do próximo. Fetch valida resposta; geração, carregamento, fontes e frame de layout precedem o commit. O documento anterior permanece visível. Falhas restauram capítulo/locator ativo; falha inicial oferece estado de erro.
- O iframe permite listeners do aplicativo com `allow-scripts`, mas o documento gerado impõe CSP `script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'` antes do conteúdo. A sanitização continua removendo scripts/handlers. A CSP é obrigatória também no `srcdoc`, que não recebe cabeçalhos HTTP próprios. Testes verificam que script inserido no documento é bloqueado. Nunca carregar EPUB bruto nesses slots.
- Transições animam somente uma apresentação descartável, nunca iframe ou paginação. A duração é 240ms, equivalente a `--motion-slow`, com easing padrão e deslocamento de 18px já usado pelo Reader. Reduced motion dispensa essa apresentação. PDF mantém canvas anterior até o seguinte estar renderizado e usa captura da área visível para a transição.
- Navegação percorre telas dentro do capítulo antes de cruzar o spine. Ao voltar de capítulo, posiciona no final. Restauração usa elemento/offset semântico existente; não transforma EPUB em percentual como chave.
- Resize usa debounce de 120ms para agrupar barras/orientação, preserva locator anterior e adia navegação recebida durante ajuste. Não usa detecção de user agent.
- PDF conserva todo texto extraído e mede cobertura sem whitespace. Páginas com gráficos, texto rotacionado, ordem incerta, ausência de texto extraível ou divergência de cobertura continuam no modo adaptado e recebem uma referência visual rasterizada da própria página. A contagem é conferida novamente no DOM. O documento original continua acessível como modo explícito separado.
- PDF.js e worker usam o build `legacy` da mesma versão dentro do Reader moderno. Isso não redireciona ao cliente `/legacy`. A [matriz oficial Mozilla](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions) indica Safari 18+ nesse build.

## Alternativas e consequências

Animar o iframe ou apenas esconder overflow mantém a causa de recomposição. Recriar um único frame mantém a janela branca. Um reader separado por navegador duplicaria estado e comportamento. Snapshots custam memória temporária, limitada a um capítulo ou viewport PDF; não são cache persistente.

A CSP passa a ser uma parte explícita da proteção do iframe moderno. Removê-la ou carregar HTML não sanitizado é uma regressão de segurança. O teste de bloqueio de scripts deve acompanhar qualquer mudança nessa fronteira.

A referência visual é gerada sob demanda pelo mesmo PDF.js já usado pelo Litera e não altera o arquivo fonte nem cria um segundo pipeline persistente no scan. Isso mantém imagens e diagramas disponíveis quando a estrutura do PDF não pode ser refluída com fidelidade sem tirar o usuário do modo adaptado.

Nenhuma mudança em armazenamento offline, fila offline ou service worker foi necessária.

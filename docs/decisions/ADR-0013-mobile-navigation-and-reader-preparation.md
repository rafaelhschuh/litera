# ADR-0013 — Navegação móvel e preparação da leitura

Status: Accepted · 0.7.0

## Contexto

A navegação por drawer em celulares exigia abrir o menu para ações frequentes. A transição do leitor usava fade com deslocamento curto; as páginas pela tela não tinham transição. O capítulo EPUB seguinte e as páginas PDF só eram preparados no comando de navegação.

## Decisão

- Abaixo de 640px, `MobileNavigation` é compartilhada pelos shells de catálogo/admin. Favoritos, Biblioteca, Início, Busca e Outros usam cinco áreas iguais e uma única pílula móvel. Detalhe de livro pertence a Biblioteca; páginas secundárias/admin pertencem a Outros. Tablet/desktop preservam os controles anteriores. Reader/login não incluem a barra.
- Outros estende `UiDialog` com variante sheet sólida, mantendo diálogo nativo, contenção de foco, Escape, retorno de foco e navegação sem dependência da animação. Administração é condicional à role; as APIs continuam responsáveis pela autorização. Tokens existentes controlam forma, cores e movimento. Não há blur/glass.
- Atualiza a transição do ADR-0007: duas apresentações descartáveis e opacas deslizam por uma largura de viewport, em 240ms (`motion-slow`). Não há fade, nem transform no iframe/DOM de paginação. A mesma estratégia cobre telas/capítulos EPUB, canvas PDF e telas/páginas adaptadas. Um novo comando cancela as apresentações anteriores. Redução de movimento e ausência de Web Animations mantêm a troca direta.
- `ReaderPreparation` retém no máximo dois vizinhos por formato/modo; tomar uma entrada transfere sua propriedade ao renderizador. Entradas descartadas abortam tarefas e liberam recursos, inclusive conclusões tardias. Falhas opcionais são descartadas e o carregamento normal pode tentar novamente. Não grava progresso nem downloads.
- Depois de estabilizar o conteúdo visível (180ms), EPUB prepara HTML sanitizado dos capítulos anterior/seguinte, com chave de aparência completa. Páginas dentro do capítulo já estão no DOM; não se monta o livro inteiro. Pacotes locais mantêm seus próprios URLs/edição, sem misturar com rede.
- PDF original prepara canvas e texto de uma página anterior e uma seguinte à área ativa. A chave inclui página, escala e DPR; mudanças de dimensões/zoom não reutilizam pixels de outra escala. Cada canvas tem até quatro milhões de pixels, portanto dois vizinhos consomem no máximo cerca de 32MB de pixels RGBA, além das estruturas PDF.js. O spread visível possui seu próprio ciclo de descarte. Spreads de duas páginas podem preparar a página restante sob demanda.
- PDF adaptado prepara o resultado da API e recursos das páginas anterior/seguinte, sem abrir o PDF original no navegador.
- Hints HTTP de imagens/CSS/fontes usam somente recursos autorizados do mesmo livro, até 12 URLs/8MiB por vizinho, execução sequencial e deadline de cinco segundos. Não são promessa de disponibilidade offline. A cache HTTP do navegador e a decodificação/renderização continuam responsáveis por recursos adicionais.
- Resize, troca de modo e saída descartam preparação incompatível. A identidade da fonte continua presa a conta/sessão/edição do ADR-0009. Locators e âncoras de destaque permanecem inalterados.
- `/legacy` conserva navegação e leitura atuais sem este cache/animação. Android não integra esta entrega.

## Alternativas e consequências

Renderizar três capítulos em iframes permanentemente aumentaria DOM, fontes e custo de layout, além de ampliar o contrato de commit dos frames. Prefetch apenas de URLs não anteciparia a renderização de canvas PDF. Cache persistente paralelo duplicaria os pacotes offline e suas regras de autorização/edição. A preparação em memória mantém o investimento limitado à vizinhança atual; livros muito pesados ou navegação mais rápida que a preparação ainda podem exigir espera pelo carregamento normal.

Canvas de vizinho que ultrapassaria quatro milhões de pixels na qualidade atual não é retido: o render visível preserva o limite anterior de 16 milhões de pixels e carrega normalmente. Não se reaproveita uma imagem reduzida como se tivesse a qualidade da escala solicitada.

As duas superfícies ficam em um recorte de viewport que não amplia a área de rolagem. A apresentação de reflow é isolada em Shadow DOM, com classes visuais distintas: verificações de cobertura, seleção e destaques consultam somente o conteúdo vivo.

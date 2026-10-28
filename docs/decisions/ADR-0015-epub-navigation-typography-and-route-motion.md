# ADR-0015 — Sumário EPUB, tipografia e continuidade visual

Status: Accepted · 0.8.0

## Contexto

O EPUB fornecido pelo usuário expôs metadados `head/title` tratados como prosa e um NCX ignorado, apesar de conter os títulos reais. No modo de rolagem, avançar movimentava outra tela dentro do mesmo capítulo, contrariando a expectativa de troca de capítulo. Snapshots paginados podiam perder `scrollLeft` ao mudar de pai. As preferências ofereciam somente presets e a troca de módulos móveis usava a entrada vertical genérica.

## Decisão

- Manter spine, TOC e posição como conceitos distintos. `navigation` é uma propriedade aditiva do manifest; resolve EPUB 3 nav e EPUB 2 NCX para hrefs/fragmentos do spine, sem reordenar capítulos. Navegação opcional inválida não bloqueia o livro. Metadados `head/title` são excluídos do passe de prosa; títulos reais do corpo são preservados.
- Em rolagem EPUB, setas/swipe lateral mudam de capítulo e abrem seu início. PageUp/PageDown/Space e scroll vertical percorrem o capítulo. Em paginação, mantêm-se telas por viewport e retorno à última tela do capítulo anterior. A restauração do fragmento atravessa a preparação e só é consumida no commit do frame ativo.
- A extensão de rolagem das colunas inclui um marcador CSS não textual na extremidade da última tela. A contagem vem do overflow do conteúdo, recalculada antes da restauração após fontes/imagens/resize; nunca é derivada do viewport já estendido. Isso evita perder a margem direita e truncar o último avanço.
- Substituir as cópias DOM do EPUB por capturas visuais do compositor via View Transitions. Clonar html/body em Shadow DOM não preserva o document root, rem/viewport, pseudo-elementos e todos os estilos dos descendentes; o resultado pode quebrar linhas de forma diferente e saltar ao revelar o iframe vivo. A captura visual desliza os pixels já renderizados, aguarda o commit/fontes/layout da página destino e mantém o iframe sem transform. Não adia a captura durável de progresso. Sem a API, EPUB troca diretamente; PDF conserva seu fallback visual existente. Esta decisão atualiza a estratégia de apresentação do ADR-0013.
- Adicionar preferências tipográficas validadas no servidor, persistidas por migração aditiva e transportadas pelo mesmo settings/outbox. Um resolvedor compartilhado normaliza defaults, limites e compatibilidade com `lineHeight` antigo. `ReaderTypographyFields` serve a ambos os painéis; não se introduzem fontes remotas. Fontes PDF com codificação extraída permanecem autoritativas para os caracteres.
- A transação visual pertence aos guards do router, cobrindo links, navegação programática e Back/Forward. Registra até 24 cards/origens em memória, limpa por conta e retorna ao card da lista de origem, restaurando scroll antes de capturar o destino. A expansão tem movimento inverso no retorno. Cabeçalho/barra inferior usam camadas visuais próprias acima de conteúdo/capas; o fallback de expansão fica abaixo da barra fixa. Painéis mantêm o modal e o foco durante sua animação de saída e só depois fecham.
- Navegação inferior móvel usa direção da posição dos módulos. View Transitions é uma melhoria opcional; main tem identidade própria e a pílula inferior permanece viva. Cards/cover compartilham geometria com o detalhe; na ausência da API, Vue/Web Animations oferecem entrada horizontal/expansão. APIs ausentes, falhas e movimento reduzido preservam a navegação comum. Não se muda `/legacy` nem código Android.

## Alternativas e consequências

Inventar nomes pelo texto inicial de cada spine não representa o sumário autoral e ignora fragmentos. Remover frases iguais ao título apagaria conteúdo legítimo. Renderizar todos os capítulos juntos mudaria custo de memória, progresso e seleção; permanece o frame ativo com preparação limitada dos vizinhos.

A rolagem horizontal não passa mais uma tela vertical no modo por capítulo. Quem deseja telas discretas usa a opção de paginação. Novos controles exigem repaginação e preservação da âncora textual; não geram números absolutos de páginas EPUB.

Uma biblioteca externa de transições ou uma cópia manual permanente de telas aumentaria dependências/ciclos de vida. As APIs opcionais nativas e o fallback existente mantêm o core independente; aparelhos antigos podem ter uma apresentação mais simples. Para EPUB, uma troca direta é preferível a animar uma cópia que não reproduz o layout. O browser pode pular uma transição opcional sem mudar a navegação/progresso.

Pacotes offline já existentes conservam seu HTML/manifest. O usuário precisa atualizá-los para receber o TOC e a extração corrigidos. Remover caracteres indevidos de metadados pode deslocar offsets antigos: destaques com exact/context são resolvidos novamente; somente um offset antigo sem contexto não permite reparação universal garantida. Os EPUBs fonte não são alterados.

## Evidência local

Com o EPUB fornecido, a extração retornou 314 itens de spine e 261 entradas NCX. Na interface real, os primeiros destinos mostraram `15 de julho de 1955` e `16 de julho`; avançar em modo de rolagem mudou de capítulo. A paginação mostrou páginas da tela e a fonte alternativa foi aplicada no frame. Inspeção móvel em 390×844 confirmou controles e navegação de módulos em ambos os sentidos. Um capítulo de quatro telas tinha scrollWidth 1536px (múltiplo de 390 menos a margem de 24px); com o marcador passou a 1560px e a última posição chegou exatamente a 1170px.

Typecheck, lint e build são checagens separadas das suítes automatizadas. As expectativas existentes de rolagem foram adequadas aos novos comandos; nenhuma suíte de testes foi executada nesta alteração. Não houve commit, push, tag ou workflow.


### Revisão da apresentação

A revisão manual adicional em 390×844 percorreu abertura de um card do Início, retorno pelo link e pelo histórico, e avanço do EPUB paginado. A barra recebeu snapshot próprio acima das capas. O avanço registrou a fase `next` e não criou uma segunda árvore de texto do EPUB. Não foi executada suíte automatizada; as expectativas existentes foram adaptadas às capturas do compositor. Falhas/ausência da API preservam a troca direta.


### Correção de latência do ciclo de captura

View Transitions suspende a renderização enquanto seu callback de atualização está pendente. Aguardar `requestAnimationFrame` nesse callback, ou em uma conclusão de navegação da qual ele depende, cria uma espera circular até o timeout do navegador (cerca de cinco segundos no relato). A transação não aguarda frames de pintura.

O router restaura scroll após `nextTick`, de forma síncrona, e libera a captura nesse ponto. Destinos opcionais de morph que ainda não existem não acrescentam espera de rede no callback nativo. EPUB prepara imagem/fontes/layout do iframe oculto antes de iniciar a captura; dentro dela executa somente o commit do frame preparado ou a rolagem de uma tela. A vinculação final de eventos/restauração não espera rAF. PDF conserva a preparação/animação anterior fora de callbacks que suspendem desenho.

Diagnóstico manual local, com instrumentação temporária removida depois da coleta: transação de módulo 340ms; expansão de livro 352ms; passagem de tela EPUB 261ms, com outras duas em 275/269ms; troca completa ao capítulo seguinte 394ms (inclui acionamento/observação pela ferramenta). Leituras do ciclo via `performance.now()` e console público, sem suíte de testes. Esses números descrevem o dev local observado, não prometem latência de rede/dispositivo para todos os livros.


### Margens verticais

`marginTop` e `marginBottom` estendem as preferências tipográficas existentes (0–160px, defaults 80/96px). Uma segunda migração aditiva garante atualização também nos bancos de dev que já aplicaram a primeira migração tipográfica. Campos ausentes em clientes/pacotes anteriores recebem defaults ou preservam valores persistidos. O mesmo componente expõe ambos os controles em Leitura e Preferências; API, outbox, chave de preparação e CSS compartilham os valores. A altura útil de páginas EPUB desconta ambas as margens e limita padding em viewports curtos. Em rolagem, uma alteração no início do capítulo mantém scroll 0, permitindo que a nova margem superior apareça; nas demais posições preserva-se a âncora existente.


O envio destas alterações foi autorizado pelo usuário para a versão 0.8.0. As notas anteriores de ausência de commit/push descrevem a fase local de investigação; resultados de CI/publicação pertencem às execuções do GitHub Actions.

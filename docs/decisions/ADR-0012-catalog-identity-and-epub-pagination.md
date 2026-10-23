# ADR-0012 — Identidade do catálogo, páginas EPUB e âncoras de seleção

- Status: Accepted
- Date: 2026-10-23
- Supersedes: identificação por inode/amostras no ADR-0005; layout EPUB automático em duas colunas no ADR-0007.

## Contexto

Inodes são reutilizáveis. A capa anteriormente usava somente seu hash como nome e não era substituída quando o conteúdo mudava. Arquivos com erro podiam ser classificados como disponíveis no próximo scan só por tamanho/data. No leitor, `scrollIntoView` podia deslocar também os ancestrais do iframe; duas colunas verticais tornavam um avanço de tela ambíguo. Destaques salvos por frase/bloco não distinguem palavras repetidas no mesmo nó de texto.

## Decisão

O caminho existente identifica a substituição de uma edição. Um movimento para outro caminho só reaproveita o registro se o caminho anterior estiver ausente e o SHA-256 integral coincidir. O inode é um atributo de arquivo, nunca evidência suficiente de identidade de conteúdo. Colisões de inode ausente são aposentadas; hard links simultâneos recebem identidades distintas por caminho. Scans contabilizam registros encontrados, não apenas inodes. O hash é calculado em streaming, depois do limite de tamanho, sem alterar fontes. Fingerprints amostrados anteriores são atualizados no primeiro scan; um arquivo já ausente antes desse upgrade não pode ter seu conteúdo integral retroativamente comprovado para um rename.

Capas automáticas são identificadas pelo hash da imagem, com origem e fingerprint do livro persistidos. O upgrade agenda um job por biblioteca; jobs ativos são reaproveitados. O scan reextrai capas antigas ou de edições modificadas e preserva capas/metadados manuais. Catálogo expõe uma revisão opaca da capa, sem caminhos internos. URLs com a revisão atual podem usar cache privado por um dia; URLs antigas/sem revisão revalidam. Downloads offline continuam snapshots explícitos; capas online não são substituídas por um download antigo. Cache PDF preparado inclui device/inode/ctime além de caminho/tamanho/mtime para não reutilizar texto de um arquivo substituído.

EPUB moderno oferece `scroll` (padrão compatível) ou `paginated` em preferências persistidas/sincronizadas pela API/outbox existente. Payloads antigos que omitem a opção preservam a escolha. Rolagem usa uma coluna; paginação usa colunas CSS de altura delimitada em um viewport horizontal próprio. Cada avanço percorre uma página local antes de trocar de capítulo; voltar do início abre o final do capítulo anterior. Número de página é apresentação dependente de tela/fonte, nunca página absoluta EPUB nem chave de progresso. Capítulo, CFI/bloco e offset textual preservam semântica. Restauração atua diretamente no scroller correspondente, sem mover os ancestrais do iframe. Texto selecionado continua tendo prioridade sobre gestos/teclas de navegação.

Destaques novos serializam o `Range` ordenado no fluxo textual do capítulo/página: início, fim, texto exato, contexto e escopo (`epub`, `pdf-page`, `pdf-reflow`). A resolução valida posição/contexto e só recupera uma mudança de offsets com contexto único. Marcas e spans de estilo não alteram esse fluxo. Não usar `Node.normalize` em DOM pertencente ao Vue. Âncoras não são transferidas arbitrariamente entre PDF original/adaptado; locators continuam por formato/página. Destaques antigos sem offsets usam a melhor localização disponível, mas casos igualmente prováveis não são destacados na primeira ocorrência. Sem o Range original, a escolha perdida não é recuperável automaticamente.

## Alternativas e consequências

- Amostragem ou inode sozinhos custam menos I/O, mas não detectam mudanças centrais com tamanho/data preservados nem garantem posse da capa. Hash integral custa uma leitura adicional em cada scan e é limitado ao tamanho de livro configurado.
- Reescrever nomes de fontes ou embutir dados no EPUB violaria o contrato read-only. Capas/cache/preferências ficam no volume de dados.
- Páginas fixas calculadas uma vez por livro falham em rotação, acessibilidade e mudança de fonte. O layout usa CSS/DOM já suportados pelo cliente moderno; `/legacy` mantém seu fluxo conservador e os mesmos dados/API.
- Busca textual pelo primeiro resultado não distingue a seleção real. Offsets mais contexto preservam a intenção sem depender do número de linhas visuais ou de um motor nativo paralelo.
- Mudanças ficam restritas à web/backend; nenhum arquivo Android é alterado. Testes de browser não substituem validação física em dispositivos.

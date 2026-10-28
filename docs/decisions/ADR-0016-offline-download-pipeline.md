# ADR-0016 — Download offline com concorrência limitada e recursos compartilhados

Status: Accepted. Complementa ADR-0009 sem alterar os leitores, locators ou a publicação atômica dos pacotes.

## Contexto

O fluxo anterior transferia capítulos, páginas e recursos em série. URLs EPUB diferentes por capítulo duplicavam fontes, imagens e CSS do mesmo membro ZIP. Cada acesso relia OPF, navegação e capa, e procurava a entrada desde o começo do diretório ZIP. A confirmação IndexedDB desserializava novamente todos os binários. O shell público também era uma barreira anterior à transferência do livro. A UI mostrava a porcentagem do recurso atual como se fosse do livro inteiro.

## Decisão

- O cliente prepara até três capítulos/páginas por vez, com no máximo quatro requests de download ativos por aba, compartilhados entre livros. Requests em fila podem ser cancelados. Uma falha terminal interrompe os demais workers antes de descartar a geração temporária.
- Há até três tentativas por recurso para falhas de transporte, truncamento e HTTP transitório, com espera limitada e respeito a `Retry-After` até cinco segundos. Requests interrompidos pelo usuário, 401/403/404, falhas de quota e dados inválidos não são repetidos. Inatividade de rede tem limite de 30 segundos; preparação completa de PDF admite 120 segundos. Receber bytes renova o prazo.
- O shell começa em paralelo ao livro, mas ambos precisam terminar antes da publicação. Sua conferência enumera as chaves do cache uma vez, em vez de consultar cada recurso separadamente. Continua reparando entradas ausentes e respeitando a atualização voluntária do aplicativo.
- EPUBs compartilham o índice de entradas ZIP e informações de leitura por identidade real do arquivo (device, inode, tamanho, mtime e ctime). Há no máximo oito entradas por cache; índices somam até 16 MiB estimados. Nenhum descritor fica aberto entre requests. Leitura não extrai a capa novamente. Alterações do arquivo invalidam o cache; a sanitização de HTML/CSS/SVG e a autorização por request permanecem obrigatórias.
- O diretório ZIP é percorrido uma vez por revisão, com limite de 50.000 entradas. Leituras usam os offsets das entradas indexadas, preservando a primeira ocorrência de nomes repetidos e os limites de descompressão existentes.
- O downloader identifica o membro EPUB resolvido no ZIP. Cada binário é transferido e salvo uma vez por geração; as demais URLs de capítulo recebem aliases restritos ao mesmo livro e geração. A leitura resolve esses aliases no IndexedDB, com limite e detecção de ciclos. Registros antigos continuam legíveis, sem migração destrutiva ou alteração do formato de seus locators.
- A finalização verifica as chaves em lote e lê somente os quatro snapshots pessoais necessários. Não materializa todo o livro novamente. Promises retidas no downloader guardam conclusão, não todos os Blobs do pacote.
- Para PDF, `pdf/reflow?page=1&prepare=all` prepara derivados ausentes em uma única abertura do documento e reutiliza o cache existente. O parâmetro de preparação não participa da identidade offline da página. Original, páginas adaptadas, imagens e fontes continuam obrigatórios; não anunciar download completo sem um dos modos.
- O detalhe do livro expõe um `downloadRevision` adicional com stat completo, conferido antes de publicar. `fileRevision` e os identificadores de edição já usados pelo catálogo permanecem compatíveis. Servidores anteriores usam a conferência por `fileRevision`.
- A UI apresenta preparação, transferência e conferência, capítulos/páginas concluídos e bytes realmente recebidos. O progresso não reinicia por recurso nem anuncia disponibilidade antes do commit. Cancelar continua disponível; uma atualização interrompida preserva a cópia anterior.

## Alternativas e limites

Um novo arquivo ZIP/pacote proprietário e extração bruta no navegador foram descartados: duplicariam protocolo, memória e fronteiras de sanitização. Concorrência irrestrita sobrecarregaria o servidor e dispositivos móveis. Remover derivados PDF reduziria a duração mas quebraria o contrato offline do modo adaptado.

Não há retomada persistente de gerações incompletas depois de fechar a aba: uma falha terminal descarta a preparação; as retentativas por recurso acontecem antes disso. Uma primeira preparação de PDF antigo ainda pode custar tempo de CPU. A confirmação do shell e a quota real do navegador continuam sendo condições para disponibilidade offline.

As alterações não modificam livros fonte nem adicionam download ao cliente `/legacy`. Não alteram o Android nativo.

# Extração de conteúdo e sumário EPUB

## Diagnóstico do arquivo fornecido

Inspeção local em 2026-10-27 do EPUB de **Quarto de despejo**, fornecido pelo usuário, sem alterar o arquivo:

- O `content.opf` declara **314 arquivos no spine**; o `toc.ncx` possui **261 entradas** com as datas reais do diário.
- Os primeiros arquivos de texto examinados contêm o nome do livro em `head/title`. Nos mesmos arquivos, não há `h1`–`h3` correspondentes a esse título dentro do corpo.
- O leitor sanitizava o documento completo. Ao descartar `head`/`title` sem classificá-los como conteúdo não textual, o sanitizador podia conservar o texto dos metadados como prosa. Isso explica o título repetido nesse arquivo; não justifica remover títulos autorais que pertençam ao corpo.
- A extração anterior gerava `Capítulo N` diretamente da posição do spine e não consultava o NCX.

A chamada diagnóstica direta da extração atual retornou 314 capítulos e 261 entradas de navegação. Os primeiros rótulos são as datas do arquivo, incluindo **15 de julho de 1955** e **16 de julho**. A leitura sanitizada de `index_split_001.html` preservou a data do diário e deixou de conter o título vindo dos metadados. Não foi usado runner de testes nem iniciado servidor para essa inspeção.

## Conteúdo do capítulo

O passe de conteúdo descarta integralmente `head` e `title`, além dos elementos não textuais já descartados. A coleta/sanitização de CSS permanece em um passe separado. Headings, datas, títulos e demais elementos reais do corpo continuam sujeitos à mesma allowlist; nenhum título é removido por comparar sua frase com o título do livro.

## Contrato de navegação

`EpubInfo` mantém `chapters` com os mesmos `id`, `href` e ordem do spine. Seu rótulo usa a primeira entrada válida do sumário para aquele arquivo, conservando `Capítulo N` quando não há rótulo autoral.

A propriedade aditiva `navigation` representa o sumário autoral, separadamente do spine:

```ts
Array<{
  id: string
  label: string
  depth: number
  href?: string
  chapterHref?: string
}>
```

- `href` contém o href exato do capítulo, seguido pelo fragmento quando existente.
- `chapterHref` contém somente o href exato presente em `chapters`.
- `depth` preserva a hierarquia; itens sem destino são rótulos de grupo, sem ação de navegação.
- A ordem segue o sumário autoral. Ela não redefine a ordem de leitura, locators ou progresso do spine.
- EPUB 3 usa o `nav` com tipo `toc`/role `doc-toc`; EPUB 2 usa o NCX referenciado pelo OPF ou identificado pelo media type. Nav ausente/inválido pode usar NCX; sem navegação utilizável, retorna `[]` e os capítulos continuam legíveis.
- Destinos externos, inválidos e fora do spine não se tornam links do leitor. Recursos são resolvidos exclusivamente dentro do ZIP, pela mesma validação de caminhos da leitura.
- A leitura de cada documento de sumário é limitada a 1 MiB, com até 2.048 itens e 16 níveis de navegação. Os rótulos têm no máximo 512 caracteres. Falhas opcionais não impedem a ingestão/leitura do livro.

O endpoint do manifest e o cliente devem transportar essa propriedade adicional, usando `chapters` como fallback para clientes/pacotes anteriores. Este documento descreve o produtor; a integração de interface usa o contrato acima.

## Compatibilidade e limites

Pacotes offline já salvos conservam o HTML e o manifest antigos. Atualizar/salvar novamente o livro é necessário para obter o corpo corrigido e o sumário autoral. Não se altera o EPUB fonte nem se reescreve silenciosamente o pacote existente.

A remoção do texto indevido do `head` também remove esses caracteres do fluxo textual que leitores antigos podiam ter contado. Destaques com texto/contexto podem ser recuperados pelo resolvedor existente; um progresso antigo que possui somente offset não fornece contexto suficiente para provar uma correção universal. O índice de bloco continua preservado, mas a retomada de offsets antigos precisa ser avaliada no leitor.

A inspeção real confirmou o caminho NCX e o título de metadados desse arquivo. O caminho EPUB 3, grupos, fragmentos e documentos malformados receberam revisão estática; não foi executada suíte automatizada nesta alteração. Nenhum commit, push, tag ou workflow foi realizado.


## Integração manual do leitor

Depois do diagnóstico direto, o dev local foi iniciado para inspecionar o caminho real de upload/manifest/leitura. O livro apareceu no catálogo local, sem modificar o arquivo fornecido. O sumário mostrou as datas reais, a troca de capítulo em rolagem abriu `16 de julho`, e a seleção de fonte Literária foi aplicada ao frame. A paginação e os controles também foram inspecionados em viewport de 390×844.

O overflow multicoluna omitia a margem final: quatro telas de 390px produziam 1536px de extensão com margem de 24px. Um marcador CSS não textual passou a completar 1560px, permitindo chegar exatamente a 1170px na última tela. A contagem usa o conteúdo, não o viewport estendido, e é refeita antes de restaurar após layout.

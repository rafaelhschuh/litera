# Leitor EPUB — correções para 0.7.1

## Relato e limite da investigação

Ao avançar, a leitura voltava aproximadamente duas páginas e repetia o percurso. Havia um parágrafo destacado. A inspeção identificou os problemas abaixo, mas não reproduziu esse incidente com o livro/dispositivo do usuário; a relação causal com o destaque continua sem confirmação.

## Problemas corrigidos

1. **Âncora incompleta em rolagem.** A captura guardava somente o índice de um bloco e um deslocamento em pixels, mesmo quando o bloco abrangia várias telas. Agora os dois modos capturam o primeiro caractere visível e sua coordenada vertical. O campo opcional `textOffsetY` preserva a posição desse caractere após relayout, sem reaplicar o afastamento fixo de 80 px a cada restauração. Locators anteriores continuam aceitos; destaques mantêm a aproximação própria de abertura.
2. **Ausência de texto confundida com início.** A busca retornava `0` quando não encontrava texto, incluindo telas com figuras. Agora retorna ausência de âncora, permitindo restaurar pelo elemento. O offset zero continua representando somente o começo real do texto. Se não houver texto nem elemento visível (página editorial branca), preserva a última âncora válida sem publicar uma localização inventada.
3. **Elemento de coluna anterior.** A captura avaliava apenas a coordenada vertical do bloco. Agora verifica fragmentos realmente visíveis nos dois eixos e prefere o elemento visível mais específico, evitando um ancestral que abrange várias telas.
4. **Callback de layout obsoleto.** A geração era validada depois de restaurar o EPUB. Agora o timer e o frame validam geração/desmontagem antes de tocar posição, estado de layout ou navegação pendente. Eventos de scroll/seleção também descartam documentos antigos; a captura de scroll permanece imediata para preservar a gravação durável de progresso.
5. **Seleção durante relayout.** Pular a restauração enquanto havia uma seleção descartava a necessidade de restaurar. Agora a âncora anterior fica preservada e é restaurada quando a seleção termina, sem mover os handles durante a seleção.
6. **Mudança do DOM ao destacar.** Limpar a seleção e envolver nós de texto podia alterar a quebra de linhas antes de capturar novamente a posição. O salvamento captura o documento atual depois da resposta e antes de limpar a seleção; a aplicação de marcas restaura essa âncora. Mudanças de capítulo durante o request não reutilizam um documento antigo.
7. **Snapshot em contexto diferente.** A apresentação substituía `body` por `div` e recalculava medidas relativas no viewport externo. Agora conserva `html`/`body`, fixa métricas dos poucos containers e da tipografia no iframe e usa suas dimensões na restrição de figuras. Fontes já carregadas são registradas apenas durante a apresentação e removidas ao descartá-la; falha nessa preparação usa troca direta. O conteúdo vivo continua sem transformação.
8. **Busca por caractere custosa.** Um nó de texto longo exigia inspecionar cada caractere anterior ao trecho visível. A captura procura o primeiro prefixo visível por busca binária e valida o caractere encontrado.
9. **Resize que retorna ao tamanho inicial.** O retorno às dimensões anteriores podia ser ignorado enquanto ainda havia um callback para um tamanho intermediário. Agora esse retorno também invalida e substitui o callback pendente.
10. **Navegação indevida enfileirada durante seleção/painel.** O leitor enfileirava o comando antes de verificar seleção, painel, carregamento e gesto de zoom/pan. Agora essas condições são verificadas primeiro, impedindo que um comando bloqueado vire uma troca atrasada de página após a seleção terminar.

## Compatibilidade

`textOffsetY` é aditivo ao locator EPUB e acompanha sua serialização existente na API/outbox; `normalizeProgress` EPUB preserva os campos opcionais. Não muda a semântica de PDF, âncoras de destaque ou downloads offline, nem introduz leitura absoluta por número de página. `/legacy` ignora o campo adicional e conserva seu fluxo. Nenhum arquivo Android foi alterado.

## Verificação desta alteração

O primeiro CI da tag `v0.7.1` passou 203 de 204 testes e reprovou o contrato de captura imediata de progresso (`tests/book-source.test.ts`). A publicação foi bloqueada. A correção posterior remove o adiamento por frame, mantendo os guards de documento ativo/desmontagem; o teste permanece inalterado.

O usuário autorizou expressamente recriar `v0.7.1` com essa correção, pois a imagem e a GitHub Release não haviam sido publicadas. Trata-se de uma exceção autorizada à preservação de tags; o envio usa lease sobre o objeto remoto anterior para não sobrescrever alterações concorrentes.

- Inspeção estática, `npm run typecheck`, ESLint dos arquivos alterados e `git diff --check`: aprovados após a revisão final.
- `npm run build`: build web de produção e compilação do servidor concluídos.
- O caso E2E existente de retomada EPUB foi atualizado para exigir o mesmo caractere e coordenada vertical após reload, em vez do antigo bloco escolhido pelo limiar de 48 px. Sua execução fica no CI da versão.
- Nenhum teste automatizado ou servidor foi iniciado nesta investigação.
- A investigação e a implementação foram locais, sem commit, push, tag ou workflow nessa etapa. O envio da 0.7.1 foi autorizado posteriormente pelo usuário; os resultados remotos pertencem às execuções correspondentes no GitHub Actions.

Continua pendente a reprodução do incidente original e a confirmação em navegador/dispositivo: avanços repetidos nos dois modos, seleção/destaque antes e durante mudanças do viewport, figuras sem texto, parágrafos longos, retorno de capítulos, fontes editoriais, movimento reduzido e retomada offline. Esta nota não declara esse relato resolvido nem substitui esses gates de aceitação.

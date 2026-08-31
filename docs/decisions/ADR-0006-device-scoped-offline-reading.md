# ADR-0006 — Leitura offline explícita e isolada por conta/dispositivo

## Status

Accepted

## Context

O Litera deve permitir que uma pessoa prepare livros específicos para leitura sem rede, dentro do aplicativo instalado, sem transformar o produto inteiro em um sistema offline-first nem oferecer um download bruto de EPUB/PDF. Respostas de conteúdo são privadas e a mesma instalação pode atender contas diferentes.

## Decision

- O cliente moderno usa Service Worker e Cache Storage como aprimoramento opcional. Ausência dessas APIs não impede os fluxos online e não altera o `/legacy`.
- Assets do frontend já visitados usam cache de runtime. A página de um livro oferece uma ação explícita para preparar o reader e salvar aquele livro no dispositivo.
- Conteúdo privado fica em caches nomeados por `userId` e `bookId`. O worker só consulta esses caches depois que o frontend identifica a conta ativa a partir de uma sessão online válida ou da última sessão local do app.
- EPUB é armazenado como manifesto, capítulos sanitizados na configuração de leitura vigente e seus recursos referenciados. PDF é armazenado internamente como resposta protegida do endpoint de conteúdo; o worker produz respostas byte-range a partir dessa cópia para o PDF.js.
- Logout, sessão rejeitada pelo servidor e remoção manual apagam os caches correspondentes. Uma resposta online `401`, `403` ou `404` também invalida o livro salvo.
- A sessão local permite abrir conteúdo já salvo quando a verificação do servidor falha por ausência de rede. Ela não substitui autenticação online, não contém senha/token e é removida no logout.
- Progresso produzido sem rede entra em uma fila local particionada por conta/livro. O cliente restaura essa posição offline e tenta reenviá-la quando recebe o evento `online`, preservando o contrato de revisão/conflito do servidor.

## Consequences

- O arquivo não aparece na pasta de downloads nem recebe UI de exportação, mas Cache Storage não é DRM: uma pessoa com controle do dispositivo e ferramentas de desenvolvimento pode inspecionar dados locais.
- Preferências e posição existentes no momento do salvamento abrem offline. O servidor continua sendo a autoridade do progresso: a fila local é apenas transporte pendente e respeita a resolução de revisão/conflito ao reconectar.
- Alterar a tipografia do EPUB enquanto offline pode exigir reconexão para regenerar capítulos nessa combinação. Salvar novamente atualiza o pacote.
- Revogação remota não pode alcançar um dispositivo desconectado; ela é aplicada na próxima resposta online. Esse é o mesmo limite físico de qualquer mídia offline.
- O `/legacy` permanece sem cache offline deliberadamente, preservando seu baseline conservador.

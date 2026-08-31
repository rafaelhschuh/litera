# ADR-0005 — Jobs persistentes, identidade de arquivo e conflitos de progresso na Beta

## Status

Accepted

## Context

O inode usado no MVP é eficiente, mas não sobrevive a cópia seguida de remoção, troca de filesystem ou alguns movimentos. Scans síncronos também não permitem recuperação/diagnóstico operacional. Em paralelo, updates concorrentes de progresso podiam sobrescrever uma posição mais nova silenciosamente.

## Decision

- `book_files.identity` continua usando `device:inode` como fast path. A Beta acrescenta `fingerprint`: SHA-256 do tamanho e de amostras de 64 KiB do início/fim. Quando inode/caminho mudam e o arquivo anterior não existe mais, o fingerprint reconcilia o mesmo `BookFile`. Cópias simultâneas continuam sendo arquivos distintos.
- O fingerprint amostrado evita reler integralmente livros grandes a cada scan. O risco residual de colisão é mitigado por SHA-256, tamanho e pela exigência de que o caminho anterior esteja ausente. O scanner nunca modifica a fonte.
- Scans são registrados em `scan_jobs` com `queued/running/completed/failed/cancelled`, duas tentativas limitadas, relatório persistente e recuperação de `running` para `queued` após restart. Apenas um job ativo por library é aceito. O endpoint síncrono do MVP permanece compatível; a UI Beta usa `?async=true`.
- `ReadingProgress.revision` é optimistic concurrency control. Clientes Beta enviam a revisão lida; divergência retorna `409 STALE_PROGRESS` e preserva a posição já persistida. Clientes MVP sem revisão continuam aceitos para compatibilidade, enquanto modern e legacy Beta enviam revisão.
- `progressRatio >= 0.98` marca conclusão quando o cliente não declara outro valor. Conclusão remove o item de Continue Reading; reabrir incrementa revisão e volta a exibi-lo. Remover da seção não apaga o locator.

## Consequences

- Rename/move comum não duplica o catálogo nem perde progresso.
- Jobs e falhas sobrevivem a restart e são observáveis no Admin.
- Updates stale nunca fazem o progresso retroceder silenciosamente nos clientes Beta.
- Um fingerprint amostrado não é um hash criptográfico integral do livro e não deve ser usado como prova de conteúdo ou deduplicação global.

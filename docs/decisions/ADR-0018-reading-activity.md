# ADR-0018 — Atividade de leitura privada e sincronizável

Status: Accepted (preparação local 0.9.0).

## Contexto

O resumo por contagem de livros não descreve o hábito diário. A proposta visual foi substituída por uma linha de sete dias na Home e um painel de detalhes. Progresso EPUB/PDF não permite deduzir tempo: reler, saltar capítulos e alterar paginação tornam essa inferência incorreta.

## Decisão

- Medir uma estimativa de tempo ativo no leitor moderno EPUB/PDF. Exigir conteúdo pronto, documento visível e com foco; pausar durante painéis, carregamento/layout, segundo plano ou dois minutos sem interação confiável. O intervalo de amostragem é cinco segundos, com descarte de suspensão e saltos do relógio. Não é medição de atenção ou acompanhamento dos olhos.
- Acumular pequenos intervalos e persistir em torno de quinze segundos, também ao pausar/sair. Cada evento leva UUID permanente, sessão, livro, início/fim UTC, segundos inteiros, dia local e fuso IANA. Dividir na meia-noite local; manter o dia em que a leitura ocorreu ao viajar. Uma sessão termina ao pausar/perder elegibilidade. Amostragem e encerramento abrupto podem perder os últimos segundos; tempo é sempre apresentado como estimado.
- Reutilizar a outbox isolada por conta. Amostras rotineiras de tempo sincronizam silenciosamente online; offline, falhas e reautenticação mantêm o feedback global existente. Eventos não substituem operações anteriores; retries preservam corpo e ID. Uma lease IndexedDB por perfil evita contar duas abas simultâneas; servidor une intervalos sobrepostos de uma mesma data, inclusive entre dispositivos. Totais individuais por livro podem somar mais que o total global se dispositivos lerem livros diferentes simultaneamente.
- Migração aditiva cria eventos privados com chave `(user_id,event_id)` e índice por usuário/dia/livro. O ID persiste além da compactação dos recibos de sincronização; reutilizar o ID com outro conteúdo é conflito. Validar UUID, fuso, datas, duração limitada e autorização existente do livro. Não alterar locators, conclusão, fontes de livros ou `/legacy`.
- Consultar até 366 dias por vez, com listas de IDs limitadas, somente para a conta autenticada e livros disponíveis em acervos autorizados. Agrupar eventos uma vez por data/livro e unir seus intervalos. Destaques são contados pela data de criação, convertida ao fuso atual da consulta. Dias de leitura mantêm o fuso original de cada evento.
- Guardar o último resumo por fuso no contexto local da conta. Consultas confirmam IDs conhecidos antes de compactar eventos locais já reconhecidos. Em perda de ACK, IDs presentes no resumo não são somados novamente. Offline mostra resumo salvo mais intervalos locais provisórios; sobreposições com eventos remotos e destaques pendentes só ficam canônicos após sincronização e nova consulta.
- Home mostra apenas sete dias; Detalhes oferece dia/semana/mês, calendário de 182 dias, sessões, livros, destaques e comparação quando houver cobertura anterior. Zero significa ausência de atividade registrada, não ausência comprovada de leitura. Não há dados ilustrativos nem reconstrução retroativa.
- Capacidades de armazenamento e criptografia do navegador são opcionais; falhas na medição não podem impedir leitura. Sem IndexedDB, o transporte online existente pode confirmar eventos diretamente, mas não há garantia offline. Logout segue a limpeza local existente; eventos confirmados permanecem na conta do servidor.

## Alternativas e consequências

Deduzir minutos de percentuais, contar a duração total da aba e manter um contador mutável foram rejeitados: produzem números enganosos ou duplicação em retries. Telemetria de terceiros é desnecessária; os dados ficam no servidor da instalação.

Eventos imutáveis aumentam o banco (aproximadamente 240 registros por hora ativa). Não há poda automática nesta versão: remover IDs antigos permitiria reaplicação de retries. Backups devem incluir essa tabela. Uma futura política de retenção precisará preservar idempotência e agregados. O tempo é uma estimativa pessoal, não serve como auditoria ou competição. A disponibilidade do leitor sempre tem precedência sobre a estatística.

## Verificação nesta preparação

Checagens estáticas e build locais; revisão visual do resumo/diálogo em 390px e da faixa em 320px. Em cópia isolada do banco, leitura pelo navegador produziu eventos aceitos pela API e tempo/livro/sessões no resumo e diálogo. Não se declara validação física de Safari/PWA ou cobertura automatizada nova nesta etapa. Gates de atividade incluem foco/inatividade, meia-noite, conta/autorização, retries com ACK perdido, sobreposição e reconexão, sem alterar restauração de progresso por formato.

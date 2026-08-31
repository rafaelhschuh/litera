# Privacy and Operations — Beta

Litera não envia telemetria. Usuário, nome exibido, hash de senha, sessões, libraries liberadas, favoritos, preferências, histórico e locators de leitura ficam no SQLite do volume de dados local.

Open Library é opcional. Quando habilitada, recebe apenas título, autor e identificador necessários ao matching, além do email de contato configurado no `User-Agent`. Respostas ficam em cache por 7 dias. Conteúdo do livro, progresso, usuário e senha nunca são enviados.

Desativar um usuário revoga todas as sessões imediatamente, preservando progresso para eventual reativação. Excluir definitivamente dados de uma conta ainda exige operação administrativa no SQLite e não faz parte da UI Beta; faça backup antes e remova a linha de `users` em janela de manutenção — as relações privadas usam `ON DELETE CASCADE`. Esta limitação é P2 e deve ser resolvida antes de declarar exclusão self-service.

Logs são JSON estruturado com request/correlation id, método, path, status, duração e id numérico do usuário autenticado. Não registram senha, token, conteúdo de livro nem payload de provider. Erros retornam um id derivado sem imprimir a mensagem potencialmente sensível.

No shutdown, novas conexões são recusadas e scans têm até 10 segundos para concluir. Jobs ainda ativos retornam a `queued` e são recuperados no próximo start. SQLite usa WAL e foreign keys.

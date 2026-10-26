# ADR-0014 — CI único e promoção de imagem aprovada

Status: Accepted

CI concentra validação e publicação da imagem por SHA. Suítes independentes executam em paralelo em imagem oficial Playwright compatível com o lockfile, evitando instalações apt lentas. PR mantém build Docker sem credenciais de publicação; main publica somente depois dos gates, com cache BuildKit.

O setup de Actions e `npm ci` permanecem como root no container. Antes das validações, o workspace é transferido para `pwuser` e todos os comandos da aplicação executam com esse usuário sem privilégios. Executar as suítes como root invalida testes reais de permissões de filesystem, pois root consegue escrever mesmo após `chmod 0555`; não devemos enfraquecer nem ignorar esses testes para acomodar o CI.

Release exige CI aprovado em main para o mesmo commit e promove o digest existente para tags semânticas, sem rebuild nem repetição dos testes. A versão completa não pode mudar de digest; retentativas usam a tag Git original. Isso substitui CI + Container + Release com builds/validações repetidos. A aprovação integral do workflow CI é pré-requisito, não apenas um job isolado.

Para pushes simultâneos de main/tag, a espera pela aprovação tem teto de 40 minutos, superior à soma dos limites dos jobs de validação, verificação e publicação. A espera termina imediatamente quando o CI aprova ou quando todas as execuções desse commit concluem sem sucesso.

Android mantém seus gates, mas só alterações nativas ou disparo manual os executam. Tags e mudanças web não produzem APKs. Configuração dos workflows é validada com actionlint. O contrato de execução/retentativa está em `docs/development/git-and-ci.md`.

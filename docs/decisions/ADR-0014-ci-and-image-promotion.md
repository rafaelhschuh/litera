# ADR-0014 — CI único e promoção de imagem aprovada

Status: Accepted

CI concentra validação e publicação da imagem por SHA. Suítes independentes executam em paralelo em imagem oficial Playwright compatível com o lockfile, evitando instalações apt lentas. PR mantém build Docker sem credenciais de publicação; main publica somente depois dos gates, com cache BuildKit.

Release exige CI aprovado em main para o mesmo commit e promove o digest existente para tags semânticas, sem rebuild nem repetição dos testes. A versão completa não pode mudar de digest; retentativas usam a tag Git original. Isso substitui CI + Container + Release com builds/validações repetidos. A aprovação integral do workflow CI é pré-requisito, não apenas um job isolado.

Android mantém seus gates, mas só alterações nativas ou disparo manual os executam. Tags e mudanças web não produzem APKs. Configuração dos workflows é validada com actionlint. O contrato de execução/retentativa está em `docs/development/git-and-ci.md`.

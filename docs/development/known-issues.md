# Known Issues — Beta

Não há bug P0/P1 conhecido no core flow ao concluir o gate Beta. Os itens abaixo são P2 conhecidos e não impedem catálogo ou leitura no cliente moderno.

| ID | Limitação / reprodução | Comportamento e mitigação |
|---|---|---|
| BETA-P2-001 | Ative `/legacy`, abra o detalhe de um PDF e tente iniciar a leitura. | PDF é informado como indisponível no cliente legacy. Use o reader moderno; a decisão e o baseline estão no ADR-0003 e na matriz de compatibilidade. |
| BETA-P2-002 | Execute o checklist de `/legacy` em um aparelho físico iOS 10.x. | O código foi mantido conservador e o core passou no browser local, mas o modelo/versão físico exato ainda não foi certificado. Registre aparelho, versão, etapa e screenshot conforme a matriz de compatibilidade. |
| BETA-P2-003 | Abra um PDF com muitas páginas, escolha **Buscar** e procure uma expressão próxima do fim. | A busca extrai texto página a página e pode demorar. Abertura, zoom e navegação permanecem disponíveis; para documentos muito grandes, prefira a busca do arquivo no desktop. |
| BETA-P2-004 | Em **Administração → Usuários**, abra uma conta existente. | A Beta oferece desativação imediata com revogação de sessões, mas não exclusão definitiva na UI. O procedimento de retenção/exclusão administrativa está documentado em `docs/security/privacy-and-operations.md`. |
| BETA-P2-005 | Inicie vários scans de libraries diferentes em uma máquina pequena. | Jobs são persistentes, porém executam no processo Node sem pool multiprocesso. Reduza a simultaneidade operacional e acompanhe **Administração → Jobs**; restart recupera jobs interrompidos. |


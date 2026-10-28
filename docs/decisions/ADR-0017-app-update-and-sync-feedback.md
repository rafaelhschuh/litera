# ADR-0017 — Detecção de atualização e retomada automática da sincronização

Status: Accepted. Complementa ADR-0009; mantém publicação voluntária do shell, fila persistente e locators por formato.

## Contexto

Uma instalação já registrada podia abrir sem chamar `registration.update()`. Uma aba mantida aberta dependia de eventos de retorno para procurar versões novas. O aviso aguardava o shell completo, mas era apresentado como texto sem hierarquia dentro do catálogo. A fila tinha startup, foreground e retry, porém podia perder um pedido de execução recebido no final de um drain e não tinha um watchdog independente dos eventos de conexão. Rejeições terminais não eram reidratadas no feedback após reabrir.

## Decisão

- Verificar o Service Worker na abertura, retorno à aba/janela, `pageshow` e reconexão; verificar também a cada 60 segundos enquanto visível e conectado. Coalescer verificações concorrentes, limitar eventos normais a uma por 30 segundos e limitar a espera da consulta a 30 segundos. O servidor entrega `sw.js` com `Cache-Control: no-store`. A instalação ainda precisa concluir todos os recursos do shell antes de oferecer a versão.
- Usar um único `UiDialog` global para a atualização, com **Atualizar agora**, **Depois**, progresso e retry contextual. Oferecer cada worker uma vez por sessão da página; Preferências permite conferir/reabrir a oferta. Adiar durante a leitura ou outro diálogo aberto. Não aplicar enquanto um livro estiver sendo baixado. Somente aceitação explícita envia `skipWaiting`, e somente a aba que aceitou recarrega.
- Os avisos globais de conexão/sincronização usam um indicador expansível fixo, derivado dos tokens de superfície, borda e sombra existentes. No celular, ele fica acima da navegação inferior. O estado normal não ocupa espaço. Detalhes e ações ficam no painel; não inserir frases soltas acima do título. O reader mantém seus controles/avisos existentes.
- A fila continua persistindo antes de enviar, com recibo idempotente, revisão e lease por operação. Além de startup, mutation e reconexão, retomar em foco, `pageshow`, foreground e wakeup entre abas. O wakeup usa apenas um token via evento `storage`; não envia livros, credenciais ou estado pessoal. Com storage indisponível, os outros gatilhos permanecem.
- Um watchdog de 30 segundos verifica pendências ou servidor indisponível enquanto o app está visível e a rede do navegador permite. O backoff e leases continuam sendo respeitados. Pedidos recebidos durante um drain geram nova passagem ao terminar; não perdem a execução. Cabeças de fila para agendamento seguem a mesma regra de rejeições terminais da seleção de operações.
- Reidratar contagem/erro de operações recusadas. Falhas transitórias repetem automaticamente; rejeições definitivas só repetem pela ação explícita. Conflitos preservam a decisão existente de usar a posição do servidor. Sessão rejeitada suspende o envio; a ação de entrar novamente oculta o contexto sem apagar downloads nem a fila. Autenticar a mesma conta retoma o envio.

## Alternativas e limites

Reload automático foi rejeitado por interromper leitura e formulários. Consultar em toda navegação geraria requests desnecessários; depender apenas de `online` não detecta retorno do servidor quando o dispositivo nunca perdeu a rede. Background Sync não é requisito por compatibilidade com WebKit. Não prometemos executar JavaScript com o navegador encerrado ou suspenso pelo sistema; a fila retoma ao abrir/voltar. Não resolvemos conflito escolhendo o maior percentual.

O `/legacy` permanece online e conservador. Não há alteração do host Android, arquivos de livros, esquema de progresso ou publicação de release.

## Verificação

Testes direcionados cobrem verificação em registro existente, polling visível, suspensão em background, coalescência, atualização voluntária e recuperação da fila sem evento `online`/por `pageshow`, além das regressões de recibos, ordem, conflitos e isolamento. Validação em Safari/PWA físico continua distinta dos testes Chromium e do build local.

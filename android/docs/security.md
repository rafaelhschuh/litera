# Segurança Android

O cliente herda o [threat model](../../docs/security/threat-model.md), [privacidade](../../docs/security/privacy-and-operations.md) e [ADR-0010](../../docs/decisions/ADR-0010-native-android-client.md). Livros, metadados, URLs e respostas HTTP são entradas não confiáveis.

## Origem e transporte

Aceitar origem HTTP(S) normalizada com host/porta válidos; rejeitar credenciais, caminho de instalação, query, fragmento e schemes arbitrários. Comparar esquema, host e porta efetiva, nunca prefixos de strings. HTTPS é padrão; HTTP exige consentimento explícito e expõe sessão/livros à rede.

O manifest permite cleartext para servidores configuráveis; é concessão global do transporte, não allowlist dinâmica garantida pelo Android. O repositório de rede aplica a fronteira da origem selecionada. TLS inválido sempre falha: não usar TrustManager permissivo, bypass de hostname ou confiança global em certificado inválido. Não encaminhar cookie em redirects entre origens; não seguir caminhos recebidos como se fossem URLs confiáveis.

## Sessão e arquivos

A autenticação usa os endpoints existentes e autorização real no servidor. A senha não é persistida. Sessão privada por origem é cifrada com chave não exportável do Android Keystore; cookies/tokens nunca entram em logs, intents, relatórios, preferências em claro ou renderers. Falha ao decifrar exige autenticação novamente, sem fallback em claro. Sessão do Chrome/PWA não é importada/exportada.

Armazenamento de publicações é privado e delimitado por origem canônica, conta, livro e revisão; nomes não podem virar caminhos arbitrários. Downloads parciais não são promovidos a cache completo. Outra conta/origem não pode abrir conteúdo privado anterior. Logout remove acesso e trata pendências explicitamente; revogação remota só é observada após reconexão. Backup Android permanece desabilitado. O manifest final também contém as permissões normais ACCESS_NETWORK_STATE e WAKE_LOCK trazidas pelas dependências AndroidX/Readium; não há permissão de notificações, câmera ou armazenamento amplo. O cliente não agenda worker de sincronização e manter tela acesa usa somente a flag da janela em leitura foreground.

## Engines e links

Readium interpreta a publicação EPUB local; PdfRenderer interpreta o PDF local. Engines não recebem a sessão da API ou uma bridge com privilégios. Conteúdo EPUB não deve navegar o aplicativo para o site, lançar intents, executar operações nativas ou acessar arquivos externos à publicação. Preservar as proteções de conteúdo e servidor local do toolkit; novas capacidades exigem revisão deste contrato.

O adapter atual bloqueia links externos da publicação com explicação; não existe abertura automática de navegador. Uma futura ação para links HTTP(S) só pode abrir após gesto e validação, sem credenciais na URL. Rejeitar javascript, intent, file, content e schemes arbitrários. Intents de entrada não mudam origem nem autenticam conta. Não conceder câmera, microfone, localização ou armazenamento amplo para ler livros; downloads ficam no espaço privado.

## Cópia de segurança EPUB e versão da engine

Readium 3.2.0 precisa de JavaScript próprio para paginação. O adapter não desliga esse mecanismo: prepara outra cópia privada do arquivo, removendo scripts/eventos/embeds/forms, neutralizando arquivos `.js`/`.mjs` da publicação e adicionando CSP a documentos declarados no manifest mesmo sem extensão. Mantém texto, imagens, estilos e arquivos locais; publica somente após terminar. Há limites de entradas, tamanho por recurso e total descompactado; não extrai nomes arbitrários para o filesystem.

A versão fixa usa os hosts sintéticos `readium_package` e `readium_assets`. CSP rejeita fontes com underscore no host: a política permite somente os dois caminhos de script Readium por fonte HTTPS com host wildcard. Arquivos JavaScript correspondentes dentro do livro são neutralizados. A política continua bloqueando script inline/eventos, conexões, frames, objetos e formulários; o HttpClient da engine recusa **todo** recurso de rede, inclusive outro host com aqueles caminhos. Recursos sintéticos da própria engine continuam locais. Nenhum cookie OkHttp é entregue ao renderer. A segurança depende desse conjunto, nunca de uma fonte CSP isolada.

Atualizar Readium exige verificar caminhos/injeção, reexecutar sanitização/CSP e abrir publicações reais na instrumentação. A cópia é uma transformação de segurança; não desenvolver parser de leitura/renderização próprio. PDF é renderizado como página/imagem por PdfRenderer: isso não oferece seleção textual, busca ou leitura do texto por TalkBack equivalentes ao modo adaptado web.

## Distribuição e limites

Keystore de assinatura e senhas ficam em secret store externo. Android Keystore usado para a sessão não substitui a chave de assinatura do APK. CI debug é preview com chave efêmera e pode exigir reinstalação; desinstalar remove dados locais. Não anunciar assinatura estável ou sincronização em background não implementada.

O cache nativo não herda garantias de IndexedDB/Service Worker nem outbox web. A fila nativa é restrita a progresso: rascunhos por conta/livro, revisão esperada e chave de idempotência, preservados no logout sem acesso até novo login da mesma conta. Retomada, colisão e process death exigem seus próprios testes; isso não declara paridade com a outbox completa do PWA. Consulte [arquitetura](architecture.md) e [validação](testing.md).

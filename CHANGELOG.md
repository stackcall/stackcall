# Changelog

## v0.5.0

### Novidades

- Atalhos globais configuráveis, que funcionam com o jogo em tela cheia: microfone, silenciar tudo, apertar para falar, entrar no ar, salvar clipe e outros. Nenhum vem ligado de fábrica
- Modo apertar para falar, com som de confirmação quando a ação vem pelo atalho
- Clipes: uma tecla salva os últimos 30 a 120 segundos da tela com o som do jogo e a voz de quem falava, em Vídeos\Stackcall. Todos na sala veem quando alguém está com o replay ligado
- Galeria de clipes para abrir, mostrar na pasta e apagar
- Cutucar: mande um recado curto e uma voz lê no PC da pessoa, mesmo com o som dela silenciado
- Sala do mapa no CS2: CT e TR em sub-salas automáticas pela integração oficial da Valve, sem tocar no jogo
- Janela "quem fala" por cima do jogo, com opacidade, tamanho e posição configuráveis
- Qualidade de rede por pessoa e teste de rede
- Zoom, janela flutuante e grade para ver várias telas
- Versão leve da tela para quem tem internet fraca, e modo internet ruim
- "Quem me ouve": veja quantos recebem a sua voz e a sua tela
- Jogo detectado na presença ("jogando CS2")
- Busca Ctrl+K para achar ações, pessoas e configurações
- Moderação para dono e admin: mover de sala, silenciar todos e tirar da sala; troca de cargo pelo dono
- Configurações reorganizadas em Você, Servidor e App, com busca

### Melhorias

- O som do jogo agora sai também transmitindo a tela inteira (todo o som do PC menos as vozes da call)
- Som de entrada e saída na sala
- Servidor pode dormir sem ninguém em sala e acordar sozinho (opção de quem hospeda)
- As permissões internas do app ficaram mais fechadas: cada janela só chama o que usa

## v0.4.1

### Correções

- As melhorias da transmissão agora ficam ligadas: captura no fps escolhido, CBR de baixa latência, H.264 High e preset NVENC melhor nas placas NVIDIA (na 0.4.0 elas não eram ativadas)
- Salas e pessoas online atualizam sozinhas, sem precisar trocar de janela
- As novidades do app mostram o texto escrito para você, e não o texto técnico
- Saguão com grupo pequeno sem área vazia

### Ajustes

- O teste da placa roda de novo uma vez, para medir com as melhorias ligadas

## v0.4.0

### Novidades

- Tela Entrar no ar nova: tudo cabe na tela, com busca e abas nas fontes, prévia e qualidade lado a lado e atalhos de teclado
- O app lembra a placa, o upload, a fonte e a qualidade; o teste só roda de novo se o driver mudar ou no botão Refazer teste
- 1440p e 4K aparecem com o motivo quando estão travados
- Voz: escolha de microfone e saída, eco, ganho e supressão de ruído, teste de microfone e supressão forte opcional (RNNoise)
- Salas mostram quem está em cada uma e quem está no ar
- Saguão, sala e configurações redesenhados, sem espaço vazio
- Servidor próprio: a transmissão pela placa funciona em qualquer servidor do grupo

### Correções

- Erro 415 ao gerar convite
- A lista de fontes mostrava janelas que não estavam abertas, e jogo minimizado aparecia com tamanho errado
- 1080p60 travado mesmo com upload suficiente; a medição de upload ficou mais precisa
- Foto e banner do perfil não apareciam
- Abrir um link de convite durante a call derrubava a call
- O app inteiro mostrava Sem conexão quando o servidor de voz caía
- Um link de aparelho vencido apagava a sessão válida; sessão encerrada agora volta para a tela de entrada
- A sala reconecta sozinha depois de uma queda
- A transmissão falhava depois de 1 h na sala e caía no modo reserva sem aviso
- Mensagens de erro claras, com o que fazer
- A barra de título acompanha o tema e não pisca branco ao abrir
- Acentos cortados nos títulos

### Melhorias

- Transmissão mais leve: captura no fps escolhido, codificador sem rajadas, menos reaberturas e prioridade maior, fora do modo de economia do Windows
- Imagem mais nítida em H.264 nas placas NVIDIA e áudio do jogo a 96 kbps
- A transmissão pausa quando ninguém está assistindo e volta quando alguém assiste
- App mais leve com o jogo aberto: a sala redesenha menos, usa menos memória minimizado e pausa o vídeo com a janela oculta
- Miniaturas das fontes carregam em paralelo
- Servidor de voz com recuperação de perda mais rápida e medidor de voz mais ágil

## v0.3.0

### Novidades

- Visual novo no padrão Pôster, tema claro por padrão e escuro como opção
- Entrada por link de convite, sem senha e sem digitar servidor
- Servidor do grupo com dono, admins, convites e remoção de pessoas
- Mesa de canais, amigos, perfil personalizável e entrar em outro aparelho
- Modo jogo e ícone novo

### Correções

- Ping real da conexão de voz

### Melhorias

- Correções de segurança no servidor e no app

## v0.2.1

### Correções

- A transmissão pela placa de vídeo não abria por falta de um arquivo do FFmpeg

## v0.1.0

### Novidades

- Mede latencia do servidor na prova P5
- Adiciona porteiro da fase 0
- Add WebView2 screen sharing spike

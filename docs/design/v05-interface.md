# Interface da versão 0.5

Arquitetura da interface para as funcionalidades da 0.5. Direção visual travada: padrão Pôster (skill `padrao-pessoal`, igual a `app/src/index.css`). Protótipo navegável em [`v05/index.html`](v05/index.html); capturas em [`v05/prints/`](v05/prints/).

Pedido do Filippe: "com esse tanto de funcionalidades e configurações dentro do app, tem que pensar em uma interface que não fica poluída, fácil acesso às funcionalidades e configurações e também seja bonita".

Decidido em 25/11/2026. Este documento não reabre as decisões D1 a D6 do `PLANO.md`.

## 1. Princípios

A sala é a tela onde o grupo passa horas com um jogo ou um filme na frente. Ela mostra só o que muda durante a sessão. O resto fica a um gesto de distância, sempre pelo mesmo caminho.

### Três camadas

| Camada | O que entra | Regra para entrar |
|---|---|---|
| **À vista** (sala) | Quem está, quem fala, quem está no ar, a tela assistida, a conversa, os seus botões de voz, aviso de replay, rede ruim de alguém | Muda durante a sessão **e** alguém precisa notar sem procurar |
| **A um clique** | Menu da pessoa (clique direito), menu da sala (⋯), painel de sons, quem me ouve, controles da tela assistida, galeria de clipes, chamar para jogar | Usado várias vezes na sessão, mas não o tempo todo |
| **Configurações** | Tudo que se ajusta uma vez e esquece: atalhos, replay, sons de entrada, janela quem fala, mapa do CS2, servidor dorme | Muda o comportamento, não a sessão de hoje |

Quatro portas levam a qualquer coisa, e cada função tem uma só casa principal:

1. **Clique direito numa pessoa** (ou tecla de menu com o canal focado): tudo sobre aquela pessoa.
2. **Janela Você** (mesa, à esquerda): tudo sobre você agora (microfone, som, transmitir, sons, clipe, mais).
3. **Ctrl+K** (paleta de comandos): busca e faz qualquer ação, sala, pessoa ou ajuste pelo nome. Atalho global de quem conhece o app.
4. **Configurações** (Ctrl+,), com busca própria.

### Regras de desenho

- **Cor é estado, não enfeite.** Vermelho: ação principal, no ar e replay ligado (gravação é um tipo de "no ar"). Lima: quem fala e dado. Rede ruim usa `perigo` e sempre vem com texto ("rede ruim · 210 ms").
- **Ícone discreto só aparece quando diz algo.** As três barras de rede ficam em tinta fraca quando tudo vai bem e só ganham cor quando a rede piora. O texto da causa vai para o corpo do canal.
- **Painel nasce de onde foi chamado.** Sons e quem me ouve abrem acima da janela Você; o menu da pessoa abre sobre o canal dela. Nada de modal no meio da tela, exceto a paleta.
- **Uma tecla para cada coisa frequente.** Toda ação da paleta mostra o atalho ao lado. Quem usa muito aprende sem manual.
- **Nada de espaço morto.** Quando a coluna da conversa não cabe (grade de telas), ela vira uma tira de 44 px com o contador de novas.
- **Cabe em 1366×768 sem rolar a página.** Só a conversa e listas longas rolam por dentro.

## 2. Mapa de navegação

```
Topo (sempre): marca/servidor → saguão · abas das salas · busca (Ctrl+K) · Clipes · Configurações · você
│
├── Saguão (fora da voz)      salas com quem está e o jogo · galera online · chamar para jogar
├── Sala                       faixa da sala · palco · conversa/pessoas · mesa (Você + canais)
│   ├── menu da sala (⋯)       silenciar todos (admin) · sons da sala · mapa do CS2 · sair
│   ├── menu da pessoa         volume · perfil · assistir · silenciar para mim · moderação
│   ├── painel de sons         a partir da janela Você
│   ├── quem me ouve           a partir do rodapé da janela Você
│   └── Entrar no ar           tela atual de Go Live (sem mudança na 0.5)
├── Clipes                     galeria com corte por faixa e envio na conversa
├── Configurações              (Esc volta para onde estava)
└── Janela quem fala           janela separada do sistema, sempre no topo
```

A barra do topo perde o seletor Claro/Escuro e o medidor de ping solto da 0.4. O tema vai para Configurações › Aparência e para a paleta ("tema escuro"). O seu ping vai para a barra da janela Você, no mesmo formato do ping dos outros.

## 3. Onde cada funcionalidade mora

| # | Funcionalidade | Casa principal | Também em | Notas de desenho |
|---|---|---|---|---|
| 1 | Rede por pessoa | Três barras na barra de título de cada canal; a sua na janela Você | Menu da pessoa (ping e perda em números); dica ao passar o mouse | Com rede ruim, o corpo do canal troca "jogando CS2" por "rede ruim · 210 ms · 3% perda" em `perigo`. |
| 1b | Teste de rede | Configurações › Voz e rede › Teste | Ctrl+K "teste de rede"; menu ⋯ da janela Você | Junta teste de microfone (grava 5 s e devolve) com ping e perda até o servidor. |
| 2 | Zoom, janela flutuante | Controles do palco (embaixo, à direita) | Teclas `+` `−` `0`, `P` (flutuante), `F` (tela cheia) | Os controles aparecem ao passar o mouse ou focar o palco. Zoom arrasta com o mouse. |
| 2b | Grade de telas | Seletor "Uma · Grade" que aparece na faixa da sala quando 2 ou mais pessoas estão no ar | Ctrl+K "grade" | O som vem da tela marcada (contorno vermelho). Clique numa tela para trocar o som. Cada tela tem sua qualidade. |
| 3 | Moderação | Menu da pessoa, seção "Moderação · você é admin" | Menu da sala: "Silenciar todos" | Só aparece para dono e admin. "Tirar da sala…" pede confirmação. "Mover para" abre submenu com as salas. |
| 4 | Som de entrada e saída | Configurações › Sons e avisos | — | Ligado por padrão, volume próprio. |
| 4b | Chamar para jogar | Saguão (painel à direita) | Botão na faixa da sala; Ctrl+K "chamar" | Jogo vem do jogo detectado; sala vem da atual; lista de quem avisar; prévia da notificação. Limite: um chamado a cada 10 min. |
| 5 | Jogo detectado | Corpo do canal ("jogando CS2"); lista da galera no saguão | Menu da pessoa; cartão de perfil | Cada pessoa pode desligar em Configurações › Perfil ("mostrar o jogo"). |
| 6 | Soundboard | Botão "Sons" na janela Você abre o painel acima dela | Ctrl+Shift+S; Configurações › Sons da sala (envio, admin) | Teclas 1 a 8 com o painel aberto. Barra lima mostra o som tocando. Espera de 3 s por pessoa aparece no botão ("em 2 s"). Cada um regula o volume dos sons para si e pode calar os sons de alguém pelo menu da pessoa. |
| 7 | Clipes (salvar) | Alt+F10 (global); botão Clipe na janela Você | Ctrl+K | Ao salvar, linha de sistema na conversa: "Rafa salvou um clipe de 45 s · Ver". |
| 7b | Aviso de replay | Chip "Replay ligado: Rafa e Duda" na faixa da sala; ícone ⟲ vermelho no canal de quem grava | Janela quem fala | O aviso **não desliga**. É a contrapartida de gravar a voz de todos. |
| 7c | Galeria de clipes | Ícone de filme no topo | Ctrl+Shift+C; "Ver" na conversa | Corte por faixa: tela, jogo e a voz de cada pessoa separada. Dá para tirar uma voz do clipe antes de enviar. |
| 8 | Qualidade de quem assiste | Controle "Você recebe: Original 1080p60" no palco | Menu da pessoa › Assistir tela | Opções: Original, Leve 720p, Automático. |
| 9 | Janela quem fala | Menu ⋯ da janela Você › "Janela quem fala" | Ctrl+Shift+O; Configurações › Janela quem fala | Janela separada do Tauri, sem borda, sempre no topo, o clique passa através. Nada de gancho no jogo. Fica no lado esquerdo, na altura do meio, longe do minimapa e do placar; o usuário arrasta. |
| 10 | Sala do mapa no CS2 | Automático quando o GSI avisa a partida; liga em Configurações › Salas e mapa do CS2 (admin) | Aba da sala mostra "CT 3 · TR 2" | Mesa agrupa CT e TR. O outro lado aparece com borda tracejada e "volta no fim do round". **As telas do outro lado ficam escondidas durante a partida** (anti-trapaça entre amigos). |
| 11 | Modo internet ruim | Menu ⋯ da janela Você; Ctrl+Shift+B | Ctrl+K; sugestão automática quando a sua perda passa de 5% | O palco mostra "voz primeiro" e o botão para desligar. A sua tela continua indo para quem assiste. |
| 12 | Quem me ouve | Rodapé da janela Você: "4 te ouvem · 0 veem" | — | Lista por pessoa com voz e tela. **"Silenciar para mim" de outra pessoa não aparece aqui**: o volume zero continua recebendo, para ninguém descobrir que foi silenciado. Só aparecem motivos técnicos (conectando, modo internet ruim dela). |
| 13 | Atalhos e apertar para falar | Configurações › Atalhos | Ctrl+K "atalhos" | Tabela por grupo, com tecla, e se vale fora do app. Gravação de tecla mostra conflito na hora. |
| 14 | Servidor dorme | Configurações › Servidor › Geral e convites (admin) | — | "Dormir depois de 30 min sem ninguém"; o saguão mostra "acordando…" por alguns segundos na primeira entrada. |

## 4. A sala, peça por peça (1366×768)

```
┌ topo 48 ─────────────────────────────────────────────────────────────────────────────┐
│ STACKCALL│Galera  [CS·5 ▪][Lobby][Cinema][Ranked]  [⌕ Buscar … Ctrl K]  [🎞][⚙][B] │
├ faixa 36 ────────────────────────────────────────────────────────────────────────────┤
│ CS  5 NA SALA · …   [⟲ Replay ligado: Rafa e Duda]       [Chamar para jogar][Convidar][⋯] │
├ palco ─────────────────────────────────────────────────┬ conversa 330 ───────────────┤
│ ■ NO AR · RAFA                       1080p60 · AV1 · 3 │ CONVERSA · CS │ PESSOAS     │
│                                                        │ …                           │
│                    tela                                │ ⟲ Rafa salvou um clipe  Ver │
│              [Você recebe: Original][−100%+][▣][⛶][Parar] │ [Mensagem para CS    →]  │
├ mesa 164 ──────────────────┬──────────┬──────────┬──────────┬──────────┤────────────┤
│ VOCÊ · BRONZE   ▮▮▮ 142 ms │ RAFA ⟲▮▮▮│ DUDA ⟲▮▮▮│ LÉO   ▮▯▯│ NANDA ▮▮▯│
│ [🎙][🎧][Transmitir][▦][⟲][⋯][⇥] │ falando  │ falando  │ rede ruim│ mic desl.│
│ 4 te ouvem · 0 veem  REPLAY 60 S │ ───●──80%│ ───●──72%│ ───●──64%│ ───●──90%│
└────────────────────────────┴──────────┴──────────┴──────────┴──────────┘
```

- A manchete gigante da 0.4 ("CS" em 72 px) saiu: a aba ativa já diz a sala. O nome fica em 32 px na faixa, ao lado do estado (aquecimento, mapa, quem está no ar). Ganho: 40 px para o palco.
- A janela Você tem sete botões: microfone, som, **Transmitir** (vermelho, o único), sons, clipe (com marca vermelha quando o replay está ligado), mais (⋯) e sair. O ⋯ abre: janela quem fala, modo internet ruim, teste de rede, entrar no ar com outra fonte.
- Os canais mantêm a linguagem da 0.4: barra vermelha e corpo escuro para quem está no ar; corpo lima para quem fala.

### Paleta Ctrl+K

- Abre de qualquer tela, inclusive das Configurações.
- Grupos fixos, nesta ordem: Ações, Salas e pessoas, Configurações. Cada linha mostra onde mora e o atalho.
- Ação que liga e desliga mostra o estado atual ("Modo internet ruim · ligado" → "desligar").
- `>` filtra só ações; `@` só pessoas. `Tab` abre o ajuste destacado nas Configurações em vez de mudar na hora.

### Menu da pessoa

Ordem: cabeçalho com jogo, ping e perda → volume → Ver perfil → Assistir tela → Silenciar para mim → Não ouvir os sons dela → **Moderação** (só dono e admin): Mover para ›, Silenciar na sala, Tirar da sala…. Itens de moderação ficam abaixo de uma linha forte, com o rótulo do seu cargo, para ninguém clicar por engano. "Tirar da sala…" usa `perigo` e confirma.

## 5. Configurações reorganizadas

Três grupos, na ordem de quem mais mexe:

| Grupo | Páginas |
|---|---|
| **Você** | Perfil · Voz e rede · Atalhos · Clipes e replay · Sons e avisos · Janela quem fala · Aparência |
| **Servidor Galera** (só dono e admin; mostra o cargo) | Geral e convites (servidor dorme) · Salas e mapa do CS2 · Sons da sala · Membros e cargos |
| **App** | Servidores · Sobre e atualizações |

De onde veio cada página atual:

| 0.4 | 0.5 |
|---|---|
| Servidor | Servidor Galera › Geral e convites |
| Servidores | App › Servidores |
| Voz e tema | Você › Voz e rede (voz) e Você › Aparência (tema) |
| Sobre e atualizações | App › Sobre e atualizações |
| Perfil (tela separada) | Você › Perfil (o atalho pelo avatar continua) |

**Busca** no topo da lateral (Ctrl+F dentro das Configurações). Procura no nome do ajuste, na descrição e em apelidos ("ptt" acha Apertar para falar; "mute" acha microfone; "gravação" acha replay). O resultado mostra o caminho ("Voz e rede › Microfone") e o próprio controle, para mudar ali mesmo sem abrir a página.

Cada página segue o mesmo molde: cabeçalho (rótulo com dado + manchete), depois linhas em janela com nome, uma frase do que muda e o controle à direita.

## 6. Estados vazios e de borda

| Lugar | Estado | Texto e ação |
|---|---|---|
| Palco | Ninguém no ar | Grade de quem fala (como hoje) e "Ninguém transmitindo. **Transmitir**" |
| Palco | Modo internet ruim | "voz primeiro" (pincel) + "O vídeo que você recebe está pausado…" + **Desligar e voltar o vídeo** |
| Grade | Só uma tela no ar | O seletor "Uma · Grade" some |
| Sala do CS2 | GSI sem sinal | Mesa normal; na faixa: "mapa do CS2 sem sinal · confira o arquivo do GSI" (link para Configurações) |
| Sons | Sala sem sons | "Esta sala ainda não tem sons." Admin vê **Enviar o primeiro som**; os outros veem "Peça para um admin enviar." |
| Clipes | Nenhum clipe | "Nenhum clipe ainda. Ligue o replay e aperte Alt+F10 depois de uma jogada boa." + **Ligar replay** |
| Clipes | Disco cheio | Bloco Espaço em `perigo`: "Limite de 20 GB cheio. O clipe mais antigo vai sair no próximo." |
| Quem me ouve | Sozinho na sala | "Ninguém mais aqui. **Chamar para jogar**" |
| Saguão | Sala vazia | "Ninguém aqui. A primeira pessoa a entrar escolhe o filme." |
| Saguão | Servidor dormindo | Cartões com "dormindo · acorda quando você entrar" |
| Chamar para jogar | Ninguém disponível | "A galera toda já está numa sala." O botão some. |
| Paleta | Sem resultado | "Nada com “xyz”. Procure nas **Configurações**." |
| Busca de ajustes | Sem resultado | "Nenhum ajuste com “xyz”. Tente outra palavra, como “microfone” ou “tela”." |

## 7. Atalhos padrão

| Ação | Tecla | Global |
|---|---|---|
| Apertar para falar | Mouse 4 | sim |
| Microfone | Ctrl+Shift+M | sim |
| Som | Ctrl+Shift+D | sim |
| Modo internet ruim | Ctrl+Shift+B | sim |
| Salvar clipe | Alt+F10 | sim |
| Ligar ou desligar o replay | Alt+F9 | sim |
| Janela quem fala | Ctrl+Shift+O | sim |
| Sons da sala | Ctrl+Shift+S | não |
| Clipes | Ctrl+Shift+C | não |
| Comandos | Ctrl+K | não |
| Configurações | Ctrl+, | não |

Alt+F10 e Alt+F9 colidem com o replay do GeForce Experience/NVIDIA App quando ele está ligado. O app avisa na primeira vez e sugere trocar; o padrão fica porque quem joga já tem a memória muscular.

## 8. Decisões registradas

1. Replay ligado é estado de "no ar": usa vermelho e não tem como esconder o aviso.
2. "Silenciar para mim" não aparece no "quem me ouve" de quem foi silenciado.
3. Telas do outro time ficam escondidas durante a partida com o mapa do CS2 ligado.
4. A conversa vira tira quando a grade precisa da largura.
5. O tema sai do topo e vai para Aparência e para a paleta.
6. Moderação mora só no menu da pessoa e no menu da sala; não há painel de moderação separado.
7. Clipes ficam no PC de quem salvou; compartilhar é enviar na conversa (upload do arquivo cortado).
8. A janela quem fala é uma janela do sistema, nunca um gancho no jogo.

## 9. Protótipo

- Abra `docs/design/v05/index.html` no navegador. A barra fina embaixo troca de tela e de tema (passe o mouse).
- Endereços diretos: `#sala`, `#grade`, `#menu-pessoa`, `#paleta`, `#sons`, `#clipes`, `#saguao`, `#config-atalhos`, `#config-clipes`, `#config-busca`, `#quem-fala`. `?tema=escuro` abre no escuro; `?print` esconde a barra do protótipo.
- HTML e CSS puros. As telas trocam por `:target`. O único script lê o tema e o modo captura.
- Fontes locais em `v05/fontes/` (as mesmas do app, licença OFL, via @fontsource).
- As cenas de jogo são formas chapadas em CSS, só para dar escala. Nomes e números são fictícios.

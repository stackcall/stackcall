# Interface da versão 0.5

Arquitetura da interface para as funcionalidades da 0.5. Direção visual travada: padrão Pôster (skill `padrao-pessoal`, igual a `app/src/index.css`). Protótipo navegável em [`v05/index.html`](v05/index.html); capturas em [`v05/prints/`](v05/prints/).

Pedido do Filippe: "com esse tanto de funcionalidades e configurações dentro do app, tem que pensar em uma interface que não fica poluída, fácil acesso às funcionalidades e configurações e também seja bonita".

Decidido em 25/11/2026. Revisado no mesmo dia depois da revisão do Filippe: soundboard removido, janela quem fala configurável, nenhum atalho de fábrica, "Chamar para jogar" trocado por "Cutucar". Este documento não reabre as decisões D1 a D6 do `PLANO.md`.

## 1. Princípios

A sala é a tela onde o grupo passa horas com um jogo ou um filme na frente. Ela mostra só o que muda durante a sessão. O resto fica a um gesto de distância, sempre pelo mesmo caminho.

### Três camadas

| Camada | O que entra | Regra para entrar |
|---|---|---|
| **À vista** (sala) | Quem está, quem fala, quem está no ar, a tela assistida, a conversa, os seus botões de voz, aviso de replay, rede ruim de alguém | Muda durante a sessão **e** alguém precisa notar sem procurar |
| **A um clique** | Menu da pessoa (clique direito), menu da sala (⋯), quem me ouve, cutucar, controles da tela assistida, galeria de clipes | Usado várias vezes na sessão, mas não o tempo todo |
| **Configurações** | Tudo que se ajusta uma vez e esquece: atalhos, replay, cutucadas, sons de entrada, janela quem fala, mapa do CS2, servidor dorme | Muda o comportamento, não a sessão de hoje |

Quatro portas levam a qualquer coisa, e cada função tem uma só casa principal:

1. **Clique direito numa pessoa** (ou tecla de menu com o canal focado): tudo sobre aquela pessoa.
2. **Janela Você** (mesa, à esquerda): tudo sobre você agora (microfone, som, transmitir, clipe, mais).
3. **Busca do topo** (paleta de comandos): acha e faz qualquer ação, sala, pessoa ou ajuste pelo nome. Quem quiser define uma tecla para abri-la em Atalhos.
4. **Configurações**, com busca própria.

### Regras de desenho

- **Cor é estado, não enfeite.** Vermelho: ação principal, no ar e replay ligado (gravação é um tipo de "no ar"). Lima: quem fala e dado. Rede ruim usa `perigo` e sempre vem com texto ("rede ruim · 210 ms").
- **Ícone discreto só aparece quando diz algo.** As três barras de rede ficam em tinta fraca quando tudo vai bem e só ganham cor quando a rede piora. O texto da causa vai para o corpo do canal.
- **Painel nasce de onde foi chamado.** Quem me ouve abre acima da janela Você; o menu da pessoa abre sobre o canal dela. Nada de modal no meio da tela, exceto a paleta.
- **Nenhum atalho vem pronto.** Toda ação frequente pode ganhar uma tecla em Configurações › Atalhos, e a página mostra uma sugestão escrita. Quando o usuário define uma tecla, ela aparece ao lado da ação na paleta e nas dicas. Sem tecla definida, nada aparece. Motivo: qualquer padrão pode colidir com outro programa da máquina (o Ctrl+Shift+O do protótipo antigo já tinha dono no PC do Filippe).
- **Teclas de navegação não são atalhos.** Esc fecha, Enter confirma, setas e Tab andam dentro de menus e diálogos. Isso é comportamento padrão de interface e não se configura.
- **Nada de espaço morto.** Quando a coluna da conversa não cabe (grade de telas), ela vira uma tira de 44 px com o contador de novas.
- **Cabe em 1366×768 sem rolar a página.** Só a conversa e listas longas rolam por dentro.

## 2. Mapa de navegação

```
Topo (sempre): marca/servidor → saguão · abas das salas · busca e comandos · Clipes · Configurações · você
│
├── Saguão (fora da voz)      salas com quem está e o jogo · galera online · faixa de cutucada recebida
├── Sala                       faixa da sala · palco · conversa/pessoas · mesa (Você + canais)
│   ├── menu da sala (⋯)       silenciar todos (admin) · mapa do CS2 · sair
│   ├── menu da pessoa         volume · perfil · assistir · cutucar… · silenciar para mim · moderação
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
| 1b | Teste de rede | Configurações › Voz e rede › Teste | Paleta "teste de rede"; menu ⋯ da janela Você | Junta teste de microfone (grava 5 s e devolve) com ping e perda até o servidor. |
| 2 | Zoom, janela flutuante | Controles do palco (embaixo, à direita) | Roda do mouse sobre o palco (zoom); clique duplo (tela cheia) | Os controles aparecem ao passar o mouse ou focar o palco. Zoom arrasta com o mouse. |
| 2b | Grade de telas | Seletor "Uma · Grade" que aparece na faixa da sala quando 2 ou mais pessoas estão no ar | Paleta "grade" | O som vem da tela marcada (contorno vermelho). Clique numa tela para trocar o som. Cada tela tem sua qualidade. |
| 3 | Moderação | Menu da pessoa, seção "Moderação · você é admin" | Menu da sala: "Silenciar todos" | Só aparece para dono e admin. "Tirar da sala…" pede confirmação. "Mover para" abre submenu com as salas. |
| 4 | Som de entrada e saída | Configurações › Sons e avisos | — | Ligado por padrão, volume próprio. |
| 4b | Cutucar | Menu da pessoa › "Cutucar…" (na sala, na lista de pessoas e na galera do saguão) | Paleta: "cutucar Léo" | Abre um campo pequeno sobre o canal da pessoa: recado de até 80 caracteres com contador, sugestões rápidas ("a sala tá pronta", "bora jogar", "volta pra call") e a frase exata que a pessoa vai ouvir. Limite visível no próprio campo: uma cutucada a cada 30 s para a mesma pessoa; depois de enviar, o item do menu mostra "Cutucar… em 22 s". Detalhes na seção 4. |
| 5 | Jogo detectado | Corpo do canal ("jogando CS2"); lista da galera no saguão | Menu da pessoa; cartão de perfil | Cada pessoa pode desligar em Configurações › Perfil ("mostrar o jogo"). |
| 7 | Clipes (salvar) | Botão Clipe na janela Você | Paleta; tecla, se o usuário definir uma | Ao salvar, linha de sistema na conversa: "Rafa salvou um clipe de 45 s · Ver". |
| 7b | Aviso de replay | Chip "Replay ligado: Rafa e Duda" na faixa da sala; ícone ⟲ vermelho no canal de quem grava | Janela quem fala | O aviso **não desliga**. É a contrapartida de gravar a voz de todos. |
| 7c | Galeria de clipes | Ícone de filme no topo | "Ver" na conversa; paleta | Corte por faixa: tela, jogo e a voz de cada pessoa separada. Dá para tirar uma voz do clipe antes de enviar. |
| 8 | Qualidade de quem assiste | Controle "Você recebe: Original 1080p60" no palco | Menu da pessoa › Assistir tela | Opções: Original, Leve 720p, Automático. |
| 9 | Janela quem fala | Configurações › Janela quem fala | Menu ⋯ da janela Você (mostrar ou esconder); tecla, se o usuário definir uma | Janela separada do Tauri, sem borda, sempre no topo, o clique passa através. Nada de gancho no jogo. Configurável: mostrar ou esconder; só quem fala ou todos da sala (quem fala acende em lima); opacidade de 20 a 100%; tamanho pequeno, médio ou grande; canto (seis posições) ou arrastar com o mouse. Padrão: todos da sala, 80%, médio, esquerda no meio (longe do minimapa e do placar). Prévia ao vivo na própria página. |
| 10 | Sala do mapa no CS2 | Automático quando o GSI avisa a partida; liga em Configurações › Salas e mapa do CS2 (admin) | Aba da sala mostra "CT 3 · TR 2" | Mesa agrupa CT e TR. O outro lado aparece com borda tracejada e "volta no fim do round". **As telas do outro lado ficam escondidas durante a partida** (anti-trapaça entre amigos). |
| 11 | Modo internet ruim | Menu ⋯ da janela Você | Paleta; sugestão automática quando a sua perda passa de 5%; tecla, se o usuário definir uma | O palco mostra "voz primeiro" e o botão para desligar. A sua tela continua indo para quem assiste. |
| 12 | Quem me ouve | Rodapé da janela Você: "4 te ouvem · 0 veem" | — | Lista por pessoa com voz e tela. **"Silenciar para mim" de outra pessoa não aparece aqui**: o volume zero continua recebendo, para ninguém descobrir que foi silenciado. Só aparecem motivos técnicos (conectando, modo internet ruim dela). |
| 13 | Atalhos e apertar para falar | Configurações › Atalhos | Paleta "atalhos" | Nenhum vem pronto. Cada linha mostra "sem atalho", uma sugestão escrita e o botão Definir. Ao gravar, o app tenta registrar a tecla; se outro programa já usa, avisa na hora ("Ctrl+Shift+O já é usado por outro programa"). Apertar para falar só funciona depois de o usuário escolher a tecla; até lá a página avisa. |
| 14 | Servidor dorme | Configurações › Servidor › Geral e convites (admin) | — | "Dormir depois de 30 min sem ninguém"; o saguão mostra "acordando…" por alguns segundos na primeira entrada. |

## 4. A sala, peça por peça (1366×768)

```
┌ topo 48 ─────────────────────────────────────────────────────────────────────────────┐
│ STACKCALL│Galera  [CS·5 ▪][Lobby][Cinema][Ranked]  [⌕ Buscar sala, pessoa, ação…]  [🎞][⚙][B] │
├ faixa 36 ────────────────────────────────────────────────────────────────────────────┤
│ CS  5 NA SALA · …   [⟲ Replay ligado: Rafa e Duda]                          [Convidar][⋯] │
├ palco ─────────────────────────────────────────────────┬ conversa 330 ───────────────┤
│ ■ NO AR · RAFA                       1080p60 · AV1 · 3 │ CONVERSA · CS │ PESSOAS     │
│                                                        │ …                           │
│                    tela                                │ ⟲ Rafa salvou um clipe  Ver │
│              [Você recebe: Original][−100%+][▣][⛶][Parar] │ [Mensagem para CS    →]  │
├ mesa 164 ──────────────────┬──────────┬──────────┬──────────┬──────────┤────────────┤
│ VOCÊ · BRONZE   ▮▮▮ 142 ms │ RAFA ⟲▮▮▮│ DUDA ⟲▮▮▮│ LÉO   ▮▯▯│ NANDA ▮▮▯│
│ [🎙][🎧][ Transmitir ][⟲][⋯][⇥] │ falando  │ falando  │ rede ruim│ mic desl.│
│ 4 te ouvem · 0 veem  REPLAY 60 S │ ───●──80%│ ───●──72%│ ───●──64%│ ───●──90%│
└────────────────────────────┴──────────┴──────────┴──────────┴──────────┘
```

- A manchete gigante da 0.4 ("CS" em 72 px) saiu: a aba ativa já diz a sala. O nome fica em 32 px na faixa, ao lado do estado (aquecimento, mapa, quem está no ar). Ganho: 40 px para o palco.
- A janela Você tem 372 px e seis botões: microfone, som, **Transmitir** (vermelho, o único), clipe (com marca vermelha quando o replay está ligado), mais (⋯) e sair. Os botões de ícone têm largura fixa de 40 px; só Transmitir estica. O ⋯ abre: janela quem fala, modo internet ruim, teste de rede, entrar no ar com outra fonte.
- Os canais mantêm a linguagem da 0.4: barra vermelha e corpo escuro para quem está no ar; corpo lima para quem fala.

### Cutucar

Ideia do "poke" do TeamSpeak: chamar quem tirou o som do Stackcall, sem depender de a pessoa olhar a tela.

**Quem cutuca**
1. Clique direito na pessoa › "Cutucar…", ou a paleta ("cutucar Léo").
2. Um campo pequeno abre sobre o canal da pessoa, já com o cursor. Recado de até 80 caracteres, com contador e três sugestões rápidas. O recado é opcional; sem ele, a voz diz só "Bronze te cutucou".
3. A linha de prévia mostra a frase exata que a pessoa vai ouvir.
4. O rodapé mostra o limite: uma cutucada a cada 30 s para a mesma pessoa. Enter envia; Esc fecha.
5. Quem não aceita cutucadas de você aparece com "Cutucar…" apagado e a dica "não recebe cutucadas agora", sem dizer se é por escolha.

**Quem recebe**
1. Uma voz lê em voz alta: "Bronze te cutucou: a sala tá pronta". Toca **mesmo com o som do Stackcall silenciado** (padrão ligado). O mudo do próprio Windows continua valendo.
2. Aviso do Windows com "Entrar na sala".
3. Faixa no topo do app, abaixo da barra das salas, com a voz destacada em vermelho, o nome, o recado e os botões **Entrar na sala CS**, **Cutucar de volta** e fechar. A faixa fica até ser fechada ou até a pessoa entrar na sala.

A voz é a síntese de fala do próprio Windows (Web Speech API do WebView2, voz pt-BR instalada no sistema). Roda no PC de quem recebe; o recado não vai para nenhum serviço de fora. Se o PC não tiver voz em português, o app avisa em Configurações › Cutucadas e toca só um som curto.

### Paleta de comandos

- Abre de qualquer tela, inclusive das Configurações.
- Abre pela busca do topo ou pela tecla que o usuário definir.
- Grupos fixos, nesta ordem: Ações, Salas e pessoas, Configurações. Cada linha mostra onde mora, e o atalho só se o usuário definiu um.
- Ação que liga e desliga mostra o estado atual ("Modo internet ruim · ligado" → "desligar").
- `>` filtra só ações; `@` só pessoas. `Tab` abre o ajuste destacado nas Configurações em vez de mudar na hora.

### Menu da pessoa

Ordem: cabeçalho com jogo, ping e perda → volume → Ver perfil → Assistir tela → Cutucar… → Silenciar para mim → **Moderação** (só dono e admin): Mover para ›, Silenciar na sala, Tirar da sala…. Itens de moderação ficam abaixo de uma linha forte, com o rótulo do seu cargo, para ninguém clicar por engano. "Tirar da sala…" usa `perigo` e confirma.

## 5. Configurações reorganizadas

Três grupos, na ordem de quem mais mexe:

| Grupo | Páginas |
|---|---|
| **Você** | Perfil · Voz e rede · Atalhos · Clipes e replay · Cutucadas · Sons e avisos · Janela quem fala · Aparência |
| **Servidor Galera** (só dono e admin; mostra o cargo) | Geral e convites (servidor dorme) · Salas e mapa do CS2 · Membros e cargos |
| **App** | Servidores · Sobre e atualizações |

De onde veio cada página atual:

| 0.4 | 0.5 |
|---|---|
| Servidor | Servidor Galera › Geral e convites |
| Servidores | App › Servidores |
| Voz e tema | Você › Voz e rede (voz) e Você › Aparência (tema) |
| Sobre e atualizações | App › Sobre e atualizações |
| Perfil (tela separada) | Você › Perfil (o atalho pelo avatar continua) |

**Busca** no topo da lateral. Procura no nome do ajuste, na descrição e em apelidos ("ptt" acha Apertar para falar; "mute" acha microfone; "gravação" acha replay). O resultado mostra o caminho ("Voz e rede › Microfone") e o próprio controle, para mudar ali mesmo sem abrir a página.

**Você › Cutucadas**: receber cutucadas de (todos do grupo, só amigos, ninguém) · ler o recado em voz alta (ligado ou desligado) · volume da voz, separado do volume da sala, com botão Testar · tocar mesmo com o som silenciado (ligado por padrão) · aviso do Windows (ligado por padrão). Rodapé: "Quem cutuca espera 30 s para cutucar a mesma pessoa de novo."

Cada página segue o mesmo molde: cabeçalho (rótulo com dado + manchete), depois linhas em janela com nome, uma frase do que muda e o controle à direita.

## 6. Estados vazios e de borda

| Lugar | Estado | Texto e ação |
|---|---|---|
| Palco | Ninguém no ar | Grade de quem fala (como hoje) e "Ninguém transmitindo. **Transmitir**" |
| Palco | Modo internet ruim | "voz primeiro" (pincel) + "O vídeo que você recebe está pausado…" + **Desligar e voltar o vídeo** |
| Grade | Só uma tela no ar | O seletor "Uma · Grade" some |
| Sala do CS2 | GSI sem sinal | Mesa normal; na faixa: "mapa do CS2 sem sinal · confira o arquivo do GSI" (link para Configurações) |
| Clipes | Nenhum clipe | "Nenhum clipe ainda. Ligue o replay e use o botão Clipe depois de uma jogada boa." + **Ligar replay** |
| Clipes | Disco cheio | Bloco Espaço em `perigo`: "Limite de 20 GB cheio. O clipe mais antigo vai sair no próximo." |
| Quem me ouve | Sozinho na sala | "Ninguém mais aqui. Para chamar alguém, clique com o botão direito no nome e escolha Cutucar." |
| Saguão | Sala vazia | "Ninguém aqui. A primeira pessoa a entrar escolhe o filme." / "Vazia. Entre e cutuque a galera." |
| Saguão | Servidor dormindo | Cartões com "dormindo · acorda quando você entrar" |
| Cutucar | Limite de 30 s | Campo fechado; item do menu mostra "Cutucar… em 22 s" |
| Cutucar | Pessoa não aceita | Item apagado: "não recebe cutucadas agora" |
| Cutucadas | PC sem voz em português | "Este PC não tem voz em português. A cutucada toca um som curto." + link para as vozes do Windows |
| Atalhos | Nenhum definido | Topo da página: "Nenhum atalho vem pronto. Defina só os que você vai usar." |
| Atalhos | Tecla em uso | "Ctrl+Shift+O já é usado por outro programa. Aperte outra tecla." |
| Janela quem fala | "Só quem fala" e ninguém falando | A janela fica vazia e transparente, sem moldura. |
| Paleta | Sem resultado | "Nada com “xyz”. Procure nas **Configurações**." |
| Busca de ajustes | Sem resultado | "Nenhum ajuste com “xyz”. Tente outra palavra, como “microfone” ou “tela”." |

## 7. Atalhos

Nenhum atalho vem de fábrica. A página Atalhos lista as ações abaixo, cada uma com "sem atalho", uma sugestão escrita e o botão Definir.

| Ação | Sugestão escrita | Alcance |
|---|---|---|
| Apertar para falar | Mouse 4 | global |
| Ligar ou desligar o microfone | Ctrl+Shift+M | global |
| Ligar ou desligar o som | Ctrl+Shift+D | global |
| Modo internet ruim | Ctrl+Shift+B | global |
| Salvar clipe | Alt+F10 | global |
| Ligar ou desligar o replay | Alt+F9 | global |
| Mostrar ou esconder a janela quem fala | nenhuma (sem sugestão boa que não colida) | global |
| Abrir a busca e os comandos | Ctrl+K | só com o app na frente |

A sugestão é só texto: o app não grava a tecla sozinho. Ao definir, o app tenta registrar a tecla global (plugin `global-shortcut` do Tauri). Se o registro falhar porque outro programa já usa, a linha mostra o aviso e pede outra tecla. A sugestão de Alt+F10 avisa que o app da NVIDIA também usa essa tecla.

## 8. Decisões registradas

1. Replay ligado é estado de "no ar": usa vermelho e não tem como esconder o aviso.
2. "Silenciar para mim" não aparece no "quem me ouve" de quem foi silenciado.
3. Telas do outro time ficam escondidas durante a partida com o mapa do CS2 ligado.
4. A conversa vira tira quando a grade precisa da largura.
5. O tema sai do topo e vai para Aparência e para a paleta.
6. Moderação mora só no menu da pessoa e no menu da sala; não há painel de moderação separado.
7. Clipes ficam no PC de quem salvou; compartilhar é enviar na conversa (upload do arquivo cortado).
8. A janela quem fala é uma janela do sistema, nunca um gancho no jogo, e tudo nela é configurável.
9. Soundboard fora da 0.5 (revisão do Filippe em 25/11/2026).
10. Nenhum atalho de fábrica; só sugestão escrita.
11. "Chamar para jogar" saiu. No lugar entra "Cutucar", uma pessoa por vez, com recado lido em voz alta mesmo com o som silenciado.

## 9. Protótipo

- Abra `docs/design/v05/index.html` no navegador. A barra fina embaixo troca de tela e de tema (passe o mouse).
- Endereços diretos: `#sala`, `#grade`, `#menu-pessoa`, `#cutucar`, `#paleta`, `#clipes`, `#saguao`, `#config-atalhos`, `#config-clipes`, `#config-cutucadas`, `#config-quemfala`, `#config-busca`, `#quem-fala`. `?tema=escuro` abre no escuro; `?print` esconde a barra do protótipo.
- HTML e CSS puros. As telas trocam por `:target`. O único script lê o tema e o modo captura.
- Fontes locais em `v05/fontes/` (as mesmas do app, licença OFL, via @fontsource).
- As cenas de jogo são formas chapadas em CSS, só para dar escala. Nomes e números são fictícios.

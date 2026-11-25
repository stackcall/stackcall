# Roteiro de teste da 0.5 no app instalado

Para rodar no PC do Filippe (RTX 5060), com o instalador da branch `feat/v05-integracao`. Precisa de um segundo PC (ou de uma segunda conta em outro PC) na mesma sala para os itens marcados com **2 PCs**. Anote o que falhar com o horário: o log fica em `%APPDATA%\io.github.stackcall\logs`.

## 0. Antes

1. Instale e abra o Stackcall. Entre no servidor e numa sala.
2. Abra o CS2 uma vez antes do item 6, para o caminho do GSI existir.

## 1. Transmitir com som do jogo

1. Clique em **Transmitir**. Escolha a **janela** de um jogo e deixe **Som do jogo: Ligado**.
   - Deve aparecer "com o som do jogo" no resumo.
   - **2 PCs:** o outro PC assiste e ouve o jogo, e não ouve a música do navegador.
2. Pare. Transmita de novo, agora o **monitor inteiro**, com **Som do jogo: Ligado**.
   - Deve aparecer "com o som do PC, menos o Stackcall".
   - **2 PCs:** o outro PC ouve o som do PC, mas não ouve a própria voz de volta (o Stackcall fica fora).
3. Repita com **Som do jogo: Desligado**. **2 PCs:** quem assiste não ouve nada da tela.

## 2. Faixa leve (**2 PCs**)

1. No PC B, assista à tela do PC A. Nos controles da tela, troque **Você recebe** para **Leve**.
   - Em até uns 5 s, o rótulo do palco deve mostrar 720p.
   - O som da tela continua.
2. Volte para **Original**: o palco volta à resolução da transmissão.
3. No PC A (que transmite), confira no Gerenciador de Tarefas: o uso da placa sobe um pouco só enquanto alguém está em Leve.

## 3. Replay e clipes

1. Configurações › **Clipes e replay** › ligue **Replay sempre ligado** (60 s).
   - Na sala, o botão Clipe ganha o ponto vermelho e aparece "Replay 60 s".
   - **2 PCs:** o outro PC vê o ícone de replay no seu canal e "Replay ligado: …" no topo da sala.
2. Fale no microfone e espere 20 s. Clique no botão **Clipe**.
   - Em alguns segundos: aviso "Clipe de N s salvo" e um bipe.
3. Abra **Clipes** (ícone de filme no topo). O clipe novo está em primeiro.
   - **Mostrar na pasta** abre o Explorer em `Vídeos\Stackcall` com o arquivo marcado.
4. Abra o MP4 no player do Windows.
   - A faixa 1 tem jogo, call e a sua voz.
   - A faixa 2 tem só as vozes.
5. Na galeria, escolha um clipe e clique em **Apagar** › **Apagar**. Ele some da lista e vai para a Lixeira do Windows.
6. Desligue o microfone (M) e salve outro clipe: a sua voz não deve estar no trecho com o microfone desligado.
7. Desligue o replay em Configurações: o ponto vermelho some e **Clipe** avisa "Ligue o replay antes de salvar um clipe."

## 4. Janela quem fala

1. Configurações › **Janela quem fala** › **Mostrar a janela**: Ligada.
   - Uma janela transparente aparece no canto escolhido do monitor principal, com uma linha por pessoa da sala.
2. Fale: o seu nome acende em lima.
3. Troque o canto. A janela pula para o canto novo.
4. Troque **Tamanho** entre Pequeno, Médio e Grande com a janela aberta: ela muda na hora, sem piscar nem fechar.
5. Troque **O que mostrar** para **Só quem fala**: a janela encolhe para quem está falando.
6. Abra um jogo em **janela sem borda**. A janela fica por cima e o clique passa através dela.
7. Use o atalho, se tiver definido um em Atalhos, para esconder e mostrar.

## 5. Quem me ouve (**2 PCs**)

1. Na janela Você, veja "N te ouvem". Com o PC B na sala, deve ser 1.
2. No PC B, abaixe o seu volume para 0 ("Silenciar para mim").
   - No PC A, continua **1 te ouve**. Ninguém descobre o silenciar para mim.
3. No PC B, ligue **Silenciar tudo** (fone).
   - No PC A, cai para **0** e a lista mostra "som desligado" para o PC B.

## 6. Sala do mapa do CS2

1. Configurações › **Mapa do CS2** › **Instalar integração**. Confira o caminho mostrado e confirme. Deve aparecer "● instalada".
2. Ligue **Sala do mapa**. Feche e abra o CS2.
3. Entre na sala **CS** do Stackcall. No CS2, entre numa partida (pode ser contra bots).
   - Ao escolher o time, o Stackcall vai sozinho para **CS · CT** ou **CS · TR**.
   - **2 PCs:** o PC do mesmo time cai na mesma sub-sala. O outro time não aparece nas abas, e as telas dele não ficam visíveis.
4. Troque de time no CS2: o Stackcall troca de sub-sala.
5. Saia da partida (volte ao menu): o Stackcall volta para a sala **CS**.
6. Se você estava transmitindo, a transmissão para na troca de sala (esperado).

## 7. Jogo na presença

1. Configurações › **Perfil** › **Mostrar o jogo que estou jogando**: ligado. Abra o CS2.
   - Em até 30 s: "Agora: Counter-Strike 2".
   - **2 PCs:** o outro PC vê "jogando Counter-Strike 2" no seu canal e no saguão.
2. Desligue a opção: o "jogando …" some do outro PC em até 2 min.

## 8. O que anotar

- Qual passo falhou, a mensagem que apareceu e o horário.
- Para o item 2, a resolução que o palco mostrou.
- Para o item 3, o tamanho e a duração do MP4.

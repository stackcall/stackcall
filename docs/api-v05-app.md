# Contrato Tauri da v0.5

Os argumentos externos dos comandos seguem o padrão camelCase do `invoke`. Os campos dentro de `args` e `config` usam os nomes da tabela. Os comandos retornam uma mensagem em português em caso de erro.

## Som do jogo e clipes

O replay começa desligado. A interface pode guardar a preferência e reaplicá-la ao abrir o app.

- `iniciar_transmissao({ args })` aceita `args.game_audio: boolean`. Em uma janela, captura o som da árvore do PID da janela. Em um monitor, captura a saída do PC com a árvore do Stackcall excluída. A interface pode oferecer **Som do jogo** nos dois tipos de fonte. O antigo `args.audio_pid` continua aceito para janelas se `game_audio` estiver ausente.
- `replay_definir({ config })` configura o buffer da sessão. `config: null` desliga. Para ligar, envie `{ segundos: 30 | 60 | 120, sempre: boolean, fonte?: string, resolucao?: "720p" | "1080p" | "1440p" | "4k", fps?: 30 | 60, kbps?: number, encoder?: "auto" | "qsv" | "nvenc" | "amf" }`. Com `sempre: true`, passe uma `fonte` de `listar_fontes` para a captura fora do ar. Os padrões são 1080p, 60 FPS, 12.000 kbps e `auto`. A captura local não amplia a fonte. Durante a transmissão, o replay usa a fonte, o codec e a qualidade da transmissão. A troca entre captura local e transmissão começa um novo buffer.
- `replay_microfone({ ativo: boolean, dispositivo?: string })` informa se o microfone realmente está aberto, incluindo mute, silenciar tudo, push-to-talk, desconexão e troca de sala. Começa fechado. Use o rótulo do dispositivo de entrada como aparece no Windows. Quando o rótulo é omitido, o núcleo usa o dispositivo de comunicação padrão do Windows. Se o nome não for encontrado, o núcleo avisa e mantém a voz local fora do clipe.
- `replay_salvar()` pede a gravação de um MP4 e `replay_atual()` retorna o estado efetivo como `boolean`. Associe o atalho global `salvarClipe` ao `replay_salvar` na borda `pressionado` do evento `atalho`.
- `stackcall-replay` emite `{ event: "state", ativo: boolean }`, `{ event: "saved", caminho: string, duracao: number, tamanho: number }` ou `{ event: "error", motivo: string }`. A duração está em segundos e o tamanho em bytes. O MP4 fica em **Vídeos/Stackcall**, com uma faixa estéreo AAC que reúne jogo, call e microfone aberto e outra que isola as vozes da call e o microfone.
- A duração disponível pode ser menor enquanto o buffer enche ou ao alcançar o limite compartilhado de 180 MiB de amostras. O início é alinhado a um quadro-chave. Salvar um clipe reaproveita as mesmas amostras do buffer sem duplicá-las em RAM.
- Ao conectar ou reconectar à sala, leia `replay_atual()`. Para cada mudança efetiva de estado, chame `localParticipant.setAttributes({ "stackcall.replay": ativo ? "1" : "" })` no participante de voz. Use `"1"` para indicar replay ativo aos demais. O participante `:tela` transmite mídia com um token distinto do participante de voz.

## Faixa leve

Envie um pacote de dados confiável no tópico `stackcall.tela-leve` com UTF-8 JSON `{ "tela": "<identidade completa do participante :tela>", "assistir": true }`. Repita a cada 20 s enquanto mantiver o pedido e envie `assistir: false` ao sair do modo leve.

No app que está transmitindo, receba o pacote no participante de voz. Confira que `tela` corresponde à sua transmissão e repasse com `mudar_faixa_leve({ id, participante, assistir })`. `id` é o mesmo de `iniciar_transmissao` e `participante` é a identidade do remetente informada pelo LiveKit. O núcleo remove pedidos de quem saiu da sala ou deixou de confirmar por 45 s.

A faixa de vídeo se chama `screen-low` e usa 720p30, H.264 e cerca de 1.500 kbps. Substitua a assinatura do vídeo principal pela leve quando ela aparecer. Continue assinando a mesma faixa de áudio.

Se o segundo codificador falhar, o evento local `stackcall-stream` inclui `{ event: "light_error", id: string, reason: string }`. A faixa principal pode continuar e quem assiste deve manter ou recuperar a assinatura principal caso `screen-low` não apareça ou seja removida.

## Janela de falantes

- `falantes_abrir()` mostra uma janela transparente de 320 × 96 pixels lógicos, no topo e com cliques passando por ela. O rótulo é `falantes` e ela carrega `index.html?falantes=1`. A interface renderiza essa janela e transmite os falantes ativos para ela pelo evento que escolher.
- `falantes_fechar()` fecha a janela. `falantes_posicionar({ x, y })` move e salva a posição em pixels físicos na área de trabalho virtual, incluindo coordenadas negativas. Pode ser chamado quando a janela estiver fechada.
- Use em jogos em janela ou sem borda. Tela cheia exclusiva pode ocultar janelas comuns do Windows.

## GSI do CS2 e presença

- `gsi_cs2_localizar()` retorna o caminho do arquivo GSI a ser criado ou `null` se não encontrou a instalação. Exiba o caminho e confirme com a pessoa antes de chamar `gsi_cs2_instalar({ confirmado: true })`. O comando retorna o caminho gravado. O CS2 carrega a configuração ao iniciar. [Game State Integration da Valve](https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Game_State_Integration)
- `stackcall-gsi` emite `{ time: "CT" | "TR" | null, fase: string | null }`. A fase vem de `round.phase`, com `map.phase` como reserva. O endpoint local usa uma porta e um token próprios, persistidos para funcionar após reiniciar o app.
- `presenca_jogo_atual({ ativa: boolean })` retorna `{ executavel: string, nome: string }` ou `null`. Chame ao ativar a presença e a cada 30 s enquanto ela estiver ativa. Pare o agendamento ao desativar. Com `ativa: false`, o comando retorna `null` sem consultar o sistema. O retorno nunca inclui o caminho do executável.

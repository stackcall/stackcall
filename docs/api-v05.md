# Contrato da API Stackcall 0.5

As rotas novas usam `Authorization: Bearer <sessao>` do aparelho e o limite geral de requisições do porteiro. Corpos JSON usam `Content-Type: application/json`. Horários de expiração são segundos Unix. A resposta de `GET /api/pessoas` continua sendo uma lista.

## Moderação da sala

Somente dono e admin. Membro recebe `403`. Todas as rotas usam `POST /api/salas/{sala}/moderacao/{acao}`.

| Ação | Corpo | Resposta |
|---|---|---|
| `mover` | `{"usuario_id":"…","destino_id":"…"}` | `204` quando o LiveKit move a voz, ou `202` quando o app precisa reconectar |
| `silenciar` | Sem corpo ou `{}` | `204` após silenciar as faixas de microfone publicadas. A pessoa pode religar o microfone. |
| `retirar` | `{"usuario_id":"…"}` | `204`. Desconecta voz e tela da sala. A sessão do aparelho e o acesso ao grupo continuam válidos. |

`400` indica parâmetros inválidos, `404` indica sala ou usuário desconhecido (ou voz ausente ao mover) e `502` indica falha do SFU. O porteiro grava autor, ação, sala, alvo, destino e resultado no SQLite.

O porteiro chama `MoveParticipant` primeiro. A edição aberta do LiveKit 1.13.11 expõe o RPC, mas [o gerenciador responde “not implemented”](https://github.com/livekit/livekit/blob/v1.13.11/pkg/service/roommanager.go). Nesse caso, o porteiro desconecta voz e tela da origem e o perfil da própria pessoa em `GET /api/pessoas` recebe `mudanca_sala: {"id":17,"origem_id":"…","destino_id":"…","expira_em":…}` por até 60 s. Mantenha a consulta de presença após `PARTICIPANT_REMOVED` e lembre a sala da desconexão. Deduplique por `id` e reconecte com o fluxo normal de token se a origem bater com a sala da qual a pessoa foi desconectada e ela ainda estiver fora da voz. Após um movimento nativo, o app deve parar a transmissão vinculada à sala anterior.

## Jogo na presença

`PUT /api/eu/jogo` recebe `{"jogo":"Counter-Strike 2"}` e retorna `204`. O nome tem até 60 caracteres após retirar espaços nas pontas e deve ser livre de caracteres de controle. Envie `{"jogo":""}` para limpar. O app deve renovar enquanto o jogo continuar aberto, por exemplo a cada 60 s. Cada perfil da lista de `GET /api/pessoas` recebe `jogo`, com o nome ou `null` após 120 s sem renovação. A presença de jogo pode aparecer mesmo quando a pessoa está fora da voz.

## Chamar para jogar

`POST /api/chamar` recebe `{"sala_id":"…","mensagem":"Bora?"}` e retorna `201` com `{id,sala_id,mensagem,expira_em}`. A mensagem é opcional, tem até 120 caracteres após retirar espaços nas pontas e deve ser livre de caracteres de controle. O limite por pessoa é uma chamada a cada 60 s, somando todos os aparelhos. O excesso recebe `429`.

Recebem o chamado os amigos que o remetente adicionou e que estavam em alguma sala de voz quando o convite foi emitido. No `GET /api/pessoas` de cada destinatário, o perfil do remetente traz `chamados`, uma lista desses objetos de resposta. A lista fica vazia quando não há convites para a sessão solicitante. Os chamados reaparecem durante 120 s para tolerar falhas de rede. Deduplique notificações por `id` e use `sala_id` no fluxo de entrada ao aceitar.

## Sub-salas do CS2

1. O app lê o time no GSI local. Para `CT`, envie `POST /api/salas/{pai_id}/cs2/token` com `{"time":"ct"}`. Para `T`, envie `{"time":"tr"}`. O porteiro devolve `{sala_id,url,token,screen_token}`. Time desconhecido recebe `422`, pai inexistente recebe `404`.
2. Pare a transmissão se houver, desconecte da sala atual e conecte com o token recebido. O LiveKit abre a sub-sala na primeira conexão. Quem tem o mesmo pai e time recebe a mesma `sala_id`.
3. `GET /api/salas` lista as sub-salas ocupadas abaixo da sala pai, com `pai_id` e `time` (`ct` ou `tr`). Nas salas fixas, ambos são `null`. Para entrar por seleção manual ou chamado, use `POST /api/salas/{sala_id}/token`, que também devolve a sala efetiva.
4. Ao sair do time ou da partida, volte à sala pai pelo fluxo normal. A sub-sala some da lista quando fica vazia e o LiveKit a fecha após o prazo de saída (20 s, verificado periodicamente pelo SFU). A sala pai e os dados do grupo continuam disponíveis.

O time informado escolhe o destino. A detecção do GSI é feita pelo app e não serve como autorização para entrar na sub-sala.

## LiveKit em suspensão

Ao pedir um token de sala ou de sub-sala com o recurso habilitado, o app pode receber `503` com `{"erro":"livekit_acordando"}` e `Retry-After: 1`. Mostre “Acordando o servidor de voz…” e repita o mesmo POST a cada 1 s, com prazo total de 20 s e cancelamento se a pessoa desistir. Com `200`, prossiga com a conexão. Se o prazo vencer, mostre a falha e permita nova tentativa. Presença, lista de salas e saúde seguem disponíveis enquanto a voz dorme.

## Quem me ouve

O app publica no participante de voz o atributo LiveKit `stackcall.ouve.v1`, cujo valor é uma string JSON, por exemplo `["<id-da-pessoa-a>","<id-da-pessoa-b>"]`. Liste as identidades dos participantes de voz cujas faixas de microfone estão assinadas e com reprodução local habilitada e volume acima de zero. Publique `[]` ao ensurdecer ou quando não ouvir ninguém.

Para montar a lista “Quem me ouve”, procure nos participantes remotos do canal os atributos que contêm a identidade de voz local. Ignore identidades de tela (sufixo `:tela`) e atributos ausentes ou inválidos. Recalcule ao mudar assinatura, saída de som, ensurdecimento ou volume, agrupando mudanças próximas antes de publicar. O valor é declarado por cada cliente e serve à interface. O token de voz já autoriza a pessoa a atualizar os próprios atributos.

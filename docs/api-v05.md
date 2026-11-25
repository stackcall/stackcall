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

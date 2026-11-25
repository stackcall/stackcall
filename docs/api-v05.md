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

## Cargos do grupo

`PUT /api/pessoas/{id}/cargo` recebe `{"cargo":"admin"}` ou `{"cargo":"membro"}`. Só o dono pode alterar o cargo de outra pessoa ativa. A rota devolve `204`, inclusive quando a pessoa já tem o cargo pedido. `403` indica falta de permissão ou tentativa de alterar o cargo do dono. `404` indica que a pessoa está ausente do grupo. Valores fora de `admin` e `membro` recebem `422`.

O cargo atualizado aparece em `papel` no `GET /api/pessoas`. A alteração e o registro de autor e alvo no log de moderação são gravados na mesma transação. O log usa as ações `promover_admin` e `rebaixar_membro` e deixa a sala vazia por se tratar do grupo inteiro.

## Jogo na presença

`PUT /api/eu/jogo` recebe `{"jogo":"Counter-Strike 2"}` e retorna `204`. O nome tem até 60 caracteres após retirar espaços nas pontas e deve ser livre de caracteres de controle. Envie `{"jogo":""}` para limpar. O app deve renovar enquanto o jogo continuar aberto, por exemplo a cada 60 s. Cada perfil da lista de `GET /api/pessoas` recebe `jogo`, com o nome ou `null` após 120 s sem renovação. A presença de jogo pode aparecer mesmo quando a pessoa está fora da voz.

## Cutucar

`POST /api/cutucar` recebe `{"para":"<id da pessoa>","recado":"Oi!"}` e retorna `204` quando aceita. O recado pode ser omitido ou vazio. Ele tem até 80 caracteres, sem caracteres de controle, e deve aparecer como texto simples. Só é possível cutucar outra pessoa ativa do mesmo grupo, mesmo fora da voz.

`GET /api/eu/cutucadas` retorna `{"receber":"todos"}` por padrão, permitindo cutucadas de qualquer outra pessoa do grupo. `PUT /api/eu/cutucadas` recebe o mesmo objeto e retorna `204`. Os valores válidos são `todos`, `amigos` e `ninguem`. O modo `amigos` usa a lista do destinatário. A preferência e a amizade são verificadas no envio e na consulta de entrega.

O perfil da própria sessão em `GET /api/pessoas` traz `cutucadas`. Cada item tem `{id,de,recado,criado_em}`, com `de` igual ao ID do remetente e `criado_em` em segundos Unix. Os outros perfis omitem o campo. As cutucadas expiram em 120 s e são consumidas pela primeira consulta do destinatário, inclusive entre aparelhos. Uma resposta perdida após o consumo não é reentregue.

O limite é de uma cutucada a cada 30 s para o mesmo destinatário e dez por minuto por remetente, somando todos os aparelhos. `429` indica excesso. `400` indica ID ou recado inválido, ou envio para si mesmo. `403` indica que a preferência bloqueou o envio e `404` indica destinatário ausente do grupo. Uma preferência inválida recebe `422`.

## Sub-salas do CS2

1. O app lê o time no GSI local. Para `CT`, envie `POST /api/salas/{pai_id}/cs2/token` com `{"time":"ct"}`. Para `T`, envie `{"time":"tr"}`. O porteiro devolve `{sala_id,url,token,screen_token}`. Time desconhecido recebe `422`, pai inexistente recebe `404`.
2. Pare a transmissão se houver, desconecte da sala atual e conecte com o token recebido. O LiveKit abre a sub-sala na primeira conexão. Quem tem o mesmo pai e time recebe a mesma `sala_id`.
3. `GET /api/salas` lista as sub-salas ocupadas abaixo da sala pai, com `pai_id` e `time` (`ct` ou `tr`). Nas salas fixas, ambos são `null`. Para entrar por seleção manual, use `POST /api/salas/{sala_id}/token`, que também devolve a sala efetiva.
4. Ao sair do time ou da partida, volte à sala pai pelo fluxo normal. A sub-sala some da lista quando fica vazia e o LiveKit a fecha após o prazo de saída (20 s, verificado periodicamente pelo SFU). A sala pai e os dados do grupo continuam disponíveis.

O time informado escolhe o destino. A detecção do GSI é feita pelo app e não serve como autorização para entrar na sub-sala.

## LiveKit em suspensão

O `GET /api/servidor` público inclui `dorme`. Com a suspensão desligada, o valor é `{"ligado":false,"minutos":null,"dormindo":false}`. Quando ligada, `minutos` informa o tempo de inatividade configurado. `dormindo` fica verdadeiro após o controlador confirmar a parada por inatividade e volta a falso quando o despertar começa. Consultar esse estado não acorda o LiveKit.

Ao pedir um token de sala ou de sub-sala com o recurso habilitado, o app pode receber `503` com `{"erro":"livekit_acordando"}` e `Retry-After: 1`. Mostre “Acordando o servidor de voz…” e repita o mesmo POST a cada 1 s, com prazo total de 20 s e cancelamento se a pessoa desistir. Com `200`, prossiga com a conexão. Se o prazo vencer, mostre a falha e permita nova tentativa. Presença, lista de salas e saúde seguem disponíveis enquanto a voz dorme.

## Quem me ouve

O app publica no participante de voz o atributo LiveKit `stackcall.ouve.v1`, cujo valor é uma string JSON, por exemplo `["<id-da-pessoa-a>","<id-da-pessoa-b>"]`. Liste as identidades de todos os outros participantes de voz da sala. Publique `[]` enquanto "silenciar tudo" estiver ligado. O volume de cada pessoa, inclusive o zero de "silenciar para mim", não entra na conta e não é publicado: quem foi silenciado só para alguém não descobre (decisão de 25/11/2026).

Para montar a lista “Quem me ouve”, procure nos participantes remotos do canal os atributos que contêm a identidade de voz local. Ignore identidades de tela (sufixo `:tela`) e atributos ausentes ou inválidos. Recalcule quando alguém entra ou sai da sala e ao ligar ou desligar "silenciar tudo", agrupando mudanças próximas antes de publicar. O valor é declarado por cada cliente e serve à interface. O token de voz já autoriza a pessoa a atualizar os próprios atributos.

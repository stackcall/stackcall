# Stackcall aberto: servidor do grupo, convites e self-host (v0.3)

Decidido em 24/11/2026 e simplificado no mesmo dia, a pedido do Filippe: o Stackcall é para grupos pequenos de amigos, não uma rede social. Nada de banco de dados externo nem conta global.

## Ideia central: um servidor = um grupo

- Cada servidor Stackcall é **um grupo de amigos**. O nosso é o da VPS (`https://stackcall.80-190-79-129.sslip.io`): só entra quem o Filippe (ou quem ele autorizar) convidar.
- Outra turma que quiser usar baixa o servidor e hospeda o dela (VPS, PC ou rede local), com um comando. Ela não entra no nosso, e nós não entramos no dela.
- O app fala com vários servidores. Cada um aparece como um grupo na lateral, como "servidores" no Discord, só que cada um é de uma turma.
- Os dados ficam num arquivo SQLite dentro do próprio servidor (é só um arquivo, sem serviço de banco). Backup = copiar o arquivo.

## Como a pessoa entra (sem senha, sem digitar servidor)

1. Alguém do grupo (por padrão, só o dono e os admins) gera um **link de convite** no app e manda no WhatsApp: `https://<servidor>/c/<codigo>`.
2. A pessoa abre o link. A página tenta abrir `stackcall://entrar?servidor=<url>&codigo=<codigo>`; sem o app instalado, mostra o botão de baixar.
3. O app abre, pergunta só o **nome** e entra. O servidor cria o usuário e devolve uma **sessão deste aparelho**, guardada no Credential Manager do Windows. Não existe senha.
4. Na próxima vez, o app já entra sozinho.

Outro aparelho: no app logado, "Entrar em outro aparelho" gera um link de uso único válido por 10 minutos. Perdeu o PC: um admin gera um convite novo e remove o aparelho antigo.

Convite: 128 bits de aleatoriedade, guardado só como hash, validade padrão de 7 dias, limite de usos (padrão 1), revogável. Uso atômico (`UPDATE ... SET usos = usos + 1 WHERE id = ? AND usos < usos_max AND revogado = 0 AND expira_em > agora`).

"Colar link de convite" fica na tela inicial do app, para quem recebeu o link no celular.

## Quem controla o acesso

| Papel | Pode |
|---|---|
| Dono | Tudo; é o primeiro usuário (o script de instalação imprime o convite dele) |
| Admin | Gerar e revogar convites, remover pessoas e aparelhos, criar e renomear salas |
| Membro | Falar, transmitir, assistir, conversar, editar o próprio perfil |

Opção do servidor: "membros também podem convidar" (desligada por padrão). Remover alguém revoga todas as sessões dele na hora e derruba da sala.

## Amigos (como no Fivestack)

Cada pessoa tem a **própria lista de amigos** dentro do servidor: você adiciona 8, outro adiciona 4. A lista serve para: aparecer em cima na lista de pessoas, ver quando o amigo entra numa sala e (depois) mensagem direta. Adicionar amigo não dá acesso a nada: quem decide quem entra no servidor é o convite.

v0.3 entrega a lista (adicionar, remover, ver online). Mensagem direta fica para a v0.4.

## Dados (SQLite no porteiro)

| Tabela | Campos |
|---|---|
| `usuarios` | id, nome, papel (`dono`/`admin`/`membro`), avatar, banner, bio, tema_perfil, cor, criado_em, removido_em |
| `sessoes` | id, usuario_id, token_hash, nome_aparelho, criado_em, ultimo_uso |
| `convites` | id, criado_por, codigo_hash, expira_em, usos_max, usos, revogado |
| `logins_aparelho` | id, usuario_id, codigo_hash, expira_em, usado |
| `amizades` | usuario_id, amigo_id, criado_em |
| `salas` | id, nome, ordem |
| `mensagens` | id, sala_id, usuario_id, texto, criado_em |
| `config` | chave, valor (nome do servidor, membros_convidam) |

## API

Autenticação por `Authorization: Bearer <sessao>` (token aleatório; o servidor guarda só o hash). Rate limit por IP (/64 no IPv6): 10/min em convite e login de aparelho, 30/min no resto.

| Rota | Faz |
|---|---|
| `GET /api/servidor` | Nome, versão, versão mínima do app (público) |
| `GET /api/convites/:codigo` | Prévia pública: nome do servidor e quem convidou |
| `POST /api/convites/:codigo/aceitar` | Body `{nome, aparelho}` → `{sessao, usuario}` |
| `POST /api/aparelhos/link` · `POST /api/aparelhos/entrar` | Gera link de outro aparelho / entra com ele |
| `POST /api/sair` | Revoga a sessão atual |
| `GET /api/eu` · `PATCH /api/eu/perfil` · `PUT /api/eu/avatar` · `PUT /api/eu/banner` | Eu e meu perfil |
| `GET /api/pessoas` | Membros com presença e se é amigo |
| `POST /api/amigos/:id` · `DELETE /api/amigos/:id` | Lista de amigos |
| `GET /api/salas` · `POST`/`PATCH`/`DELETE` (admin) | Salas |
| `POST /api/salas/:id/token` | Token LiveKit (identity = id do usuário, sala = id da sala) e token da tela (`<identity>:tela`, só `screen_share` e `screen_share_audio`, 1 h) |
| `POST /api/convites` · `GET /api/convites` · `DELETE /api/convites/:id` (admin) | Convites |
| `DELETE /api/pessoas/:id` · `DELETE /api/pessoas/:id/aparelhos` (admin) | Remover pessoa ou aparelhos |
| `GET /media/<hash>.webp` | Avatar e banner |
| `/api/rtt`, `/api/upload-test`, `/api/versao-minima-app` | Continuam |
| `GET /c/<codigo>` | Página do convite (HTML simples) |

A prévia devolve `{servidor, convidado_por}`. Convites vencidos, revogados ou esgotados devolvem o mesmo 404. `POST /api/convites` aceita `dias` e `usos_max` opcionais e devolve `{id, codigo, url, expira_em, usos_max}`. A listagem administrativa retorna os metadados sem o código.

`POST /api/aparelhos/link` retorna `{codigo, url, expira_em}`, com deep link `stackcall://aparelho?servidor=<url>&codigo=<codigo>`. `POST /api/aparelhos/entrar` recebe `{codigo, aparelho}` e devolve `{sessao, usuario}`. `GET /api/eu` devolve o perfil diretamente. Horários são segundos Unix.

A origem dos links vem de `SERVIDOR_URL`. `SERVIDOR_NOME` e `MEMBROS_CONVIDAM` configuram o nome e a permissão de convite. `GET /api/servidor` devolve `{nome, versao, versao_minima_app, membros_convidam}`. No log, o link inicial aparece na linha `Convite do dono: <url>`.

`GET /api/salas` retorna uma lista de `{id, nome, ordem}`. Envie `nome` e `ordem` opcional ao criar. Para editar ou excluir use `/api/salas/:id`. Os tokens voltam como `{url, token, screen_token}`.

`GET /api/pessoas` retorna uma lista de perfis com `amigo` e `online` para quem consulta. Online significa estar conectado a uma sala do LiveKit. Adicionar ou remover um amigo retorna 204 e só afeta a própria lista.

A remoção revoga sessões, códigos de aparelho e convites da pessoa e desconecta voz e tela. O dono não pode ser removido e administradores só gerenciam outros usuários com papel de membro. Ao revogar os próprios aparelhos, o dono ou admin mantém a sessão atual. Se o LiveKit estiver indisponível, a remoção devolve 502 após revogar o acesso. Repetir o DELETE tenta desconectar novamente. Em self-host, um JWT do LiveKit já emitido pode autenticar até expirar.

Migração do nosso servidor: na primeira subida da v0.3, o `CONVITE` antigo sai e o porteiro imprime no log um convite de dono (uso único, 7 dias). O Filippe entra com ele e gera os convites dos amigos.

## Perfil personalizável (como no Fivestack)

- Foto, banner, bio (160 caracteres), tema do perfil (**Papel**, **Noite**, **Lima**) e cor de destaque. O tema vale no cartão de perfil e no canal da pessoa na mesa.
- O app recorta e reduz antes de enviar (foto 256×256, banner 1200×400, WebP). O porteiro aceita só PNG, JPEG ou WebP pelo conteúdo, recusa SVG, limita a 1 MB, regrava a imagem sem metadados e serve com cache longo e nome por hash. Cada pessoa só altera o próprio perfil.

## Leve como regra (não pesar o jogo)

O app compete com o CS pela máquina. Ele usa Tauri: interface no WebView2 que o Windows já tem (o Discord carrega um Chromium inteiro via Electron) e backend em Rust. Metas medidas em cada release:

| Situação | Meta |
|---|---|
| Aberto, parado, na bandeja | CPU < 0,3 %, memória total (app + WebView2) < 150 MB |
| Na voz, sem assistir | CPU < 2 % num i5/Ryzen 5 de 4 anos |
| Transmitindo 1080p60 | Encode na GPU (NVENC/AMF/QSV); CPU do app < 5 %; o núcleo Rust só existe enquanto transmite |
| Assistindo | Decodificação por hardware; só decodifica a tela que está visível |

Regras:
1. Sem laço de consulta (polling) na interface; tudo por evento. Ping real pelas estatísticas do WebRTC a cada 2 s.
2. Janela minimizada ou na bandeja: para animações, vídeo e medidores.
3. **Modo jogo**: com um jogo em tela cheia em primeiro plano, o app para tudo que é visual e baixa a prioridade do próprio processo. A voz continua.
4. Animação só com `transform` e `opacity`; com movimento reduzido, nenhuma.
5. Imagens pequenas e em cache; lista de mensagens virtualizada; nada de biblioteca grande para coisa pequena.
6. `scripts/medir-leveza.ps1` mede CPU e memória por 60 s e grava em `docs/medidas/`.

## Ícone

`docs/marca/icone.svg`: mesmo desenho do ícone do Fivestack (quadrado arredondado com barras inclinadas empilhadas), em tinta `#111`, barras papel, a do meio lima (quem fala) e a de baixo vermelha (no ar). `npx tauri icon` gera os tamanhos do app, do atalho e do instalador NSIS.

## Self-host em um comando

```bash
curl -fsSL https://raw.githubusercontent.com/stackcall/stackcall/main/infra/instalar.sh | bash
```

O script (leia antes de rodar; está documentado no README):
1. Confere Docker e Docker Compose.
2. Pergunta o domínio; sem domínio, usa `<ip>.sslip.io`.
3. Gera chave e segredo do LiveKit e o `.env` com permissão 600.
4. Sobe `livekit`, `porteiro` e `caddy` (TLS automático). Mostra as portas a abrir: 443/tcp, 7881/tcp, 7882/udp, 3478/udp.
5. Imprime o link de convite do dono.

Windows (`infra/instalar.ps1`, Docker Desktop): modo local para jogar em rede de casa, sem TLS, pelo IP da rede.

## Licença

**AGPL-3.0** (decidido em 24/11/2026; arquivo `LICENSE`). Motivo: é um servidor que outras pessoas vão hospedar. A AGPL obriga quem oferecer uma versão modificada a outras pessoas pela rede a publicar o código, então ninguém fecha o projeto e vende como serviço. Para quem só baixa e usa com os amigos, não muda nada. O Fluxer usa a mesma. SignPath (assinatura grátis do instalador) aceita.

Antes de abrir o repositório: gitleaks no histórico inteiro (feito em 24/11, só falso positivo), revisar `docs/` por dado pessoal, trocar os segredos que já passaram por máquina de desenvolvimento.

## Riscos

- **Banda da VPS**: 200 Mbit/s compartilhados com o Fivestack. Servidor só por convite e limite de 100 Mbit/s no app seguram.
- **Conteúdo**: nosso servidor é fechado por convite, sem cadastro público. Cada self-host responde pelo próprio servidor. Isto não é parecer jurídico.

## Ordem de entrega

1. Porteiro: o modelo acima, migração, `infra/instalar.sh` (thread Codex).
2. App: convite por link e deep link, lista de servidores, amigos, perfil, modo jogo, ícone e o design Pôster (skill `padrao-pessoal`; thread Claude).
3. Release v0.3.0.

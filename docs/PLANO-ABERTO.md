# Stackcall aberto: contas, grupos e self-host (v0.3)

Decidido em 24/11/2026. Objetivo: qualquer pessoa baixa o app e entra sem digitar endereço de servidor nem código de convite. Quem quiser hospeda o próprio servidor com um comando, como no Fluxer. O código vira open source quando o repositório abrir.

## Como a pessoa entra

1. Instala o app. O app já vem apontando para a **instância oficial** (`https://stackcall.80-190-79-129.sslip.io`). Não existe campo "servidor" na tela de login.
2. Tela de login com duas saídas:
   - **Entrar com a Steam** (recomendado para a galera de jogo). OpenID 2.0 da Steam: não pede chave nem segredo, só a URL pública da instância. Nome e avatar vêm da Steam quando a instância tiver `STEAM_API_KEY` (opcional).
   - **Criar conta com nome e senha.** Serve para quem não tem Steam e para instância em rede local sem internet. Senha com argon2id. Sem e-mail na v0.3.
3. Depois de entrar: cria um grupo ou abre um link de convite.

O login abre o navegador do sistema e volta pelo deep link `stackcall://login?...` (padrão de app desktop; o WebView do app nunca vê a senha da Steam).

## Convites sem código digitado

- Convite é um link: `https://<instancia>/c/<codigo>`. A página do link tenta abrir `stackcall://entrar?instancia=<url>&codigo=<codigo>` e, se o app não estiver instalado, mostra o botão de baixar.
- No app, o deep link entra direto no grupo. Se a instância do link não for a oficial, o app pergunta "Entrar no servidor X?" e guarda a instância. É assim que alguém entra num servidor self-hosted sem digitar nada.
- Convite tem dono, validade (padrão 7 dias), limite de usos (padrão 10) e pode ser revogado. Código com 128 bits de aleatoriedade, guardado só como hash.
- "Colar link de convite" continua existindo na tela inicial, para quem recebeu o link no celular.

## Servidores (instâncias)

- Lista de instâncias no app: a oficial vem fixa; outras entram por deep link ou em Configurações > Avançado > "Adicionar servidor" (URL). Uma sessão por instância.
- Cada instância informa em `GET /api/instancia`: nome, versão, modo de cadastro (`aberto`, `convite`, `fechado`), se aceita Steam, versão mínima do app.
- **Instância oficial começa em modo `convite`**: só cria conta quem chegou por um link de convite. Protege a VPS (banda) até medir o uso real. Muda para `aberto` com uma variável.

## Modelo de dados (SQLite no porteiro)

| Tabela | Campos principais |
|---|---|
| `usuarios` | id, nome_exibicao, steam_id (único, opcional), senha_hash (opcional), avatar_url, criado_em, papel_instancia (`admin`/`membro`) |
| `sessoes` | id, usuario_id, token_hash, criado_em, expira_em, ultimo_uso, nome_aparelho |
| `grupos` | id, nome, dono_id, criado_em |
| `membros` | grupo_id, usuario_id, papel (`dono`/`admin`/`membro`), entrou_em |
| `salas` | id, grupo_id, nome, ordem |
| `convites` | id, grupo_id, criado_por, codigo_hash, expira_em, usos_max, usos, revogado |
| `mensagens` | já existe ou entra aqui: id, sala_id, usuario_id, texto, criado_em |

O primeiro usuário da instância vira `admin`. Uso de convite é atômico (`UPDATE ... SET usos = usos + 1 WHERE id = ? AND usos < usos_max AND NOT revogado AND expira_em > now`).

## API (contrato entre porteiro e app)

Autenticação por `Authorization: Bearer <sessao>`. Sessão de 30 dias, renovada no uso, guardada no cofre do sistema pelo app (Tauri: `keyring`/Credential Manager), nunca em `localStorage`.

| Método e rota | Faz |
|---|---|
| `GET /api/instancia` | Dados públicos da instância |
| `GET /api/auth/steam/iniciar?retorno=stackcall` | Redireciona para a Steam |
| `GET /api/auth/steam/retorno` | Confere a assinatura OpenID com a Steam, cria ou acha o usuário e redireciona para `stackcall://login?sessao=<token-de-uso-unico>` |
| `POST /api/auth/troca` | Troca o token de uso único (60 s) pela sessão. O token nunca fica na URL depois disso |
| `POST /api/auth/cadastro` | nome + senha (+ código de convite se a instância exigir) |
| `POST /api/auth/entrar` | nome + senha |
| `POST /api/auth/sair` | Revoga a sessão |
| `GET /api/eu` | Usuário e grupos |
| `POST /api/grupos` · `GET /api/grupos/:id` | Cria / lê (só membro) |
| `POST /api/grupos/:id/salas` · `PATCH`/`DELETE` | Dono e admin |
| `POST /api/grupos/:id/convites` · `DELETE /api/convites/:id` | Cria / revoga |
| `GET /api/convites/:codigo` | Prévia pública: nome do grupo e quem convidou |
| `POST /api/convites/:codigo/aceitar` | Entra no grupo |
| `POST /api/salas/:id/token` | Devolve o token LiveKit da pessoa e o da tela (`<identity>:tela`, só `screen_share` e `screen_share_audio`, 1 h). Identity = id do usuário; sala LiveKit = id da sala. Só membro do grupo |
| `/api/rtt`, `/api/upload-test`, `/api/versao-minima-app` | Continuam |

O login Steam está disponível em origens HTTPS. Antes de abrir `/api/auth/steam/iniciar`, o app gera e guarda um `verificador` de 32 bytes aleatórios em hexadecimal minúsculo. O URL inclui `retorno=stackcall`, `desafio` (SHA-256 em hexadecimal do texto do verificador) e `codigo` opcional para novos usuários. Em `POST /api/auth/troca`, o app envia `{sessao, verificador, nome_aparelho?}` para a instância em que iniciou o login e descarta o verificador. O código devolvido no deep link só pode ser trocado com esse verificador.

`GET /api/instancia` retorna `{nome, versao, modo_cadastro, steam, versao_minima_app}`. A versão mínima é 0.3.0, que usa as sessões e os tokens por sala.

Cadastro e entrada recebem JSON com `nome`, `senha` e `nome_aparelho` opcional. Cadastro também aceita `codigo`. O nome de login ignora maiúsculas e minúsculas, a senha tem de 8 a 256 bytes e a sessão volta como `{sessao, expira_em}`. `GET /api/eu` retorna `{usuario, grupos}`. Os horários da API são segundos Unix.

Grupos e salas recebem `{nome}`. Salas também aceitam `ordem` e são editadas ou removidas em `/api/salas/:id`. A leitura do grupo retorna `salas`, `membros`, o `papel` de quem consulta e os metadados dos convites que pode revogar. Qualquer membro cria um convite em `/api/grupos/:id/convites` com `dias` e `usos_max` opcionais e recebe `{id, codigo, url, expira_em, usos_max}`. O autor, o dono e os admins do grupo podem revogar. A prévia retorna `{grupo, convidado_por}` e o aceite retorna `{grupo_id}`. Convites expirados, revogados ou esgotados retornam 404 com a mesma mensagem.

Toda rota com `:id` confere se o usuário é membro do grupo dono do objeto (sem IDOR). Rate limit por IP (/64 no IPv6) nas rotas de auth e convite: 10/min em `entrar`/`cadastro`, 30/min no resto.

Na primeira subida da v0.3 com SQLite vazio, o porteiro cria o grupo Galera com a sala Geral e registra no log um link de uso único válido por 30 dias. O primeiro usuário é admin da instância e dono do grupo. Em modo `fechado`, só o convite inicial pode criar essa primeira conta. Em modo `aberto`, se o primeiro cadastro não usar o convite inicial, ele é revogado na mesma transação. Os dois tokens da sala voltam como `{url, token, screen_token}`.

## Perfil personalizável (como no Fivestack)

- Foto de perfil, banner, bio curta (160 caracteres), tema do perfil e cor de destaque.
- Temas do perfil iguais aos do Fivestack: **Papel** (padrão, segue o tema de quem vê), **Noite** e **Lima**. O tema vale no cartão de perfil e no canal da pessoa na mesa.
- Upload: o app recorta e reduz antes de enviar (foto 256×256, banner 1200×400, WebP). O porteiro aceita só PNG, JPEG ou WebP, confere o tipo pelo conteúdo (não pela extensão), recusa SVG, limita a 1 MB, regrava a imagem (remove metadados e EXIF) e serve com `Cache-Control` longo e nome por hash.
- Rotas: `PATCH /api/eu/perfil`, `PUT /api/eu/avatar`, `PUT /api/eu/banner`, `GET /media/<hash>.webp`. Usuário só altera o próprio perfil.
- Avatar com Steam: usa o da Steam até a pessoa enviar outro.

`PATCH /api/eu/perfil` aceita `bio`, `tema` (`papel`, `noite` ou `lima`) e `cor_destaque` (`#RRGGBB` ou `null` para limpar). Os dois uploads recebem os bytes da imagem diretamente no corpo. As rotas de edição devolvem o perfil atualizado. Resolva os caminhos `/media/…` contra a origem da instância. O porteiro limita a entrada a 2048 pixels por lado e reduz a mídia para caber nas dimensões do perfil.

## Leve como regra (não pesar o jogo)

O app compete com o CS pela máquina. Ele usa Tauri: interface no WebView2 que o Windows já tem (o Discord carrega um Chromium inteiro via Electron) e backend em Rust. Metas medidas em cada release:

| Situação | Meta |
|---|---|
| Aberto, parado, na bandeja | CPU < 0,3 %, memória total (app + WebView2) < 150 MB |
| Na voz, sem assistir | CPU < 2 % num i5/Ryzen 5 de 4 anos |
| Transmitindo 1080p60 | Encode na GPU (NVENC/AMF/QSV); CPU do app < 5 %; o núcleo Rust só existe enquanto transmite |
| Assistindo | Decodificação por hardware; só decodifica a tela que está visível |

Regras de implementação:
1. Sem laço de consulta (polling) na interface; tudo por evento. Ping real vem das estatísticas do WebRTC a cada 2 s, não por requisição HTTP.
2. Janela minimizada ou na bandeja: para animações, para de desenhar vídeo, para os medidores de nível.
3. **Modo jogo**: quando um jogo em tela cheia está em primeiro plano, o app para tudo que é visual e baixa a prioridade do próprio processo. A voz continua.
4. Animação só com `transform` e `opacity`; com movimento reduzido, nenhuma.
5. Imagens pequenas e em cache (perfil em WebP); lista de mensagens virtualizada; nada de biblioteca grande para coisa pequena.
6. Script `scripts/medir-leveza.ps1` mede CPU e memória por 60 s em cada situação da tabela e grava em `docs/medidas/`. A release só sai com as metas batidas ou com o desvio explicado nas notas.

## Ícone

`docs/marca/icone.svg`: mesmo desenho do ícone do Fivestack (quadrado arredondado com barras inclinadas empilhadas), em tinta `#111`, barras papel, a do meio lima (quem fala) e a de baixo vermelha (no ar). Gera todos os tamanhos com `npx tauri icon docs/marca/icone.svg` e vale para o app, o atalho e o instalador NSIS.

## Self-host em um comando

```bash
curl -fsSL https://raw.githubusercontent.com/stackcall/stackcall/main/infra/instalar.sh | bash
```

O script (lido antes de rodar, documentado no README):
1. Confere Docker e Docker Compose.
2. Pergunta o domínio; sem domínio, usa `<ip>.sslip.io`.
3. Gera chave e segredo do LiveKit e o `.env` com permissão 600.
4. Sobe `livekit`, `porteiro` e `caddy` (TLS automático). Mostra as portas a abrir: 443/tcp, 7881/tcp, 7882/udp, 3478/udp.
5. Imprime o link de convite do primeiro admin.

Também roda na própria máquina (Windows com Docker Desktop ou Linux) para jogar em LAN: modo `--local` sem TLS, só IP da rede.

## Licença e abertura

- Recomendado: **AGPL-3.0**, como o Fluxer. Quem hospedar uma versão modificada para outras pessoas precisa publicar o código. Alternativa: MIT (mais solta). A decisão é do Filippe antes de abrir o repositório; SignPath aceita as duas.
- Antes de abrir: gitleaks no histórico inteiro (feito em 24/11, só falso positivo), revisar `docs/` por dado pessoal, e trocar os segredos que já passaram por máquina de desenvolvimento.

## Riscos

- **Banda da VPS oficial**: 200 Mbit/s compartilhados com o Fivestack. Modo `convite` e limite de 100 Mbit/s no app seguram por enquanto.
- **Conteúdo e moderação**: serviço público de vídeo ao vivo no Brasil tem obrigações (ECA Digital, ANPD, Marco Civil). Instância oficial fica fechada por convite até ter: denúncia, banimento por admin, termos de uso e política de privacidade. Isto não é parecer jurídico.
- **Steam fora do ar**: o login por nome e senha continua funcionando.

## Ordem de entrega

1. Porteiro: contas, sessões, grupos, salas, convites, Steam, perfil e mídia, `/api/instancia`, migração (thread Codex).
2. App: login novo, deep links, lista de instâncias, grupos e salas reais, perfil, modo jogo, ícone e o design Pôster (skill `padrao-pessoal`; thread Claude).
3. `infra/instalar.sh` e README de self-host (thread Codex, depois do 1).
4. Release v0.3.0.

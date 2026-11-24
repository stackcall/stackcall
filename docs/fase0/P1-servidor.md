# Prompt T3: P1 servidor LiveKit e porteiro + P5 latência

Modelo: Codex `gpt-6.1-sol`, esforço medium. Branch: `feat/fase0-servidor`.

---

Você está no repositório `stackcall/stackcall`. Leia antes de começar: `AGENTS.md`, `docs/PLANO.md` (seções 2.3 e 5) e `docs/VERSIONAMENTO.md` (seção 5). Siga as regras do `AGENTS.md`: commits em Conventional Commits, nada de código copiado de projetos AGPL/GPL, nenhum segredo no git.

## Objetivo

Montar a parte de servidor da fase 0, pronta para ser publicada numa VPS:

1. Configuração do `livekit-server` (o servidor de mídia que repassa voz e vídeo).
2. O **porteiro**, um serviço em Rust que entrega tokens do LiveKit.
3. A configuração de proxy do Caddy e o Docker Compose.
4. Um script que mede a latência até o servidor (prova P5).

Você **não** publica nada na VPS. Você entrega os arquivos, os testes e o passo a passo. A publicação é feita depois pelo Claude Code, com aprovação do Filippe.

## Ambiente de destino (para os arquivos, não para acesso)

- VPS Ubuntu 24.04, 4 vCPU, 8 GB, Docker com Compose, Caddy no host já em uso por outros serviços. A VPS tem cerca de 5 GB de RAM livre e porta de 200 Mbit/s.
- Nome público: `stackcall.80-190-79-129.sslip.io`. O Caddy do host tira o certificado.
- Portas públicas permitidas para o Stackcall: 443/tcp (Caddy), 7881/tcp, 7882/udp e 3478/udp. Nenhuma outra.
- Todo container: `mem_limit`, `restart: unless-stopped`, imagem fixada por digest (anote a versão em comentário), portas internas presas em `127.0.0.1`.

## Entregáveis

### 1. `infra/livekit/livekit.yaml`

- `port: 7880` (só local; o Caddy faz o HTTPS e o WebSocket).
- `rtc.tcp_port: 7881`, `rtc.udp_port: 7882` (modo mux: uma porta UDP só), `rtc.use_external_ip: true`.
- TURN embutido só em UDP 3478 nesta fase (`turn.enabled: true`, `turn.udp_port: 3478`, `turn.domain` igual ao nome público). TURN por TLS fica para depois; deixe um comentário explicando.
- Chaves por variável de ambiente (`LIVEKIT_KEYS`), nunca no arquivo.
- Sem Redis (nó único). Comente que o Redis entra se um dia houver mais de um nó.
- Leia a documentação oficial atual do LiveKit (portas, `deployment`) e cite no comentário do arquivo a versão em que se baseou.

### 2. `server/` (crate `porteiro`)

Rust estável, `axum`, `tokio`, `livekit-api` (confira a versão atual no crates.io e fixe). Endpoints:

| Método | Caminho | O que faz |
|---|---|---|
| `GET` | `/api/health` | `200 {"ok":true,"versao":"<versão do crate>"}` |
| `POST` | `/api/token` | Recebe `{"convite":"...","nome":"...","sala":"..."}`. Se `convite` bater com `STACKCALL_CONVITE_DEV` (comparação em tempo constante), devolve `{"url":"wss://.../rtc","token":"<JWT do LiveKit>"}`. O token vale 1 hora, dá `room_join` só na sala pedida e identidade igual ao `nome`. Nome e sala: 1 a 32 caracteres, letras, números, `-` e `_`. |
| `GET` | `/api/rtt` | Resposta mínima e rápida (`204`), para o script de latência. |
| `GET` | `/api/versao-minima-app` | `{"versao_minima_app":"0.0.0"}` (base da seção 5 do VERSIONAMENTO.md). |

- Configuração só por variáveis de ambiente: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_PUBLIC_URL`, `STACKCALL_CONVITE_DEV`, `PORTEIRO_ADDR` (padrão `127.0.0.1:8100`).
- Limite de taxa simples em `/api/token` (por exemplo, 10 por minuto por IP, lendo `X-Forwarded-For` só do proxy local).
- Logs sem segredos: nunca registre o convite nem o token.
- `Dockerfile` multi-stage, imagem final enxuta, usuário não root.
- Testes (`cargo test -p porteiro`): token gerado decodifica com a chave, traz a sala e a identidade certas e expira em 1 hora; convite errado dá `401`; nome inválido dá `400`.
- Isto é um porteiro de fase 0. Contas com senha e convites de verdade entram na fase 1; deixe um `TODO(fase1)` onde couber.

### 3. `infra/caddy/stackcall.caddy`

Bloco para incluir no Caddyfile do host:

- `stackcall.80-190-79-129.sslip.io`
- `/rtc*` → `127.0.0.1:7880` (WebSocket do LiveKit)
- `/api/*` → `127.0.0.1:8100` (porteiro)
- `/updates/*` → pasta estática `/srv/stackcall/updates` (base do updater; pode ficar vazia)
- Cabeçalhos de segurança básicos.

### 4. `infra/docker-compose.yml` e `infra/.env.example`

- Serviços `livekit` (portas 7881/tcp, 7882/udp e 3478/udp públicas; 7880 em `127.0.0.1`) e `porteiro` (`127.0.0.1:8100`).
- `mem_limit`: `livekit` 512m, `porteiro` 64m.
- `.env.example` com todas as variáveis e valores de exemplo. Nunca um segredo real.
- `infra/README.md`: o passo a passo da publicação para o Claude Code seguir:
  - gerar as chaves (`livekit-server generate-keys` ou equivalente);
  - criar o `.env` com permissão 600;
  - incluir o bloco no Caddyfile e recarregar o Caddy;
  - abrir as portas no `ufw`, uma linha por porta;
  - subir o compose;
  - conferir saúde.
  Inclua também como desfazer tudo.

### 5. `scripts/medir-latencia.ps1` (prova P5)

- Faz 30 pedidos a `https://<host>/api/rtt` e mostra mínimo, mediana e p95 em ms.
- Mostra também a latência de um `ping` ICMP ao IP, se disponível.
- Saída em texto e em JSON (`-Json`), para colar em `docs/fase0/resultados.md`.
- PowerShell 5.1 compatível (sem `??`, sem `&&`).

### 6. `docs/fase0/resultados.md`

Modelo de tabela para as medições de todas as provas (P1 a P6), com colunas: prova, máquina, data, comando, resultado, passou (sim/não), observações. Deixe as linhas vazias.

## Como provar que funciona (no seu ambiente)

1. `cargo test -p porteiro` passa.
2. `docker compose -f infra/docker-compose.yml --env-file infra/.env.example config` valida.
3. Se houver Docker disponível: suba o compose localmente com `LIVEKIT_PUBLIC_URL=ws://localhost:7880`, peça um token ao porteiro com `curl` e mostre a resposta (sem colar o token inteiro no PR). Se não houver Docker, diga isso no PR.

## Fora do escopo

- Publicar na VPS ou acessar qualquer servidor.
- Contas, senhas, banco de dados, chat.
- TURN por TLS, Redis, mais de um nó.

## Ao terminar

- Commits pequenos em Conventional Commits.
- Abra o PR para a `main` com: o que foi feito, como testar, o que não foi testado e por quê.
- Não marque nada como "funcionando" sem ter executado.

# Auditoria de segurança: stackcall @ main (9db7ace)

Escopo: leitura do código, sem commits e sem requisição a host externo. gitleaks (1 falso positivo) e `npm audit` (0) já feitos antes. A skill `security-audit` (Cloudflare) existe em `C:\Users\adm\.agents\skills\security-audit`; usei só a metodologia (fronteira de confiança, gate por achado). A skill `security-review` (getsentry) NÃO está instalada como arquivo; apliquei a mesma abordagem por leitura direta.

Gates: confirmado / precisa validar / descartado. Severidade só em confirmado.

## Resumo

Superfície pequena e bem endurecida: hash + `ct_eq`, rótulos validados, XFF só do proxy, limite de upload em stream, CORS fechado, sem shell/fs no Tauri, convite no Credential Manager, container não-root com 64 MB. Os problemas reais estão no modelo de confiança (convite único compartilhado, identidade escolhida pelo cliente) e na cadeia de release. Nada crítico ou alto.

## Achados confirmados

### 1. [MÉDIA] Identidade e sala escolhidas pelo cliente: qualquer portador do convite assume a identidade de outro
- `server/src/main.rs:164-184` (`with_identity(&input.nome)`, `room: input.sala`).
- Cenário: quem tem o convite (inclusive alguém que saiu do grupo e ainda o conhece) pede token com `nome=Alice`. O LiveKit derruba a sessão existente de mesma identity e a nova assume. Com `nome=Alice:tela` publica a "tela da Alice" na sala (o app trata `X:tela` como a tela de X). Com um convite só, não há como atribuir ação a alguém nem revogar uma pessoa.
- Correção: aceitável enquanto o grupo for fechado, mas registrar como risco aceito. Fase 1 já tem TODO (linha 159): convite individual, identity derivada do convite (não do corpo), `:tela` só para a identity dona do convite. Curto prazo: servidor acrescenta sufixo aleatório curto à identity (`Alice#a3f9`) e valida a sala contra allowlist (`geral, cs, filme, madrugada`, hoje só no cliente em `app/src/lib/config.ts:4-9`), em vez de qualquer `[A-Za-z0-9_-]{1,32}`.

### 2. [MÉDIA] Convite único, sem expiração, sem limite de uso, sem revogação
- `main.rs:160-163`, `main.rs:236` (`STACKCALL_CONVITE_DEV`). Troca só por redeploy; token emitido vale 1 h (`TOKEN_TTL`) e não há como cancelá-lo além de remover o participante no LiveKit.
- Decremento atômico / corrida: não aplicável hoje (não há uso contado). Vira requisito com convites individuais: `UPDATE ... SET usos=usos+1 WHERE usos<max AND expira>now()` e checar linhas afetadas, ou decremento dentro da mesma seção crítica do `Mutex`.
- Entropia: o código não impõe tamanho mínimo; `.env.example` usa `example_invite` e `required()` só rejeita vazio. Correção: no boot, recusar convite com menos de 16 caracteres ou igual ao exemplo, e idem para `LIVEKIT_API_SECRET` (ver V1).
- Comparação em tempo constante: OK (SHA-256 dos dois lados + `ct_eq`). Descartado como risco.

### 3. [MÉDIA] Limite de taxa burlado e enchível via IPv6
- `main.rs:38`, `85-103`: a chave é o `IpAddr` completo (/128).
- Cenário A (burla): atacante com um bloco IPv6 (um /64 comum) troca de endereço a cada 10 tentativas e testa convites sem teto prático. Com convite forte o A é inócuo. Cenário B (negação): 4096 chaves distintas enchem a tabela (`>= 4096` devolve 429 para todo IP novo) por 60 s e o grupo inteiro fica sem token e sem upload-test; funciona com qualquer convite.
- Correção: chavear IPv6 por /64; com tabela cheia, descartar as entradas mais antigas em vez de negar a todos; opcional: limite global de falhas de convite (ex. 100/min).
- Verificado, NÃO forjável por cliente externo: `infra/caddy/stackcall.caddy:24` usa `header_up X-Forwarded-For {http.request.remote.host}` (substitui, não acrescenta) e o porteiro só confia no cabeçalho se o peer for `172.31.240.1` (`main.rs:72`). Teste `only_the_proxy_can_supply_a_client_ip` cobre. Ressalva no item 5.

### 4. [BAIXA] Release: segredos de assinatura expostos a código de build; sem Environment; actions por tag
- `.github/workflows/release.yml:122-128`: `TAURI_SIGNING_PRIVATE_KEY(+PASSWORD)` e `RELEASES_TOKEN` entram no env do passo que roda `npm run build` (beforeBuildCommand), `build.rs` e scripts de dependências. Dependência npm ou crate comprometida lê a chave e publica update assinado para todos os clientes (o updater confia só na chave minisign).
- `release.yml:6`: `workflow_dispatch` roda em qualquer branch com os segredos para quem tem escrita; não há `environment:` com aprovação.
- Todas as actions em tag móvel (`actions/checkout@v7`, `setup-node@v7`, `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`, `tauri-apps/tauri-action@v1`), nenhuma por SHA. `git-cliff` baixado sem checagem de hash (`release.yml:66-70`).
- Positivo: `permissions: contents: read`, `persist-credentials: false`, sem `pull_request_target`, entradas por `env:` (sem injeção de script), release como rascunho e publicada só após validar o manifesto, `RELEASES_TOKEN` só em evento `push` de tag.
- Correção: (a) `environment: release` com revisor obrigatório e proteção de tags `v*`; (b) fixar actions por SHA (Dependabot mantém); (c) rodar `npm ci` e build do frontend antes, em passo sem segredos, e dar a chave só ao `tauri build`; (d) conferir SHA-256 do git-cliff; (e) `RELEASES_TOKEN` fine-grained só com `contents:write` em `stackcall/releases`.

### 5. [BAIXA] Contêineres sem endurecimento e confiança no gateway do Docker
- `infra/docker-compose.yml`: sem `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `read_only: true`, `pids_limit`, `cpus`; LiveKit sem `user:`; sem `healthcheck`. Positivo: porteiro com `USER 65532`, imagens por digest, HTTP em 127.0.0.1, sem `docker.sock`, sem volume gravável, `mem_limit` nos dois.
- `main.rs:238`: `trusted_proxy` só vale se `PORTEIRO_ADDR == "0.0.0.0:8100"` literal e gateway fixo `172.31.240.1`. Qualquer processo do host que fale com 127.0.0.1:8100 chega como 172.31.240.1 e pode forjar XFF (exige acesso local ao host). Mudar o endereço no `.env` desliga a lógica em silêncio.
- Correção: adicionar as opções acima; variável explícita `PORTEIRO_TRUSTED_PROXY` no lugar da condição por string.

### 6. [BAIXA] `/api/upload-test`: sem timeout de leitura e amplificação de banda
- `main.rs:135-148`. Teto de 16 MB por requisição e 60/min por IP: ~1 GB/min de ingresso por IP; cliente lento (slowloris) segura a conexão (sem `TimeoutLayer`, Caddy sem `timeouts`). Memória não cresce (stream), mas fd e banda do VPS sim.
- Nota técnica: `DefaultBodyLimit::max(4096)` (linha 212) NÃO limita essa rota (usa `Body` bruto); o teto real é o contador manual, correto.
- Correção: `tower_http::timeout::TimeoutLayer` (ex. 30 s) e/ou limite em bytes/min em vez de requisições/min; no Caddy `servers { timeouts { read_body 20s read_header 10s } }`.

### 7. [BAIXA] CSP frouxa e `url`/`source` sem validação no IPC
- `app/src-tauri/tauri.conf.json:26`: `connect-src` aceita qualquer `https:`/`wss:`; `style-src 'unsafe-inline'`; sem `base-uri`, `form-action`, `object-src`, `frame-src` explícitos (caem em `default-src 'self'` quando existe fallback; `base-uri` e `form-action` não caem). Sem `script-src` próprio, vale `default-src 'self'` (bom, sem `unsafe-eval`). Não achei sink de XSS: nenhum `dangerouslySetInnerHTML`, `innerHTML` ou `eval` em `app/src`.
- Capabilities (`capabilities/default.json`): só `core:default`, `set-fullscreen`, `updater:default`, `process:allow-restart`. Sem shell, fs ou opener. O WebView NÃO passa args arbitrários ao sidecar: o sidecar só é lançado em Rust (`sidecar.rs:208-229`), `Command::arg` sem shell, `resolution/fps/codec/encoder/kbps` em allowlist, `--source=` e `--url=` cada um em um único argv (sem injeção de flag), token via stdin (não aparece na linha de comando).
- Lacuna: `args.url` e `args.source` não são validados no Rust (`sidecar.rs:194-203`). Com XSS o atacante publicaria a tela do usuário em qualquer servidor LiveKit e exfiltraria o token.
- Correção: `connect-src 'self' ipc: http://ipc.localhost https://stackcall.80-190-79-129.sslip.io wss://stackcall.80-190-79-129.sslip.io`; acrescentar `base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'`; validar em `iniciar_transmissao` que `url` é `wss://` e `source` casa com `monitor:N|window:...|pid:N`.

### 8. [BAIXA] Servidor editável no login recebe o convite
- `app/src/screens/Login.tsx:10,27,59`: o campo "servidor" é livre e guardado em `localStorage` (`stackcall.servidor`); o convite digitado é enviado para ele (`api.ts:20-24`). Engenharia social ("troque o servidor para X") captura o convite. Tokens ficam só em memória; convite só no Credential Manager (`invite.ts`), nunca em `localStorage`. Correção: esconder o campo na build de produção, ou exigir `https://` e confirmar quando diferir de `DEFAULT_SERVER`.

### 9. [BAIXA] Dependências (osv-scanner via Docker, funcionou)
`osv-scanner scan source -r` em 5 lockfiles: 7 pacotes, 0 críticas/altas.
- `chrono 0.4.45` RUSTSEC-2026-0543, sem versão corrigida, em `Cargo.lock` (raiz, entra por `server`/`core` conforme o grafo), `app/src-tauri/Cargo.lock` e spikes. Rodar `cargo tree -i chrono` para ver qual crate puxa e se o código afetado é usado; aguardar correção upstream.
- `glib 0.18.5` RUSTSEC-2024-0429 (CVSS 6.9) e `proc-macro-error 1.0.4` RUSTSEC-2024-0370 em `app/src-tauri` e spikes: vêm de GTK/Tauri no Linux; o produto é só Windows (NSIS), então não é compilado no release. Sem ação, apenas anotar.
- `cargo-audit` não foi necessário (osv cobre os `Cargo.lock`).

## Precisa validar (não confirmável pelo repo)

- **V1 Chaves LiveKit e convite reais na VPS**: o repo só tem exemplos (`example_key`, `example_secret_do_not_use_in_production`, `example_invite`). O compose exige as variáveis (`:?`) mas aceita o valor de exemplo. Validar no `.env` da VPS: secret com 32+ bytes aleatórios, convite com 16+ caracteres aleatórios, nada igual ao exemplo. Não toquei no host.
- **V2 Gateway Docker x XFF**: confirmar na VPS que o porteiro enxerga o peer como `172.31.240.1` (docker-proxy/NAT). Se for outro IP, ou todo cliente cai no mesmo balde (10 req/min para o grupo todo) ou o XFF nunca é confiado.
- **V3 `/srv/stackcall/updates`** (`stackcall.caddy:28-31`): rota estática sem uso aparente (o updater usa GitHub). Remover se não existir uso; se existir, confirmar que não lista diretório.
- **V4 Firewall/TURN**: confirmar que só 80/443, 7881/tcp, 7882/udp e 3478/udp estão abertos. TURN do LiveKit exige credencial emitida pelo próprio servidor (não é relay aberto), mas vale checar `relay_range` e logs.
- **V5 Logs do Caddy**: sem bloco `log` no arquivo. Se ligarem, o convite viaja no corpo POST (nunca em query), então a URL não vaza.
- **V6 `reqwest` sem TLS**: `app/src-tauri/Cargo.toml:380` usa `default-features = false` sem feature TLS; o `https` de `remote_changelog` pode falhar em runtime (defeito funcional, não de segurança). Conferir.

## Descartados

- Comparação do convite não constante: `ct_eq` sobre digest.
- Sala/identidade fora do corpo validado: vêm do corpo e passam por `valid_label` (1 a 32 bytes, `[A-Za-z0-9_-]`); `:tela` removido uma vez, `a:tela:tela` e `:tela` rejeitados (teste existe).
- Escalada pelo caminho `:tela`: só o item 1. Grants da tela: `can_subscribe=false`, `can_publish_data=false`, fontes `screen_share` e `screen_share_audio`. Token comum tem `room_admin=false` (teste existe) e não restringe fontes (microfone, intencional).
- TTL de 1 h: razoável.
- Vazamento de erro: só códigos HTTP sem corpo; única linha de log é o endereço de escuta (`main.rs:247`); nenhum log de token ou convite. `required()` entra em pânico com o NOME da variável, nunca o valor.
- CORS: fechado a 3 origens, sem credenciais, preflight testado. `tauri://localhost` e `http://127.0.0.1:1420` (dev) ficam ativas em produção; CORS não controla cliente não-browser. Sem risco.
- Corpo de `/api/token`: 4096 bytes via `DefaultBodyLimit` + `Json` com 413 mapeado.
- Segredos: só de env, nunca no repo.
- Compose: sem `docker.sock`, `privileged` ou `network_mode: host`.
- `pull_request_target`: ausente. PR roda sem segredos, `contents: read`.
- Updater: endpoint `https://github.com/stackcall/releases/...`, pubkey minisign, sem `dangerousInsecureTransportProtocol`. OK.
- Sidecar ao lado do exe (`current_exe().with_file_name`): exige escrita na pasta do usuário; quem tem isso já executa código como o usuário.

## spikes/ e webview-tela/ (prioridade mínima)

Não revisados em detalhe. O osv-scanner achou nos spikes os mesmos pacotes do item 9. Pendente: confirmar que `spikes/` e `webview-tela/` não entram no workspace do release.

## Testes que faltam

1. **Corrida do convite** (quando houver convite individual): 50 requisições paralelas (`tokio::join!`) a um convite com `max_usos=1`; exatamente 1 retorna 200 e 49 retornam 401/403; idem com expiração no limite.
2. **413 em `/api/token`**: corpo de 4097 bytes retorna 413 (hoje só o 413 do upload é testado); JSON truncado ou sem campo retorna 400; `Content-Type` errado retorna 400/415.
3. **Burla do limite**: peer não confiável com XFF forjado conta no peer (coberto); peer confiável com XFF `1.2.3.4, 5.6.7.8` retorna 400; peer confiável sem XFF usa o IP do proxy; após corrigir o item 3, 11 requisições de IPv6 distintos no mesmo /64 resultam em 429; tabela com 4096 chaves não bloqueia cliente novo.
4. **Upload lento**: com `TimeoutLayer`, corpo que para de chegar encerra em até o timeout; 16 MB + 1 enviado em vários chunks (hoje um bloco só).
5. **Limites independentes**: 10 em `/api/token` não consomem `/api/upload-test` e vice-versa.
6. **Grants**: sala fora da allowlist retorna 400; `Alice:tela` com identidade de outro dono falha (quando houver identidade por convite).
7. **Boot**: convite curto ou igual ao do exemplo faz o processo recusar subir; `LIVEKIT_API_SECRET` curto idem.
8. **Tauri**: teste unitário do validador de `url`/`source` em `iniciar_transmissao` (rejeitar `ws://`, host estranho, quebra de linha); snapshot do `tauri.conf.json` para impedir `connect-src https:` solto.
9. **CI**: job com `osv-scanner` e `npm audit --omit=dev` por PR; `actionlint`/`zizmor` nos workflows.

## Acompanhamento das correções

- Fase de contas: implementar convites individuais com expiração, limite de uso atômico e revogação. Até lá, permanece o convite compartilhado, com mínimo de 20 caracteres e rejeição do valor do exemplo na inicialização.

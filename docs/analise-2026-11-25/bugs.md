# Stackcall v0.3.0: análise de bugs (somente leitura)

Repo `E:\Repo\Pessoal\stackcall`, branch `main` (b3d7cbf). Testes: `npx vitest run` no app passou (25/25); `cargo test` no servidor passou (11/11, 1m24s de build). Os testes não cobrem nenhum dos bugs abaixo.

Legenda: severidade alta/média/baixa; esforço P (menos de 1 h), M (algumas horas), G (um dia ou mais).

## 0. Estado do hotfix `fix/v031-fontes-e-presets`

- A branch **não existe no origin** (`git ls-remote` não a lista). Ela só existe localmente, no worktree `C:\Users\adm\.t3\worktrees\stackcall\fix-v031-fontes-e-prese-d38c66fdcd65e82f`, com HEAD igual a `main`.
- Há trabalho **sem commit** nesse worktree: `presets.ts`, `presets.test.ts`, `GoLive.tsx`, `core/src/sources.rs`, bump para 0.3.1, changelog e `docs/release-notes/v0.3.1.md`.
- O que o hotfix cobre:
  - **Fontes (bug 4):** `sources.rs` passa a filtrar por `IsWindowVisible`, `IsIconic`, `DWMWA_CLOAKED`, `WS_EX_TOOLWINDOW`, janela com dono, título vazio e tamanho mínimo 320x200. O filtro roda antes da captura das miniaturas.
  - **Presets (bug 2):** remove o campo `uploadNeeded` e o fator duplo `*0.5`. A nova regra é `upload*0.8 >= mbps*1.5+0.3`. Tira o `.filter` de GoLive que escondia 1440p/4K. Põe o motivo "fonte menor que o preset" antes do motivo de upload.
- O que o hotfix NÃO cobre: o 415 do convite (bug 1), o cache do teste de GPU e do upload (bug 3), a lembrança de fonte e preset, e todos os itens abaixo.

## 1. Bugs conhecidos: causa raiz confirmada

### 1.1 "Erro do servidor (415)" ao gerar convite. Severidade alta, esforço P
- **Onde:** `app/src/lib/servidor.ts:185` (`criarConvite: chamar('POST', '/api/convites')`, sem corpo) e `app/src-tauri/src/conta.rs:121-125`.
- **Por quê:** o `chamar` do app só manda `content-type: application/json` quando `corpo` não é nulo (`conta.rs:121`). O servidor exige o corpo: `server/src/invites.rs:115` usa `Json(input): Json<InviteInput>`, e axum devolve 415 sem Content-Type JSON. Os testes do servidor mandam `json!({})` (`api_tests.rs:412`), por isso passam.
- **O usuário vê:** "Erro do servidor (415)." no botão "Gerar convite" (Settings) e no convite rápido da sala (`App.tsx:119`).
- **Correção:** `criarConvite: chamar('POST', '/api/convites', {})`. Defesa extra no servidor: aceitar corpo ausente (`Option<Json<_>>` ou `#[serde(default)]` mais tratamento de Content-Type ausente) e acrescentar um teste "POST sem corpo → 201".
- **Auditei os outros POST sem corpo.** `/api/aparelhos/link`, `/api/salas/{id}/token`, `/api/amigos/{id}`, `/api/sair` não têm extractor `Json`, então funcionam.

### 1.2 Presets travados com 24-26 Mbps; 1440p/4K somem. Severidade alta, esforço P (já no hotfix)
- **Onde:** `app/src/lib/presets.ts:79` e `app/src/screens/GoLive.tsx:119-120`.
- **Por quê:** `uploadNeeded` já é "com folga" (comentário em `presets.ts:12`), e a regra ainda exige `uploadMbps*0.5 >= uploadNeeded`. É folga em dobro. Para 1080p60 pedia 32 Mbps de upload. O mesmo `*0.5` está duplicado em GoLive.
- **1440p/4K estão filtrados, não travados.** No modo nativo, GoLive remove o card quando `height > 1080` e não há `p.trial` com `upload*0.5 >= uploadNeeded`. Isso exige 52 Mbps para 1440p e 130 Mbps para 4K. Em fonte 1080p eles somem de vez, sem aviso.
- **Correção:** a do hotfix, ou melhor ainda: mostrar sempre, travado, com o motivo.
- **Ressalva:** a medição de upload (item 1.3) subestima. Veja 1.3 e 2.8.

### 1.3 Teste de GPU e de upload rodam de novo a cada vez que abre a tela; resultado muda. Severidade alta, esforço M
- **Upload.**
  - **Onde:** `GoLive.tsx:40-50` e `servidor.ts:190-209`.
  - **Por quê:** `useEffect(() => void runUploadTest(), [])` roda em todo mount, e o GoLive é desmontado ao sair. O resultado é gravado em `store.set('uploadMbps')` (`GoLive.tsx:43`), mas **nunca é lido**. `grep` só acha o `set`. O teste não tem cancelamento: se o usuário sai e volta em menos de 5 s, dois testes rodam em paralelo e dividem a banda, e o valor cai.
  - **Subestima.** `medirUpload` calcula bytes totais sobre o tempo total, incluindo a partida lenta do TCP (começa em 256 KB, uma conexão só, RTT alto até a VPS).
- **GPU.**
  - **Onde:** `app/src-tauri/src/sidecar.rs:64-107` (cache em `%LOCALAPPDATA%\io.github.stackcall\gpu-probe.json`), `core/src/probe.rs:116-174` e `GoLive.tsx:69-84`.
  - **Já existe cache em Rust.** Mas ele é frágil:
    - A chave é a saída inteira de `reg query ...{4d36e968...} /s /v DriverVersion` (`sidecar.rs:64-72`). Isso lista todos os dispositivos da classe Display, inclusive virtuais. No cache desta máquina há `0001 DriverVersion 0.45.0.0` e o adaptador "Microsoft Basic Render Driver". Qualquer adaptador que aparece ou some (sessão RDP, monitor virtual, Parsec) muda a chave e dispara um novo probe. Não tem o nome da GPU.
    - Sem TTL, e falhas ficam salvas para sempre. Um "Operation not permitted" transitório do NVENC (outro app usando sessão) é guardado até o driver mudar.
    - Sem `driver` (o `reg.exe` tem timeout de 5 s) nada é gravado e todo acesso reprova.
  - **Por que o resultado varia (hipóteses, não reproduzi na máquina NVIDIA do usuário; aqui o cache existe e funciona, Iris Xe/QSV).**
    - O probe mede 1,5 s por trial (`probe.rs:153`), com frames sintéticos e corte por tempo. Os limiares ficam na borda: `fps >= 0.95*alvo` e carga `<= 80%` (`presets.ts:66-70`, `GoLive.tsx:57`). No cache desta máquina o 1440p60 ficou em 77,1% e o 1080p60 em 63,7%. Basta pouca interferência para virar.
    - `GoLive.tsx:72-82` dispara em paralelo `listar_fontes` (captura 1 miniatura por janela via Graphics Capture) e `testar_maquina`. Os dois disputam a GPU e a CPU, então o probe sai contaminado.
    - O app roda o probe com o jogo (CS2) aberto.
  - **Falha silenciosa.** Se o probe falha ou passa de 90 s (`sidecar.rs:98`), `GoLive.tsx:61-64` faz `setNative(false)` e cai no modo reserva WebView2 sem explicar. Esse modo não segura 1080p60 com a mesma nitidez.
- **Proposta de persistência.**
  1. **Probe (Rust).** Chave = lista ordenada de `(nome, vendor_id, DriverVersion)` dos adaptadores físicos. Filtrar "Microsoft Basic Render Driver" e virtuais. A versão do driver vem do registro, casada pelo adaptador. Guardar também `at` (timestamp). Reaproveitar por 30 dias, ou até mudar GPU ou driver. Não gravar linhas de falha por erro de abertura transitório (ou gravar com TTL de 24 h). Rodar o probe só quando a fonte pedir mais que 720p. "Refazer teste" passa `force = true` (já existe).
  2. **Upload.** Guardar `{mbps, at, servidor}` em `store` (localStorage, já usado). Reaproveitar por 24 h para o mesmo servidor. "Refazer teste" força. Medir no topo do `App`/`RoomView` (hook com cache de módulo) e não no GoLive, para sobreviver ao desmonte. Usar `AbortController` para não sobrepor testes. Calcular a média só das requisições com `size >= 1 MB`, descartando a partida lenta.
  3. **Última fonte e preset.** `store.set('ultimaFonte', {process_name, title})` e `store.set('ultimoPreset', id)`. Os ids `hwnd:...` mudam a cada execução, então reconciliar por `process_name`+título. Também guardar o flag "som do jogo".
  4. Sequenciar: usar o cache do probe primeiro e só então listar as fontes. Nunca os dois juntos.
- **Alternativa.** Usar `tauri-plugin-store` para o lado do app. Não é necessário: `localStorage` do WebView2 já persiste em `EBWebView`.

### 1.4 Lista de fontes com janelas ocultas e CS2 minimizado como 160x28. Severidade média, esforço P (hotfix)
- **Onde:** `core/src/sources.rs:45-79` (em `main`).
- **Por quê:** só filtra `width <= 0 || height <= 0` e o próprio processo. Janelas cloaked (UWP "Configurações"), invisíveis, sem título e minimizadas entram. Cada uma gasta até 350 ms esperando uma miniatura que nunca chega (`sources.rs:96`). Com 30 janelas isso passa de 10 s e pode estourar os 30 s de `query("sources", 30)` (`sidecar.rs:61`).
- **Correção:** a do hotfix (confirmei o diff: bate com o que o item pede). Falta um ponto: o CS2 minimizado deixa de aparecer, o que é aceitável, mas vale uma dica "restaure a janela" se o usuário procurar.

## 2. Mais bugs encontrados

### 2.1 Avatar e banner nunca aparecem. Severidade alta, esforço P
- **Onde:** `app/src/lib/servidor.ts:77-81` (`midia`) e `server/src/auth.rs:138-139`.
- **Por quê:** o servidor devolve o caminho relativo `'/media/' || avatar || '.webp'` (`PROFILE_FIELDS`; o teste `api_tests.rs:671` confirma). O app só reconhece hash cru (`/^[0-9a-f]{64}$/`). O caminho relativo passa direto, e `<img src="/media/<hash>.webp">` resolve contra `http://tauri.localhost`, que dá 404. O teste do app (`convite.test.ts:35`) só cobre o hash cru, que o servidor nunca manda.
- **Correção:** em `midia`, se `s.startsWith('/media/')`, devolver `base + s`. Adicionar teste com o formato real.

### 2.2 Contagem de pessoas e "no ar" das salas sempre zeradas; pessoa nunca aparece "na sala". Severidade média, esforço M
- **Onde:** `server/src/rooms.rs:311-315` (`Room` só tem `id`, `nome`, `ordem`), `server/src/people.rs:471-475` (`Person` não tem `sala`); consumo em `servidor.ts:105-111` e `Room.tsx:83-95,155-162`.
- **Por quê:** o contrato espera `pessoas`, `no_ar` e `sala`, que o servidor não manda. O app cai em `0`/`false`/`null`. Na tela de salas aparece sempre "vazia" e "Vazia agora".
- **Correção:** no servidor, `config.livekit.online()` já lista participantes por sala; devolver `pessoas` e `no_ar` (participante com identidade `:tela`) em `/api/salas`, e `sala` em `/api/pessoas`.

### 2.3 Lista de pessoas depende do LiveKit; se cair, o app inteiro mostra "Sem conexão". Severidade média, esforço P
- **Onde:** `server/src/people.rs:482` (`config.livekit.online().await?`) e `App.tsx:44` (`Promise.all` em `carregar`).
- **Por quê:** erro do LiveKit vira 502 em `/api/pessoas`, e o `Promise.all` derruba `eu`, `salas` e `info` junto. O app mostra "Sem conexão com o servidor" com o porteiro no ar.
- **Correção:** no servidor, `online().await.unwrap_or_default()` (presença indisponível, não erro). No app, `s.pessoas().catch(() => [])`.

### 2.4 Transmissão nativa só funciona no servidor oficial (host fixo). Severidade alta para self-host, esforço M
- **Onde:** `app/src-tauri/src/sidecar.rs:15` (`LIVEKIT_HOST = "stackcall.80-190-79-129.sslip.io"`) e `sidecar.rs:123-137`.
- **Por quê:** `valid_livekit_url` só aceita esse host. Em qualquer servidor próprio (a v0.3 tem self-host) `iniciar_transmissao` devolve "Parâmetros da transmissão inválidos.". O GoLive então cai no modo reserva em silêncio (`GoLive.tsx:155-158`). Se o IP da VPS ou o domínio sslip mudar, o servidor oficial quebra o modo nativo também.
- **Correção:** no `conta.rs`, interceptar a resposta de `POST /api/salas/{id}/token` e guardar no estado do Rust a URL do LiveKit entregue pelo porteiro, por origem. `valid_livekit_url` passa a comparar com essa URL guardada. Mantém a proteção contra um WebView comprometido mandar o token para outro host e remove a constante.

### 2.5 Token de tela expira em 1 h e a transmissão nativa passa a falhar sem explicação. Severidade média, esforço P
- **Onde:** `app/src/room/useLiveRoom.ts:187` e `:373` (`access.expires = requestedAt + 3600_000`), `GoLive.tsx:155-158`.
- **Por quê:** o token de tela é buscado só ao entrar na sala. Depois de 1 h na sala, "Entrar no ar" dá "O token de transmissão expirou. Entre novamente na sala.". O `catch` do GoLive ainda faz `setNative(false)`, o que joga o usuário no modo reserva WebView2 por causa de um erro que nada tem a ver com a GPU.
- **Correção:** em `goLiveNative`, chamar `session.servidor.token(roomId)` na hora e usar o `screen_token` novo. Só cair no modo reserva quando o erro for do núcleo (`UNAVAILABLE`), não para qualquer erro.

### 2.6 Qualquer erro do "Entrar no ar" trava o usuário no modo reserva. Severidade média, esforço P
- **Onde:** `GoLive.tsx:155-159`.
- **Por quê:** `setNative(false)` roda em qualquer exceção, inclusive "Já existe uma transmissão em andamento", token expirado, "A sala mudou". O usuário não volta mais ao nativo sem fechar a tela.
- **Correção:** só desligar o nativo para erros do núcleo ausente ou probe; os outros ficam como mensagem com "Tentar de novo".

### 2.7 Convite via deep link derruba a chamada. Severidade alta, esforço M
- **Onde:** `app/src/App.tsx:71-79` (e `:159-175`).
- **Por quê:** o handler de `stackcall://entrar` faz `setEstado({fase: 'entrada', voltar: true})` mesmo com o usuário numa sala. O `corpo` troca de `RoomScreen` para `Entrada`, o `LiveRoom` desmonta, e a limpeza do `useLiveRoom` (`:228-240`) desconecta a sala e para a transmissão nativa. Basta um amigo mandar um link e o usuário clicar durante a call (ou o navegador abrir um `/c/...` com a página de redirecionamento).
- **Correção:** com `sala` ativa, não trocar de tela. Mostrar um aviso "Convite recebido de <servidor>. Abrir?" e só navegar ao confirmar, ou renderizar `Entrada` como overlay sobre o `RoomScreen` mantido montado.

### 2.8 Medição de upload rende valor menor que o real. Severidade média, esforço P
- **Onde:** `servidor.ts:190-209`.
- **Por quê:** o cálculo inclui a partida lenta (256 KB, 512 KB, ...) e o RTT de cada requisição; usa uma conexão TCP só. Para 24-26 Mbps medidos, o real pode ser bem maior. Soma com o fator duplo do item 1.2.
- **Correção:** média só das requisições com 1 MB ou mais, usar 2 requisições paralelas, e manter a regra com folga única (a do hotfix).

### 2.9 Sessão revogada (401) não leva o usuário à tela de entrada. Severidade média, esforço M
- **Onde:** `app/src-tauri/src/conta.rs:142-144`, `App.tsx:53-56,81-90`.
- **Por quê:** o Rust apaga a credencial a qualquer 401. Mas só `carregar` (no início) manda o usuário para `entrada`. Durante a sessão: o refresh no foco engole os erros (`() => undefined`, `App.tsx:85-86`), e as ações mostram "Sua sessão neste aparelho acabou. Peça um convite novo.", sem sair da tela nem oferecer a entrada. A UI fica velha, com a sala ainda conectada.
- **Correção:** tratar 401 no `chamar` global (callback ou `EventTarget`) e levar a `fase: 'entrada'`, mantendo a sala só se o usuário confirmar.

### 2.10 Qualquer 401 apaga a sessão válida, inclusive em `/api/aparelhos/entrar`. Severidade média, esforço P
- **Onde:** `conta.rs:142` (`status == 401 && token.is_some()`).
- **Por quê:** `/api/aparelhos/entrar` devolve 401 para código inválido, usado ou expirado (`auth.rs:261,279`). Quem já tem sessão nesse servidor e cola um link de aparelho vencido perde a sessão boa.
- **Correção:** só apagar a sessão em 401 de rotas autenticadas. Excluir `/api/aparelhos/entrar` e `/api/convites/*/aceitar`.

### 2.11 Mensagens de erro cruas e códigos faltando em `MENSAGENS`. Severidade baixa, esforço P
- **Onde:** `servidor.ts:35-44`.
- **Por quê:** faltam 413, 415, 422, 500, 502, 503 e 504. O servidor manda 413/422/415 em imagem, 503 quando há outro upload de imagem em curso (`profile.rs:111-115`) e 502 do LiveKit. Aparecem como "Erro do servidor (NNN).". O 409 ("nome já em uso") é código morto: o servidor aceita nomes repetidos.
- **Correção:** acrescentar as mensagens (`413` "Imagem grande demais", `415/422` "Formato de imagem não aceito", `502/503` "Servidor ocupado, tente de novo") e remover o 409.

### 2.12 Reconexão: queda da sala exige trocar de aba. Severidade média, esforço M
- **Onde:** `useLiveRoom.ts:172-178`.
- **Por quê:** o LiveKit tenta reconectar sozinho (estado "reconnecting" funciona). Mas, ao receber `Disconnected`, o texto diz "Troque de aba para tentar de novo." e não há reconexão automática. Já existe `onRetry` (`Room.tsx:54`), mas ele não é acionado por conta própria. Em perda curta de rede o usuário fica fora da voz até mexer.
- **Correção:** repetir `onRetry` com recuo (2 s, 5 s, 10 s) enquanto `navigator.onLine`, e trocar o texto por um botão "Reconectar".

### 2.13 `remover` no cartão de perfil sem tratamento de erro. Severidade baixa, esforço P
- **Onde:** `App.tsx:213-217`.
- **Por quê:** `srv?.remover(...).then(...)` sem `catch`. Erro vira rejeição não tratada, o overlay fecha e a pessoa continua na lista sem aviso. O servidor ainda pode responder 502 depois de já ter removido (`people.rs:570-571`: o `revoke` grava e o `kick` falha), então a pessoa some do banco, mas o app mostra erro.
- **Correção:** `catch` com mensagem; no servidor, tratar falha do `kick` como aviso (200) depois de revogar.

### 2.14 Texto prometendo troca de nome que não existe. Severidade baixa, esforço P
- **Onde:** `Entrada.tsx:141` ("Dá para trocar depois no perfil") e `servidor.ts:49,69` (`Perfil` aceita `nome`).
- **Por quê:** `Perfil.tsx` só edita tema, cor, bio, avatar e banner, e o `Profile` do servidor (`profile.rs:34-39`) não tem `nome`; se o app mandasse, o serde ignora o campo sem erro.
- **Correção:** tirar a frase, ou implementar `nome` no servidor com `valid_name`.

### 2.15 Rate limit de convites compartilha balde com tentativas anônimas. Severidade baixa, esforço P
- **Onde:** `server/src/main.rs:155-159` (10/min para `/c/`, `/api/convites*`, `/api/aparelhos/*`).
- **Por quê:** o admin que lista, cria e revoga convites usa o mesmo balde de 10/min por IP que protege a aceitação de convite. Revogar vários em sequência dá 429 "Muitas tentativas". Atrás de NAT (empresa), o balde é de todos.
- **Correção:** mover `GET/POST/DELETE /api/convites` (autenticadas) para o balde geral e deixar o balde apertado só para `/c/`, `.../aceitar`, `GET /api/convites/{codigo}` (prévia) e `/api/aparelhos/entrar`.

### 2.16 `focus` dispara duas chamadas a cada foco. Severidade baixa, esforço P
- **Onde:** `App.tsx:82-90`.
- **Por quê:** cada `focus` do Windows chama `pessoas()` e `salas()` e engole 429. Alt-tab frequente gasta o limite de 30/min (`main.rs:166`) e a UI fica velha sem aviso.
- **Correção:** `debounce` de 10-15 s, e um único endpoint (ou `Promise.all`).

## 3. Segurança e ciclo de vida (verificações sem bug confirmado)

- **Token na WebView.** Está certo: `conta.rs:135-141` tira `sessao` da resposta e guarda no Credential Manager. O WebView só vê tokens do LiveKit (necessários). Rota restrita a `/api/` (`rota_valida`), sem redirecionamento (`Policy::none`), origem só https (ou http na rede local). OK.
- **CSP** (`tauri.conf.json:26`). `connect-src https: wss:` e `img-src https:` aceitam qualquer host https. Um XSS poderia exfiltrar para qualquer destino (baixa, sem XSS conhecido; `script-src` cai em `default-src 'self'`). `style-src 'unsafe-inline'` é baixa. Em servidor self-host `http://` local (permitido por `origem()` em `conta.rs:37`), a CSP bloqueia `fetch` do teste de upload, `img` do avatar e `ws://` do LiveKit; esse modo está quebrado na WebView (média para quem usa `--local`; não encontrei a flag no repo para confirmar o uso). Correção: gerar a CSP com o host do servidor atual, ou liberar `http:` apenas para a faixa privada.
- **IDOR.** Revisei salas, pessoas, convites, amizades: tudo exige `User` ativo e `manager()` onde cabe (`invites.rs:93,118,144`; `rooms.rs:365,385,411`; `people.rs:590-603`). Admin não toca em dono nem em outro admin (`people.rs:599-603`). Qualquer membro entra em qualquer sala, o que é o modelo (um servidor, um grupo). Nenhum IDOR encontrado.
- **`/media/{hash}` é público** (`profile.rs:212-239`), imutável, sem auth. O hash é SHA-256 do conteúdo; só quem já viu o hash (ou conhece a imagem) a pega. Baixa.
- **Token do LiveKit (1 h) sobrevive à remoção.** `people.rs:570-571`: `kick` expulsa, mas o JWT segue válido por até 1 h e a pessoa removida pode reentrar até vencer (o LiveKit só confere a assinatura). Idem sala apagada: `rooms.rs:415` não expulsa ninguém e o LiveKit recria a sala ao entrar. Severidade baixa a média. Correção: TTL de 10-15 min (o cliente LiveKit renova o token de quem está conectado) e uma lista de revogação consultada no `token()`.
- **Deep link com servidor desconhecido.** `Entrada.tsx:131-135` avisa "não é o oficial" e exige clique. Mas a prévia (`previa()`, `Entrada.tsx:85`) roda sozinha contra o host do link, o que revela o IP do usuário a qualquer servidor. Baixa.
- **Instância única e deep link.** `tauri-plugin-single-instance` com `features = ["deep-link"]` (`Cargo.toml:24`), primeiro plugin (`lib.rs:43`) e `mostrar(app)`: o segundo launch foca a janela e repassa a URL. Está correto. O problema real é o 2.7 (o que o app faz ao receber a URL).
- **Atualizador.** `updater.ts`: checagem a cada 6 h, o download só começa quando o usuário clica, instalação adiada até sair da sala (`waitingForLeave`). Sem bug de laço. Pontos baixos: `getVersion().then(...)` sem `catch` (`updater.ts:50`); o app nunca lê `versao_minima_app` do servidor (`servidor.ts:99-103` só usa `nome`/`versao`), então um servidor que exige versão mais nova não avisa o usuário.
- **Vazamentos e ciclo de vida.** `useLiveRoom` limpa o intervalo de 2 s, o `listen`, os elementos de áudio e a sala (`:228-240`). A troca de sala remonta `LiveRoom` por `key` (`Room.tsx:42`); a desconexão assíncrona antiga e a conexão nova usam a mesma identidade e o LiveKit expulsa a antiga, que já está `closed`. Sem laço de render: `session` é memoizado (`Room.tsx:52`). Único ponto menor: `ouvirDeepLinks` em `App.tsx:71-79` pode vazar o listener se o componente desmontar antes de `ouvirDeepLinks` resolver (só em StrictMode no dev).
- **Núcleo ausente ou sem DLLs.** `sidecar.rs:42-57`: falha no spawn ou código de saída diferente de 0 vira "O núcleo de transmissão não está disponível nesta máquina.". O GoLive mostra o erro e cai no modo reserva. Funciona. (A mensagem não diz o que fazer, baixa.)
- **Queda do núcleo durante a transmissão.** O evento `error` chega a `useLiveRoom.ts:63-70`, que zera `native.current` e mostra `streamError`. O núcleo também pára sozinho quando o stdin fecha (`publish.rs:227`), então não sobra processo órfão ao fechar o app pelo tray. OK.

## 4. Ordem sugerida
1. 1.1 (415), 2.1 (avatar), 2.10 (401 apaga sessão), 2.3 (LiveKit derruba lista): todos P e corrigem sintoma visível.
2. 1.2 e 1.4 já estão no hotfix; falta commit e push da branch.
3. 2.7 (deep link derruba call) e 1.3 (cache do teste e das escolhas): M.
4. 2.4 e 2.5 (self-host e token de tela), 2.6, 2.2, 2.9, 2.12.
5. Baixas e segurança restante.

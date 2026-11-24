# Projetos abertos de voz, tela e chat: o que copiar (pesquisa, 24/11/2026)

Pesquisa somente leitura na web. Nada foi instalado, compilado ou clonado. Cada afirmação traz o link da fonte consultada. Onde não consegui confirmar um dado, está marcado como "não verificado".

Limites desta pesquisa:
- A data do último commit não apareceu nas páginas de repositório consultadas; a maturidade está baseada em estrelas, número de commits e status declarado.
- Não li código-fonte dos módulos de voz. Os caminhos de arquivo citados são só os que apareceram nas páginas lidas.
- Não consegui abrir o repositório do Voxpery (404).

---

## 1. Resumo por projeto

### 1.1 Fluxer (fluxerapp/fluxer)

- **Licença:** AGPL-3.0-or-later segundo a página do repositório ([github.com/fluxerapp/fluxer](https://github.com/fluxerapp/fluxer)). O arquivo LICENSE em si não traz a cláusula "or later" no cabeçalho ([LICENSE](https://github.com/fluxerapp/fluxer/blob/main/LICENSE)). Tratar como AGPL-3.0 até confirmar com um advogado ou pela documentação do projeto.
- **Stack:** cliente web em `fluxer_app`; desktop em `fluxer_desktop`, com Electron 44 e crates Rust via napi-rs ([PACKAGING.md](https://raw.githubusercontent.com/fluxerapp/fluxer/main/fluxer_desktop/PACKAGING.md)). Backend em `fluxer_api`, `fluxer_gateway`, `fluxer_server`, `fluxer_media_proxy` ([página do repo](https://github.com/fluxerapp/fluxer)). Cliente Flutter é repositório separado ([página do repo](https://github.com/fluxerapp/fluxer)).
- **Voz e tela:** roda sobre LiveKit como SFU ([docs de voz via Mintlify](https://www.mintlify.com/fluxerapp/fluxer/features/voice-and-video), [setup de voz](https://www.mintlify.com/fluxerapp/fluxer/self-hosting/voice-setup)). O gateway entrega uma credencial de sessão e o cliente conecta no media server ([docs de voz](https://www.mintlify.com/fluxerapp/fluxer/features/voice-and-video)). Não há websocket de voz próprio nem handshake de criptografia separado ([docs de voz](https://www.mintlify.com/fluxerapp/fluxer/features/voice-and-video)).
- **Tela:** "Go Live" é a tela publicada como track extra na mesma conexão de voz ([docs de voz](https://www.mintlify.com/fluxerapp/fluxer/features/voice-and-video)). Permissão STREAM controla quem pode transmitir câmera e tela; o servidor pode mutar track de quem perdeu permissão ([docs de voz](https://www.mintlify.com/fluxerapp/fluxer/features/voice-and-video)).
- **Maturidade:** cerca de 11,0 mil estrelas, 873 forks, 3.636 commits ([página do repo](https://github.com/fluxerapp/fluxer)). Lançado em janeiro de 2026 ([Wikipedia](https://en.wikipedia.org/wiki/Fluxer)).
- **Copiar:** modelo de permissão STREAM, fluxo "Go Live" como track extra, separação gateway (credencial) e media server, estrutura de pastas de desktop.
- **Evitar:** copiar código (AGPL). Não copiar a arquitetura de Electron se a meta for app leve (ver seção 5).
- **Não verificado:** o post "How I built Fluxer" redireciona para fluxer.com e não consegui ler ([blog](https://fluxer.app/blog/how-i-built-fluxer-a-discord-like-chat-app)). Não há "CLA" confirmado na página do repo, apesar de um comentário externo citar um ([página do repo](https://github.com/fluxerapp/fluxer)).

### 1.2 LiveKit Meet (livekit-examples/meet)

- **Licença:** Apache-2.0 ([página do repo](https://github.com/livekit-examples/meet)). Permite copiar com atribuição e manter licença própria.
- **Stack:** Next.js e React, com `@livekit/components-react` ([página do repo](https://github.com/livekit-examples/meet)). Pastas: `app`, `lib`, `public`, `styles` ([página do repo](https://github.com/livekit-examples/meet)).
- **Maturidade:** cerca de 995 estrelas, 451 commits ([página do repo](https://github.com/livekit-examples/meet)).
- **Tela e E2EE:** a página do repo não lista controles de qualidade de tela, simulcast/dynacast ou E2EE. Uma busca indica que a LiveKit cita o Meet como exemplo de E2EE com `ExternalE2EEKeyProvider` ([docs de encryption, via busca](https://docs.livekit.io/home/client/encryption)). Não confirmei no código.
- **Copiar:** layout de sala e componentes de `app/` e `lib/`, uso de `components-react`. Ideia de quality/E2EE a confirmar no código.
- **Evitar:** o exemplo usa Next.js; no nosso caso o cliente é Tauri, então o que vale é a lógica, não a estrutura de páginas.

### 1.3 LiveKit (SDK e presets, base de qualquer opção)

- **Presets de tela (JS SDK):** `h360fps3`, `h360fps15`, `h720fps5`, `h720fps15`, `h720fps30`, `h1080fps15`, `h1080fps30`, `original`, com bitrate máximo de 200 kbps a 7 Mbps ([options.ts](https://raw.githubusercontent.com/livekit/client-sdk-js/main/src/room/track/options.ts)). Simulcast para tela vem ligado por padrão ([options.ts](https://raw.githubusercontent.com/livekit/client-sdk-js/main/src/room/track/options.ts)).
- **Compartilhar tela:** `setScreenShareEnabled(true)` abre o seletor de tela, janela ou aba ([docs screenshare](https://docs.livekit.io/transport/media/screenshare/)). Áudio do sistema via `createScreenTracks({ audio: true })` só funciona em aba do navegador e depende do navegador ([docs screenshare](https://docs.livekit.io/transport/media/screenshare/)).
- **E2EE:** é por participante no SDK, vale para todas as tracks e data channels. Chave compartilhada ou por participante. Sinalização e API não são E2EE, o servidor LiveKit enxerga ([docs encryption](https://docs.livekit.io/transport/media/encryption/)). A chave precisa ser gerada, guardada e distribuída pelo nosso servidor ([docs encryption](https://docs.livekit.io/transport/media/encryption/)).
- **Licença do servidor:** Apache 2.0, segundo um resultado de busca sem link confiável. Não verificado no repo do servidor.

### 1.4 Element Call (element-hq/element-call)

- **Licença:** AGPL-3.0, com licença comercial paralela ([página do repo](https://github.com/element-hq/element-call), [release v0.8.0](https://newreleases.io/project/github/element-hq/element-call/release/v0.8.0-rc.1)).
- **Stack:** React, Vite, Matrix js-sdk e MatrixRTC, LiveKit como backend de mídia ([página do repo](https://github.com/element-hq/element-call)). Exige LiveKit SFU e `lk-jwt-service` ([página do repo](https://github.com/element-hq/element-call)).
- **Maturidade:** cerca de 1,0 mil estrelas, 7.998 commits ([página do repo](https://github.com/element-hq/element-call)).
- **Tela:** quando alguém começa a compartilhar, a chamada muda para modo spotlight, e o usuário pode voltar para grade ([blog Element Call beta 3](https://element.io/blog/element-call-beta-3/)). Som ao iniciar tela foi adicionado depois ([busca de release](https://newreleases.io/project/github/element-hq/element-call/release/v0.8.0-rc.1)).
- **Copiar:** a ideia do spotlight automático ao compartilhar; o formato de token/JWT service para LiveKit.
- **Evitar:** copiar código (AGPL e dual license). Não precisamos do protocolo Matrix.

### 1.5 Sharkord (Sharkord/sharkord)

- **Licença:** MIT ([página do repo](https://github.com/Sharkord/sharkord)). Pode copiar com atribuição.
- **Stack:** Bun, tRPC, Drizzle ORM, React, Radix UI, shadcn/ui, Tailwind ([página do repo](https://github.com/Sharkord/sharkord)). Voz com SFU próprio em mediasoup, não LiveKit ([página do repo](https://github.com/Sharkord/sharkord)).
- **Maturidade:** cerca de 1,6 mil estrelas, 804 commits, status alpha ([página do repo](https://github.com/Sharkord/sharkord)).
- **Voz:** a porta 40000 TCP/UDP leva voz e vídeo ([página do repo](https://github.com/Sharkord/sharkord)). Um relato de self-host diz que voz falhou por UDP bloqueado ([busca Sharkord](https://scribe.disroot.org/comment/9389792)); é relato, não confirmado.
- **Copiar:** a interface shadcn/Tailwind como referência visual; o padrão "um binário ou Docker" para self-host.
- **Evitar:** mediasoup se a escolha for LiveKit; alpha.

### 1.6 Stoat / Revolt (stoatchat/stoatchat)

- **Licença:** AGPL-3.0 ([página do repo](https://github.com/stoatchat/stoatchat)).
- **Stack:** backend em Rust, com crates `delta` (API), `bonfire` (WebSocket), `autumn` (arquivos); MongoDB, Redis, RabbitMQ, MinIO ([página do repo](https://github.com/stoatchat/stoatchat)). Frontend em outro repo, `stoat-web` ([página do repo](https://github.com/stoatchat/stoatchat)).
- **Maturidade:** cerca de 3,5 mil estrelas, 1.676 commits ([página do repo](https://github.com/stoatchat/stoatchat)).
- **Voz:** o repo traz `livekit.example.yml` ([página do repo](https://github.com/stoatchat/stoatchat)). Detalhes de tela não aparecem.
- **Copiar:** separação de serviços de arquivo e proxy; ideia de LiveKit para voz.
- **Evitar:** o backend é pesado (cinco serviços). Para um grupo de amigos é excesso.

### 1.7 Spacebar (spacebarchat/spacebarchat)

- **Licença:** AGPL-3.0 ([página do repo](https://github.com/spacebarchat/spacebarchat)).
- **Maturidade:** cerca de 6,7 mil estrelas; status do repo "Development" ([página do repo](https://github.com/spacebarchat/spacebarchat)).
- **Voz:** suporte declarado a voz e vídeo, via WebRTC ([página do repo](https://github.com/spacebarchat/spacebarchat)). Detalhes não verificados.
- **Copiar:** pouca coisa para o nosso caso. Útil só como referência de compatibilidade com Discord.
- **Evitar:** copiar código (AGPL). Projeto em desenvolvimento.

### 1.8 Vesktop (Vencord/Vesktop) e Venmic

- **Vesktop:** GPL-3.0 ([página do repo](https://github.com/Vencord/Vesktop), [AUR](https://aur.archlinux.org/packages/vesktop?O=60)). Cerca de 8,6 mil estrelas, 646 commits ([página do repo](https://github.com/Vencord/Vesktop)). Destaque: "Linux Screenshare with sound & Wayland" ([página do repo](https://github.com/Vencord/Vesktop)). Resolução e FPS não aparecem na página.
- **Venmic:** MPL-2.0, captura de áudio de app via PipeWire, feito para Discord modificado; "não é para uso isolado" ([página do repo](https://github.com/Vencord/venmic)).
- **discord-screenaudio:** GPL-3.0 ou posterior ([busca](https://www.github.com/maltejur/discord-screenaudio)).
- **Copiar:** a ideia de áudio de app separado na tela (só Linux). Não copiar código GPL para um app MIT.
- **Evitar:** no Windows o PipeWire não existe. Venmic não serve para nosso alvo; ver seção 5.

### 1.9 Jitsi (jitsi/jitsi-meet)

- **Licença:** Apache-2.0 ([página do repo](https://github.com/jitsi/jitsi-meet)).
- **Maturidade:** cerca de 30,3 mil estrelas ([página do repo](https://github.com/jitsi/jitsi-meet)).
- **Stack:** React, WebRTC com SFU ([página do repo](https://github.com/jitsi/jitsi-meet)).
- **Tela:** a página lista "Content sharing", sem detalhes de qualidade ([página do repo](https://github.com/jitsi/jitsi-meet)).
- **Copiar:** código Apache-2.0 é permitido. Verificar componentes de tela e de layout de vídeo.
- **Evitar:** o código é grande; copiar só módulos isolados.

### 1.10 Galène (jech/galene)

- **Licença:** MIT ([página do repo](https://github.com/jech/galene)).
- **Stack:** servidor em Go; cliente web com guia `galene-client.md` ([página do repo](https://github.com/jech/galene)).
- **Maturidade:** cerca de 1,4 mil estrelas, 1.617 commits, 50 issues abertas ([página do repo](https://github.com/jech/galene)).
- **Tela:** a página não cita tela. Não verificado.
- **Copiar:** ideia de servidor leve e de SFU próprio, se um dia quisermos sair do LiveKit.

### 1.11 Outros Tauri e voz (com cautela)

- **OwnCord (J3vb/OwnCord):** AGPL-3.0; cliente Tauri com TypeScript; servidor Go; voz em LiveKit; "Screen sharing" listado sem detalhes ([página do repo](https://github.com/J3vb/OwnCord)). Só 11 estrelas. Bom exemplo de "Tauri + LiveKit", em estágio inicial.
- **Voxpery:** segundo a busca, AGPL-3.0, Tauri e LiveKit ([busca Tauri](https://github.com/Voxpery)). A página consultada deu 404; não verificado.
- **Kizuna:** self-host, texto, voz, tela, cliente Tauri v2; alerta de WebRTC em Linux ([busca Tauri](https://github.com/ItsAshn/kizuna)). Licença não verificada.
- **Hopp:** Tauri com LiveKit, mas é ferramenta de pair programming ([busca Tauri](https://github.com/ctkcoding/hopp)).
- **Voxium:** Tauri 2, voz P2P em malha, até cerca de 8 pessoas por canal ([busca Tauri](https://github.com/Aizen93/voxium)).
- **Entavi:** Tauri 2, WebRTC e sinalização em Cloudflare Workers ([busca Tauri](https://entavi.pages.dev/)).
- **webrtc-client-rust (inline-chat):** MIT, cliente WebRTC em Rust para voz e screenshare ([busca Tauri](https://github.com/inline-chat/webrtc-client-rust)). Referência de camada de mídia, não app pronto.
- **Gryt:** AGPL-3.0, voz, vídeo e texto por WebRTC ([busca Spokes](https://raw.githubusercontent.com/Gryt-chat/gryt/main/README.md)). Não verificado além da busca.
- **Spokes:** servidor source-available, não open source ([Product Hunt](https://www.producthunt.com/products/spokes)). Descartar como base.

---

## 2. Tabela: o que copiar de onde

Caminho de arquivo só quando li a página do repo. Onde não li o código, está "não verificado no código".

| Funcionalidade | Projeto | Arquivo/módulo | Impacto de licença |
|---|---|---|---|
| Presets de tela 720p30 a 1080p30, bitrate por preset | LiveKit JS SDK | `src/room/track/options.ts` ([link](https://raw.githubusercontent.com/livekit/client-sdk-js/main/src/room/track/options.ts)) | Usar via dependência npm: sem problema |
| Tela e áudio de aba no navegador | LiveKit docs | `createScreenTracks` ([link](https://docs.livekit.io/transport/media/screenshare/)) | Só documentação |
| E2EE com chave compartilhada | LiveKit SDK | `ExternalE2EEKeyProvider` ([link](https://docs.livekit.io/transport/media/encryption/)) | Só SDK, sem problema |
| Layout de sala e componentes | LiveKit Meet | `app/`, `lib/` ([link](https://github.com/livekit-examples/meet)) | Apache-2.0: copiar com atribuição e NOTICE |
| Spotlight automático ao compartilhar | Element Call | ideia ([link](https://element.io/blog/element-call-beta-3/)) | Só ideia; código AGPL |
| Permissão STREAM e "Go Live" como track extra | Fluxer | docs de voz ([link](https://www.mintlify.com/fluxerapp/fluxer/features/voice-and-video)) | Só ideia; código AGPL-3.0 |
| Desktop Electron, empacotamento | Fluxer | `fluxer_desktop/` ([link](https://raw.githubusercontent.com/fluxerapp/fluxer/main/fluxer_desktop/PACKAGING.md)) | Só ideia; código AGPL |
| Shadcn/Tailwind com tokens | Sharkord | `src/` (não verificado no código) ([link](https://github.com/Sharkord/sharkord)) | MIT: copiar com atribuição |
| Servidor leve de SFU próprio | Galène | `galene.go`, `static/` ([link](https://github.com/jech/galene)) | MIT: copiar com atribuição |
| Captura de áudio de app (Linux) | Venmic | PipeWire ([link](https://github.com/Vencord/venmic)) | MPL-2.0 (file-level); só Linux |
| Tauri + LiveKit, arquitetura de cliente | OwnCord | não verificado no código ([link](https://github.com/J3vb/OwnCord)) | AGPL-3.0: só ideia |
| Tela e som via Vesktop | Vesktop | não verificado no código ([link](https://github.com/Vencord/Vesktop)) | GPL-3.0: só ideia |

---

## 3. Estratégia de licença recomendada

Premissas: app privado para um grupo de amigos, distribuído como instalador Tauri, com servidor LiveKit próprio.

**Opção A (recomendada): app MIT ou Apache-2.0, copiar só de MIT/Apache/MPL-arquivo, e ler AGPL só como ideia.**
- Pode copiar código de LiveKit Meet (Apache-2.0), Jitsi (Apache-2.0), Sharkord (MIT), Galène (MIT).
- Para AGPL (Fluxer, Element Call, Stoat, Spacebar, OwnCord, Gryt), só reimplementar as ideias com código próprio. Reimplementação não herda licença, mas cuidado com cópia literal de trechos.
- Trade-off: é o caminho mais seguro e flexível. Exige mais código próprio, sobretudo na UX de tela.
- Se o app ficar só entre amigos e nunca for distribuído nem rodado como serviço para terceiros, a AGPL quase não obriga nada. Mesmo assim, copiar código AGPL "só para uso interno" ainda cria dívida se a app for aberta depois.

**Opção B: AGPL-3.0 para o app inteiro, se quisermos reusar código do Fluxer ou Element Call.**
- Ganho: copiar partes prontas (desktop, permissões, fluxo de tela).
- Custo: quem distribuir ou rodar nossa versão modificada como serviço precisa liberar o código inteiro. Para um app de amigos, isso é só chato, mas é irreversível na prática.
- Recomendo não escolher isso só para ganhar prazo.

**Opção C: GPL-3.0 (copiar Vesktop ou discord-screenaudio).** Não recomendo: força GPL no app todo e o alvo (Windows) não se beneficia.

**Resumo de dependências:** LiveKit server e SDKs (Apache-2.0) como base; Tauri (MIT/Apache, a confirmar). Para áudio de tela no Windows, verificar se o WebView2 do Tauri expõe `getDisplayMedia` com áudio. Não verificado nesta pesquisa; é o maior risco técnico.

---

## 4. Top 10 features de voz e tela para o app parecer moderno

Só itens com fonte têm link. Os demais são ideias de UX sem fonte verificada nesta pesquisa; estão marcados.

1. **Seletor de qualidade com estimativa de banda e GPU.** Presets 720p30 a 1080p30 com bitrate máximo conhecido ([options.ts](https://raw.githubusercontent.com/livekit/client-sdk-js/main/src/room/track/options.ts)). Estimativa de GPU: sem fonte; cálculo próprio.
2. **Troca automática para spotlight ao compartilhar.** Element Call faz isso ([beta 3](https://element.io/blog/element-call-beta-3/)).
3. **Permissão de transmitir separada de entrar na sala.** Fluxer tem STREAM ([docs de voz](https://www.mintlify.com/fluxerapp/fluxer/features/voice-and-video)).
4. **"Go Live" como ação separada da câmera.** Fluxer trata tela como track extra no mesmo canal ([docs de voz](https://www.mintlify.com/fluxerapp/fluxer/features/voice-and-video)).
5. **Áudio da aba ou do sistema ao compartilhar tela.** Só em aba do navegador na LiveKit ([docs screenshare](https://docs.livekit.io/transport/media/screenshare/)). Vesktop faz som de app no Linux ([página do repo](https://github.com/Vencord/Vesktop)). Áudio do Windows: não verificado.
6. **Simulcast ligado por padrão para tela.** LiveKit ([options.ts](https://raw.githubusercontent.com/livekit/client-sdk-js/main/src/room/track/options.ts)), para o servidor escolher a camada por quem assiste.
7. **E2EE opcional por sala.** LiveKit com chave compartilhada ([docs encryption](https://docs.livekit.io/transport/media/encryption/)). Atenção: a sinalização não é E2EE.
8. **Pré-visualização da tela antes de publicar.** Não verificado nesta pesquisa; ideia de UX própria.
9. **Contador de quem está assistindo.** Não verificado nesta pesquisa; ideia própria.
10. **Push-to-talk, volume por usuário, supressão de ruído, PiP, soundboard.** Não verificado nesta pesquisa. Jitsi e LiveKit Meet devem ter parte disso; confirmar no código antes de copiar.

---

## 5. Pontos de atenção

- **Alvo Windows:** Venmic e Vesktop são Linux-only (PipeWire) ([Venmic](https://github.com/Vencord/venmic)). Não servem para o nosso alvo.
- **LiveKit e tela:** a documentação oficial trata áudio de tela só no navegador ([docs screenshare](https://docs.livekit.io/transport/media/screenshare/)). Tauri usa WebView2 no Windows; confirmar se `getDisplayMedia` com áudio funciona ali antes de prometer o recurso.
- **Maturidade real:** Sharkord está em alpha ([página do repo](https://github.com/Sharkord/sharkord)); OwnCord tem 11 estrelas ([página do repo](https://github.com/J3vb/OwnCord)). Usar como referência, não como base.
- **Datas:** não consegui a data do último commit em nenhum repo. Antes de decidir, conferir manualmente a atividade.

---

## 6. Próximos passos sugeridos

1. Ler no código a lógica de presets e E2EE do `livekit-examples/meet` (Apache-2.0).
2. Confirmar se `getDisplayMedia` com áudio funciona no WebView2 do Tauri no Windows.
3. Decidir a licença (Opção A recomendada) antes de copiar qualquer trecho.
4. Abrir o `fluxer_app` e o `fluxer_gateway` só para entender o fluxo de STREAM, sem copiar.

---

## Fontes principais

- Fluxer: https://github.com/fluxerapp/fluxer ; https://github.com/fluxerapp/fluxer/blob/main/LICENSE ; https://raw.githubusercontent.com/fluxerapp/fluxer/main/fluxer_desktop/PACKAGING.md ; https://www.mintlify.com/fluxerapp/fluxer/features/voice-and-video ; https://www.mintlify.com/fluxerapp/fluxer/self-hosting/voice-setup ; https://en.wikipedia.org/wiki/Fluxer
- LiveKit Meet: https://github.com/livekit-examples/meet
- LiveKit SDK e docs: https://raw.githubusercontent.com/livekit/client-sdk-js/main/src/room/track/options.ts ; https://docs.livekit.io/transport/media/screenshare/ ; https://docs.livekit.io/transport/media/encryption/ ; https://docs.livekit.io/home/client/encryption
- Element Call: https://github.com/element-hq/element-call ; https://element.io/blog/element-call-beta-3/ ; https://newreleases.io/project/github/element-hq/element-call/release/v0.8.0-rc.1
- Sharkord: https://github.com/Sharkord/sharkord ; https://scribe.disroot.org/comment/9389792
- Stoat: https://github.com/stoatchat/stoatchat
- Spacebar: https://github.com/spacebarchat/spacebarchat
- Vesktop e Venmic: https://github.com/Vencord/Vesktop ; https://github.com/Vencord/venmic ; https://aur.archlinux.org/packages/vesktop?O=60
- Jitsi: https://github.com/jitsi/jitsi-meet
- Galène: https://github.com/jech/galene
- OwnCord: https://github.com/J3vb/OwnCord
- Outros Tauri: https://github.com/ItsAshn/kizuna ; https://github.com/ctkcoding/hopp ; https://github.com/Aizen93/voxium ; https://entavi.pages.dev/ ; https://github.com/inline-chat/webrtc-client-rust
- Spokes: https://www.producthunt.com/products/spokes
- Gryt: https://raw.githubusercontent.com/Gryt-chat/gryt/main/README.md

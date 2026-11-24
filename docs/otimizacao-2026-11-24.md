# Stackcall: plano de otimização (leitura do código em main, 24/11/2026)

Escopo: análise somente leitura de `app/`, `core/`, `server/` e `infra/`. Nada foi executado nem medido por mim. Onde cito comportamento de biblioteca que não confirmei na documentação, marco **(conferir)**.

Fontes consultadas: config-sample do LiveKit (github.com/livekit/livekit/blob/master/config-sample.yaml), docs.livekit.io (deployment, TrackPublishDefaults do client JS). Os valores de `AudioPresets` e as opções do FFmpeg abaixo vêm do meu conhecimento das docs/código, não de fetch nesta sessão.

## Leitura rápida (o que o código mostra hoje)

- Voz: `Room` com `adaptiveStream`, `dynacast`, `webAudioMix`, e `audioCaptureDefaults` com NS, AEC e AGC ligados (`app/src/room/useLiveRoom.ts:72-77`). Sem `audioPublishDefaults`: vale o padrão do SDK (preset `music`, 48 kbps, mono, DTX e RED ligados).
- Seleção de microfone e saída de áudio: não existe (nenhum `deviceId`/`setSinkId` em `app/src`).
- Render: `setInterval(rerender, 150)` (`useLiveRoom.ts:204`) re-renderiza a sala inteira 6,7 vezes por segundo, o tempo todo.
- Telas só são assinadas depois de "Assistir" (`useLiveRoom.ts:88-97`). Bom. Só há 1 `<video>` de palco; câmeras ficam em tiles pequenos.
- Sidecar: `core/src/encoder.rs:99-127`. H.264 `baseline`, NVENC `p1` + `tune ull` + `zerolatency`, GOP de 2 s, sem B-frames, sem `rc`/`maxrate`/`bufsize`. Conversão BGRA para NV12 na GPU (video processor D3D11), com queda para swscale na CPU.
- Mudança de bitrate pedida pelo BWE do LiveKit recria sessão do codificador **e o conversor de GPU** (`core/src/publish.rs:388-439`).
- Infra: `livekit.yaml` mínimo (UDP mux 7882, TCP 7881, TURN/UDP 3478). Sem ajuste de congestion control, PLI, áudio ou codecs da sala.
- Tauri: `opt-level="s"`, lto, codegen-units 1, strip (`app/src-tauri/Cargo.toml:23-27`). `core/` e `server/` herdam o perfil release padrão (o workspace raiz não tem `[profile.release]`).

---

## Ranking geral (impacto sobre esforço)

### 1. Servidor mais perto (nó em São Paulo) — latência de voz e tela
- **O quê:** a VPS fica em US East (Contabo). RTT de 140-180 ms por usuário. O atraso de 215 ms vidro a vidro é dominado pela rede: ida ao servidor (~75 ms) + volta (~75 ms) já somam ~150 ms. Voz tem o mesmo problema (boca a ouvido bem acima de 200 ms).
- **Mudança:** nó de mídia no Brasil (Oracle Cloud Vinhedo, AWS/Lightsail sa-east-1, Vultr SP, Hostinger/Magalu). Contabo não tem região no Brasil. O Hostinger KVM 4 que já é pago (memória: srv1867602, sem uso conhecido) pode estar em datacenter brasileiro: conferir a localização antes de comprar outra coisa.
- **Efeito esperado:** RTT de ~20-40 ms; vidro a vidro de ~215 ms para ~90-120 ms; voz com ~100 ms a menos. É o maior ganho disponível, maior que qualquer ajuste de código.
- **Risco:** mover `porteiro`, Caddy, domínio e URL fixa (`LIVEKIT_HOST` em `app/src-tauri/src/sidecar.rs:15` e CSP em `tauri.conf.json:26`). Um nó só, sem Redis. Banda: confirmar a porta do novo provedor.
- **Esforço:** M (L se for provedor novo + migração do updater em `/updates`).

### 2. Pausar a codificação e o upload quando ninguém assiste — peso em PC fraco jogando
- **O quê:** quem entra "no ar" com o sidecar codifica e envia o fluxo completo mesmo com 0 espectadores (as telas só são assinadas após "Assistir"; o sidecar não tem dynacast para fonte pré-codificada, **conferir** o que o BWE devolve em `take_rate_control_request` nesse caso).
- **Mudança:** o app já conhece os espectadores (`watchMap`, `useLiveRoom.ts:42,246`). Adicionar comando `pause`/`resume` em `core/src/publish.rs:49-55` (enum `Command`) e o repasse em `sidecar.rs:306-327`. Pausado: continua capturando (barato) mas descarta quadros antes de `gpu.convert`/`send_frame` (`publish.rs:448-463`). No `resume`: `Keyframe` já existe (`publish.rs:231`).
- **Efeito:** zero NVENC, zero conversão, zero upload (7 Mbps) enquanto o palco está sem público. Libera GPU para o CS2.
- **Risco:** o primeiro espectador espera ~RTT + 1 keyframe (200-400 ms). Cuidado com o LiveKit marcar a trilha como parada (timestamps RTP com buraco): testar assistir logo após retomar.
- **Esforço:** M.

### 3. Limitar a captura WGC ao fps alvo (monitores de 144/240 Hz)
- **O quê:** `MinimumUpdateIntervalSettings::Default` em `core/src/publish.rs:110-119`. O WGC entrega um quadro por apresentação; com CS2 a 240 fps e stream de 60, o Windows copia ~4x mais quadros do que o necessário e o código só os descarta depois (`publish.rs:361-371`, `slot <= last`).
- **Mudança:** `MinimumUpdateIntervalSettings::Custom(Duration::from_micros(1_000_000 * 9 / 10 / fps))` **(conferir o nome do variante na versão `windows-capture =2.0.1`; precisa de Windows 11 22H2+ para surtir efeito)**. Usar ~90% do período para não criar aliasing com o relógio de `slot`.
- **Efeito:** menos cópias de textura por segundo na GPU compartilhada com o jogo; menos acordadas da thread de captura. Para jogadores de 240 Hz é a maior economia de GPU do pipeline.
- **Risco:** baixo. Medir `captured_fps` x `encoded_fps` antes e depois.
- **Esforço:** S.

### 4. Rate control do codificador: CBR com VBV curto
- **O quê:** `encoder.rs:101` só define `bit_rate`. Sem `rc_max_rate` e `rc_buffer_size`, o NVENC roda VBR sem VBV efetivo; o IDR a cada 2 s chega como rajada (a 7 Mbps/60 fps, um IDR pode passar de 40 pacotes) e dispara perda/NACK com RTT de 150 ms.
- **Mudança:** em `encoder::open`: `video.rc_max_rate = video.bit_rate; video.rc_buffer_size = bit_rate / fps * 3/2` (1,5 quadro de VBV) e, no NVENC, `("rc","cbr")`. No QSV, `rc_max_rate == bit_rate` já seleciona CBR. No AMF: `("rc","cbr")` ou `vbr_latency` **(conferir)**.
- **Efeito:** menos picos de IDR, jitter menor no pacer do WebRTC, menos NACK/PLI em pico.
- **Risco:** IDR menor significa pior qualidade por poucos quadros em corte de cena. Medir `bitrate_kbps` e p95.
- **Esforço:** S.

### 5. Parar de recriar o codificador e o conversor a cada ajuste de bitrate
- **O quê:** `publish.rs:388-439`. A cada mudança >=10% pedida pelo BWE (`publish.rs:384`), o código faz `send_eof`, drena, **destrói** a `Session` (que carrega o `gpu::Converter`, `gpu.rs:47-54`), recria video processor + pool D3D11 e força IDR. É um soluço de dezenas de ms e um IDR extra em cada oscilação de banda.
- **Mudança:** (a) reaproveitar o `Converter` existente quando só o bitrate muda (mover `gpu` para fora de `Session` ou reaproveitar a pool); (b) histerese: subir só a cada >=3 s e >=15%; descer na hora; (c) quantizar em degraus (ex.: 100/85/70/50%). Mais à frente, investigar reconfiguração in-place do NVENC (o FFmpeg não expõe de forma estável: **conferir** na versão 9.1).
- **Efeito:** menos travadinhas visíveis quando a banda oscila; menos IDRs.
- **Risco:** médio-baixo; mexe na máquina de estados da sessão.
- **Esforço:** S (a)+(b)+(c), M para reconfiguração in-place.

### 6. Re-render da sala a cada 150 ms (CPU do WebView2 enquanto joga)
- **O quê:** `useLiveRoom.ts:204` re-renderiza `RoomView`, `Stage`, `Mixer` (Radix Slider por pessoa), `PersonTile` e `Chat` ~6,7x/s para sempre. O `Chat` (`Room.tsx:317-350`) chama `toLocaleTimeString` (`hhmm`, linha 315) para cada mensagem em cada render: até 200 mensagens x 6,7 = ~1.300 chamadas/s de `Intl`, que é caro. Além disso, `audioLevel` remoto só muda no ritmo do servidor (`audio.update_interval` padrão 500 ms), então a maioria dos renders não muda nada.
- **Mudança, em ordem:**
  1. S: guardar o horário já formatado na mensagem (`at` string criada uma vez, `useLiveRoom.ts:154,321`) ou um `Intl.DateTimeFormat` global; `React.memo` em `Chat` e nas linhas de mensagem.
  2. S: não rodar o intervalo com `document.hidden` (jogando em tela cheia por cima) e só rodar quando alguém fala (`ActiveSpeakersChanged` já existe, linha 161).
  3. M: tirar o medidor do estado React: componente `Meter` com `ref` e `requestAnimationFrame` só enquanto `p.isSpeaking`, lendo `p.audioLevel` direto.
- **Efeito:** CPU do renderer cai de contínuo para ~0 em silêncio; menos GC (os arrays `people`/`streams` são recriados a cada render, linhas 222-261).
- **Risco:** baixo. O teste `screens.test.tsx` cobre telas.
- **Esforço:** S (1+2), M (3).

### 7. Processo do sidecar: prioridade e EcoQoS (estabilidade enquanto o jogo roda)
- **O quê:** `sidecar.rs:29-35` usa só `CREATE_NO_WINDOW`; nenhuma prioridade. Sob CPU alta do CS2, a thread WGC e a de áudio WASAPI perdem janela e viram `dropped_frames` e estalos no áudio do jogo. O Windows 11 também pode jogar processo em segundo plano no modo de eficiência (EcoQoS).
- **Mudança:**
  - `creation_flags(0x08000000 | 0x00008000)` (ABOVE_NORMAL_PRIORITY_CLASS) no sidecar. O custo de CPU do sidecar é ~1%, então não rouba do jogo.
  - No `core`: `SetThreadPriority(ABOVE_NORMAL)` + `AvSetMmThreadCharacteristicsW("Pro Audio"/"Capture")` na thread do WASAPI (`audio.rs:74`) e na de captura (`publish.rs:343`); o feature `Win32_System_Threading` já está ligado, **conferir** se o `Av*` está no mesmo módulo na `windows 0.62`.
  - `SetProcessInformation(ProcessPowerThrottling)` com `StateMask = 0` para sair do EcoQoS.
- **Efeito:** menos quadros perdidos e menos cliques no áudio de jogo em PC fraco/carregado.
- **Risco:** baixo; não use REALTIME.
- **Esforço:** S.

### 8. Pré-processamento de voz: opções e ruído de teclado/mouse
- **O quê:** NS, AEC e AGC do navegador sempre ligados (`useLiveRoom.ts:76`). Eles custam <1% de CPU (o melhor custo possível). Fraquezas: o NS do WebRTC só trata ruído estacionário (teclado mecânico e cliques passam), o AGC pode "bombear" com jogo no fone, e AEC sem necessidade custa qualidade se a pessoa usa headset.
- **Mudança:**
  - S: configurar explicitamente `audioCaptureDefaults: { channelCount: 1, sampleRate: 48000, echoCancellation, noiseSuppression, autoGainControl }` e expor no `Settings.tsx` "Eco" e "AGC" como opções (padrão atual). Hoje não há escolha de microfone nem de saída (`deviceId`/`setSinkId` inexistentes): adicionar seleção resolve o caso comum "o Windows trocou o dispositivo padrão" (S/M).
  - M: opção "Supressão forte" com **RNNoise em WASM/AudioWorklet** como `TrackProcessor` do LiveKit; custo típico ~1-3% de um núcleo, modelo de 85 kB; desligar o NS nativo quando ligado (evita dupla supressão). Krisp do LiveKit só funciona no LiveKit Cloud, não no self-hosted: descartar. DeepFilterNet: melhor, mas ~5-10% de um núcleo; só em PC forte.
- **Risco:** RNNoise pode cortar o fim de palavras e música/cantoria; manter desligado por padrão.
- **Esforço:** S (config + dispositivos), M (RNNoise).

### 9. Qualidade do vídeo no codificador: perfil e preset
- **O quê:** `encoder.rs:104-118`: H.264 `baseline` (sem CABAC nem transformada 8x8, ~10-15% pior em eficiência na mesma qualidade) e NVENC `p1` (o mais rápido e o pior em qualidade).
- **Mudança:**
  - NVENC: testar `profile=high` (decodificadores do WebView2 aceitam; **conferir** o perfil anunciado no SDP pelo publisher pré-codificado do livekit-rust 0.12: se anunciar só 42e01f, validar em vários PCs antes) e `preset p3` ou `p4` mantendo `tune ull`. Em RTX 5060 o p95 de 1,2 ms em 1080p60 deixa folga de sobra (`docs/fase0/resultados.md`, P2). Escolher o preset por resultado do `testar_maquina` (já há `encoder_load_percent`, `presets.ts:68`): p1 quando a carga passar de ~60%.
  - Opcional: `("spatial-aq","1")` ajuda texto/mira/HUD do CS2.
  - AMF: `quality balanced` quando a carga permitir; QSV: `low_power=1` (VDEnc, menos carga na GPU integrada e menos latência) e `preset veryfast` **(conferir opções do `h264_qsv` no FFmpeg 9.1)**.
- **Efeito:** mais nitidez no mesmo bitrate (ou mesmo visual com 10-15% menos banda).
- **Risco:** mais carga de GPU; compat do perfil.
- **Esforço:** S (flags) + M (escolha automática).

### 10. LiveKit: ajustes de `livekit.yaml`
Arquivo: `infra/livekit/livekit.yaml`. Tudo opcional e testável sem mexer em código do cliente.
- `audio: { update_interval: 200, smooth_intervals: 2 }`: o indicador "FALANDO" e os medidores deixam de chegar a 500 ms + suavização. Custo de servidor irrelevante com poucos usuários.
- `rtc.pli_throttle: { low_quality: 300ms, mid_quality: 500ms, high_quality: 500ms }`: recuperação de perda mais rápida (padrão de amostra: 1 s para `high`). Risco: mais IDRs sob perda sustentada.
- `rtc.congestion_control: { enabled: true, allow_pause: true, use_send_side_bwe: true }` **(testar: o padrão da amostra é `false`)**. Estimativa de banda por TWCC tende a subir mais rápido e a ser mais estável com 7 Mbps. Atenção: com `simulcast: false` (sidecar, `publish.rs:196`) o SFU não tem camada menor; sob congestão `allow_pause` pausa o vídeo em vez de rebaixar. Para amigos com boa banda é aceitável.
- `rtc.packet_buffer_size_video: 1000` (padrão 500) quando liberar 1440p60/4K: buffer de retransmissão (NACK) para ~1 s.
- `room.enabled_codecs`: `audio/opus`, `audio/red`, `video/h264`, `video/av1`. Evita negociação de VP8/VP9; confirma que o `backupCodec: h264` do fallback WebView2 (`useLiveRoom.ts:339`) continua permitido.
- Playout delay (`room.playout_delay`, **conferir** a chave na 1.13): experimento para reduzir 20-60 ms do buffer de jitter em tela; no cliente, equivalente é `RemoteVideoTrack.receiver.jitterBufferTarget` (Chromium). Risco: engasgo em rede instável. Medir antes de adotar.
- Docker/NAT: o compose usa bridge com UDP mapeado (`docker-compose.yml:13-14`). A doc do LiveKit recomenda `network_mode: host` em produção. Ganho pequeno com poucos usuários; ignorar até haver problema de ICE.
- TURN/UDP 3478 sem TLS não ajuda quem tem UDP bloqueado; o útil seria TURN/TLS em 443 (já anotado no arquivo como fase futura).

---

## Itens menores (por área)

### Cliente (React / livekit-client)
- **Áudio remoto com `webAudioMix: true`** (`useLiveRoom.ts:73`): necessário para volume acima de 100%. Passar um `AudioContext` próprio com `latencyHint: 'interactive'` e `sampleRate: 48000` evita reamostragem (S, **conferir** a forma `webAudioMix: { audioContext }`).
- **Opus explícito**: `audioPublishDefaults: { audioPreset: AudioPresets.music /* 48 kbps */, dtx: true, red: true }` apenas para fixar o comportamento (hoje é o padrão do SDK). Fala em 24 kbps (`speech`) economiza banda mas perde naturalidade; ficar em 48. Confirmar por `chrome://webrtc-internals`-equivalente (DevTools no WebView2) que `useinbandfec=1` está no SDP **(conferir)**. S.
- **Vídeo oculto**: com o jogo por cima, o vídeo do palco continua decodificando se o WebView2 não marcar a página como oculta. Ao `document.visibilityState === 'hidden'` por >10 s, chamar `pub.setEnabled(false)` na publicação de tela e reativar ao voltar (economiza banda de download e decodificação; **conferir** se o `adaptiveStream` já faz isso sozinho nesse caso). S.
- **`stopMicTrackOnMute: true`** reduz o custo de AEC/NS quando mudo, mas o desmute ganha 100-300 ms e pode estalar no driver. Só vale se o uso mostrar muito tempo mudo. Baixa prioridade.
- **`TrackVideo`** (`Room.tsx:156`): adicionar `disablePictureInPicture`; `playsInline` e `muted` já estão. S.
- **Chat**: `scrollIntoView` a cada mudança de `chat.length` é ok; o custo é o re-render do item 6.

### Tauri / WebView2
- `Cargo.toml` (app): adicionar `panic = "abort"`; o resto do perfil está bom. `opt-level = "s"` é adequado para um shell fino. Ganho: pequeno (tamanho). S.
- `tauri.conf.json:22` (`additionalBrowserArgs`): já desativa `msWebOOUI,msPdfOOUI,msSmartScreenProtection`. Não há bandeira confiável que reduza RAM do WebView2 sem risco. **Não** usar `--disable-background-timer-throttling` nem `--disable-renderer-backgrounding` (aumentam CPU em segundo plano).
- **RAM em segundo plano**: ao minimizar/ocultar a janela, chamar `ICoreWebView2_19::put_MemoryUsageTargetLevel(LOW)` pelo `with_webview` do Tauri (Windows). Reduz o conjunto de trabalho do WebView2 (~200-350 MB típico) quando o jogo está na frente. Não usar `TrySuspend`: suspenderia a mídia. M.
- **Bandeja + atalhos globais**: não há tray (`lib.rs`). Um `tauri-plugin-global-shortcut` com mudo/fone e **push-to-talk** (estados `Pressed`/`Released`) é o maior ganho de uso real para quem joga CS2 em tela cheia; reduz também a vontade de dar alt-tab (que derruba o FPS). O JS roda normalmente no renderer oculto. M, é recurso novo.
- **Lista de fontes** (`core/src/sources.rs:83-103`, chamada via `listar_fontes`, timeout de 30 s): uma miniatura por janela, **em sequência**, cada uma esperando até 350 ms. Com 30 janelas abertas (incluindo as de outras áreas de trabalho, que não entregam quadros) a lista demora vários segundos. Paralelizar com `std::thread::scope`, limitar a ~8 janelas por vez, ignorar janelas "cloaked"/minimizadas, e devolver as miniaturas aos poucos. M.
- Cache de `testar_maquina` por versão de driver já existe (`sidecar.rs:64-107`); manter. O teste de 90 s não deve rodar com jogo aberto: avisar na UI. S.

### Núcleo (`core/`)
- **Caminho de CPU** (`publish.rs:512-527` e `media.rs:203-238`): `cpu_convert` copia o quadro (GPU para staging para CPU) e `to_nv12` cria e destrói `SwsContext` e aloca `AVFrame` **a cada quadro**. Cachear o `SwsContext` e o buffer na `Session`, trocar `SWS_BILINEAR` por `SWS_FAST_BILINEAR` quando não houver redimensionamento. Só afeta PCs sem video processor D3D11, que são justamente os mais fracos. S.
- **Vistas D3D11 por quadro** (`gpu.rs:177-206`): `CreateVideoProcessorInputView/OutputView` a cada quadro. Cachear a vista de saída por textura do pool e a de entrada por ponteiro de textura WGC (poucas rotacionam). S-M, ganho pequeno de CPU.
- **Áudio do jogo** (`audio.rs`, `publish.rs` das opções): `TrackPublishOptions` usa `..Default::default()`. Definir `audio_encoding` com 96-128 kbps estéreo e `dtx: false` (DTX corta ambiente/passos baixos), e verificar se o SDP realmente negocia estéreo **(conferir os campos `dtx`, `red` e `audio_encoding` em livekit-rust 0.12.0)**. Para música/jogo, 96 kbps é um bom ponto; custo de banda: +50 kbps. S.
- **Perfil release do workspace**: adicionar no `Cargo.toml` raiz `[profile.release] lto = "thin"`, `codegen-units = 1`, `panic = "abort"`, `strip = true` (afeta `core` e `server`). Ganho de CPU pequeno (o trabalho pesado é GPU/FFI), mas reduz binário e partida. **Atenção:** `panic = "abort"` mata o processo em vez de desenrolar; o `core` já trata falha por saída do processo. S.
- **Intra-refresh**: no NVENC (H.264) `-intra-refresh 1` elimina IDR periódico e recupera perda gradualmente. Os decodificadores do Chromium dependem de recovery-point SEI e podem pedir PLI de qualquer jeito. Só investigar depois dos itens 4-5.
- **GOP**: IDR forçado a cada 2 s duas vezes (`gop_size` em `encoder.rs:99` e `publish.rs:442-444`); com PLI já tratado (`publish.rs:386`), subir para 4-6 s economiza ~3-6% de bitrate. Depende do item 4. S.
- **Quadros perdidos 1,12%** em P3 (4K60): sugerir medir com fonte em movimento (nota no `resultados.md`); o item 3 deve ajudar.

---

## Fazer já na v0.3.x (seguro e pequeno)

1. Chat sem `toLocaleTimeString` por render + `React.memo` (item 6.1).
2. Parar o intervalo de 150 ms quando a página está oculta e só repintar medidores com alguém falando (item 6.2).
3. `MinimumUpdateIntervalSettings::Custom` na captura WGC (item 3), com medição antes e depois via `stats`.
4. Prioridade ABOVE_NORMAL + opt-out de EcoQoS no sidecar (item 7, sem MMCSS ainda).
5. `rc_max_rate`/`rc_buffer_size` + NVENC `rc=cbr` (item 4), atrás de flag de CLI para comparar.
6. Histerese no pedido de bitrate e reaproveitar o `Converter` (item 5, partes a, b).
7. `livekit.yaml`: `audio.update_interval: 200`, `smooth_intervals: 2` e `enabled_codecs` (item 10). Pode ir sem nova versão do app.
8. Config de captura de voz explícita + escolha de microfone e saída no `Settings.tsx` (item 8, parte S).
9. `audio_encoding` e `dtx: false` no áudio de jogo do sidecar (item "Núcleo").
10. Cache do `SwsContext` no caminho de CPU.

## Depois (precisa de medição ou é recurso novo)

- Nó em São Paulo (item 1).
- Pausa do sidecar sem espectadores (item 2).
- NVENC `high` + `p3/p4` e escolha automática por carga (item 9).
- RNNoise opcional (item 8).
- Atalhos globais, push-to-talk e bandeja (Tauri).
- `MemoryUsageTargetLevel(LOW)` ao minimizar.
- `use_send_side_bwe`, `pli_throttle`, playout delay (item 10): testar um por vez com `scripts/medir-latencia.ps1`.
- Paralelizar miniaturas de fontes.
- MMCSS nas threads de áudio/captura; intra-refresh; GOP maior.

## O que não fiz / não conferi
- Nada foi compilado nem medido. Não li `core/src/main.rs`, `cli.rs`, `probe.rs`, `GoLive.tsx` por inteiro nem `Settings.tsx`.
- Chaves de config marcadas **(conferir)** dependem da versão (LiveKit 1.13.11, livekit-rust 0.12.0, windows-capture 2.0.1, FFmpeg 9.1).
- Estimativas de ganho são ordens de grandeza, não números medidos.

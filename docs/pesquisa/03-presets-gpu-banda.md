# Presets de screen share por GPU e banda (pesquisa)

Data: 2026-11-24. Escopo: app de screen share com LiveKit (WebRTC), encode na GPU do sharer, SFU na Contabo US East, viewers no Brasil.

Confiança: **[F]** fonte primária/documentação; **[S]** fonte secundária; **[E]** estimativa minha, validar com teste real.

## 1. Suporte de encode por GPU

### 1.1 NVIDIA (NVENC)

Fonte: [NVIDIA Video Encode and Decode GPU Support Matrix](https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix-new) [F]

| Família | NVENC | H.264 | HEVC | AV1 encode | Sessões (GeForce) |
|---|---|---|---|---|---|
| Pascal (GTX 10xx) | 6ª | 4:2:0, 4:4:4. Sem 4:2:2 | 4K, 8K, 10-bit. Sem B-frames | Não | 12 |
| Turing (GTX 16xx, RTX 20xx) | 6ª / 7ª | Igual ao Pascal | 7ª: 4K 4:4:4, 10-bit, B-frames | Não | 12 |
| Ampere (RTX 30xx) | 7ª | 4:2:0, 4:4:4 | 4K, 8K, 10-bit, B-frames | **Não** (só decode) | 12 |
| Ada (RTX 40xx) | 8ª | 4:2:0, 4:4:4 | Igual ao Ampere | Sim, 4:2:0 | 12 |
| Blackwell (RTX 50xx) | 9ª | Completo, com 4:2:2 | Completo, com 4:2:2 | Sim, 4:2:0 | 12 |

Notas [F]:
- O limite de 12 sessões é de driver GeForce. Pro e data center não têm esse teto.
- GTX 1080 tem 2 NVENC; RTX 3060, 4060 e 5060 têm 1.
- Tamanho de AV1: SDK 12.0 cita até 8192x8192 ([NVENC App Note 12.0](https://docs.nvidia.com/video-technologies/video-codec-sdk/12.0/nvenc-application-note/index.html)) [F].
- Máquina de casa (memória: 5600G + RTX 5060) tem NVENC 9ª geração com AV1. É a GPU de referência do app.

### 1.2 AMD (AMF / VCN)

Fonte: [AMF wiki, GPU and APU HW Features](https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/GPU-and-APU-HW-Features-and-Support) [F]; visão geral em [Wikipedia, VCN](https://en.wikipedia.org/wiki/Video_Core_Next) [S].

| Família | VCN | H.264 enc | HEVC enc | AV1 enc |
|---|---|---|---|---|
| Ryzen 5000 APU (5600G, Cezanne) | 2.0 | 4K | 4K | **Não** |
| RDNA1 (RX 55xx-57xx) | 2.0 | 4K | 4K | **Não** |
| RDNA2 (RX 66xx-69xx) | 3.0 | 4K | 8K | **Não** (só decode) |
| RDNA3 (RX 75xx-79xx) | 4.0 | 4K | 8K | 8K, 8/10-bit |
| RDNA3 APU (Phoenix, Ryzen 8xxx) | 4.0 | 4K | 8K | 8K, 8/10-bit |
| RDNA4 (RX 906x-907x) | 5.0 | 4K | 8K | 8K, 8/10-bit |

Notas [F]:
- AV1 encode só a partir do VCN 4.0, em uma instância de VCN (exceto Strix Halo). Em placas com dois VCN, sessão AV1 concorrente é limitada.
- RDNA3 exige largura e altura divisíveis por 64 no AV1 ([HandBrake, VCN](https://handbrake.fr/docs/en/1.10.0/technical/video-vcn.html)). Arredondar a resolução.
- Linux: driver AMD 24.20 ou superior, segundo o HandBrake.
- Relato isolado de RX 9070 XT sem VA-API de H.264/HEVC no Fedora [S]. Sinal de driver, não de hardware.

### 1.3 Intel (Quick Sync / Arc)

Fontes: [Intel Media Engine Hardware](https://www.intel.com/content/www/us/en/docs/oneapi/optimization-guide-gpu/2025-2/media-engine-hardware.html) [F], [oneVPL Features](https://www.intel.com/content/www/us/en/docs/onevpl/developer-reference-media-intel-hardware/1-1/features-and-formats.html) [F], [HandBrake, Quick Sync](https://handbrake.fr/docs/en/1.10.0/technical/video-qsv.html) [F].

| Família | H.264 enc | HEVC enc | AV1 enc |
|---|---|---|---|
| UHD 630 / Coffee Lake (9ª Core) | Sim | Sim | Não |
| UHD 730 / 770 (12ª-13ª Core) | Sim | Sim | **Não confirmado** (tabela em imagem) |
| Arc A-series e Server GPU | Sim | Sim | **Sim** ("add AV1 encode") |
| Battlemage, Core Ultra | Não confirmado | Não confirmado | Não confirmado |

Linux com Arc: kernel 6.2+, Mesa atualizado e firmware HuC. Limites de sessão e resolução por codec não lidos (imagem).

## 2. Decode e suporte WebRTC no viewer

| Codec | Chrome/Edge | Firefox | Safari/iOS | Observação |
|---|---|---|---|---|
| H.264 | Sim | Sim | Sim | Fallback universal |
| VP8 | Sim | Sim | Sim | Sem SVC |
| VP9 | Sim (desde Chrome 48) | Sim, sem simulcast por padrão | Sim | Dynacast só pausa stream inteiro com SVC |
| AV1 | Sim (Chrome 113+) | Sim (Firefox 136+, com simulcast) | **Experimental** | Bom para tela; não usar como base no Safari |
| H.265 | Envia/recebe em caminho com hardware; padrão de 2026 não confirmado | **Não** | Não confirmado | Edge **não publica** H.265 em WebRTC ([Microsoft Q&A](https://learn.microsoft.com/en-ca/answers/questions/5880331/h-265-(hevc)-not-published-sent-via-webrtc-chrome)) [S] |

Fontes: [MDN, WebRTC codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/WebRTC_codecs) [F]; [Chrome AV1 blog](https://developer.chrome.com/blog/av1.md.txt) [F]; [blink-dev, H265 WebRTC](https://groups.google.com/a/chromium.org/g/blink-dev/c/3h8lL8a377c) [F]; [IETF draft HEVC WebRTC](https://datatracker.ietf.org/doc/html/draft-ietf-avtcore-hevc-webrtc) [F] (H.265 é opcional).

LiveKit: [codecs](https://docs.livekit.io/guides/video-codecs/) [F] e [advanced](https://docs.livekit.io/transport/media/advanced.md) [F]. H.264, VP8, VP9 (SVC) e AV1 (SVC). Simulcast ligado por padrão. A página não traz matriz por cliente nem fallback.

**Regra:** H.264 é o seguro para todos. AV1 só se todos os viewers forem Chrome/Firefox recentes. HEVC fica fora deste app.

## 3. Bitrates recomendados para screen share

### 3.1 Referências

| Fonte | Valor | Confiança |
|---|---|---|
| LiveKit JS `ScreenSharePresets` ([options.ts v2.19.1](https://cdn.jsdelivr.net/npm/livekit-client@2.19.1/src/room/track/options.ts)) | 720p15 1,5 Mbps; 720p30 2,0; 1080p15 2,5; 1080p30 5,0; original 7,0 (máx.) | [F] |
| Mesmo arquivo | Não há preset de 1440p ou 1080p60 para screen share | [F] |
| LiveKit Rust ([options.rs v0.7.44](https://docs.rs/crate/livekit/0.7.44/source/src/room/options.rs)) | Em screen share, bitrate máx. cai para VP9 (~0,85x) e AV1 (~0,7x) | [F] |
| Twitch 1080p60 | Teto 6.000 kbps; guias sugerem 4.500-6.000 | [S] ([OBSBOT](https://www.obsbot.com/blog/live-streaming/twitch-bitrate)) |
| YouTube 1080p60 | Fontes divergem (4,5-9 ou 17 Mbps). Não confirmado | [S] ([fonte](https://hacecuentas.com/en/bandwidth-streaming-bitrate-resolution-youtube)) |
| Discord Go Live | Sem valor oficial encontrado | Lacuna |

### 3.2 Tabela proposta (kbps)

Base H.264 pelas referências; AV1 com fator 0,7x. Presets 1440p e 4K são **[E]**: a LiveKit não publica.

| Preset | Codec | Min | Alvo | Máx | Base |
|---|---|---|---|---|---|
| 720p30 | H.264 | 1.200 | 2.000 | 2.500 | LiveKit [F] |
| 720p30 | AV1 | 800 | 1.400 | 1.800 | 0,7x [F] + [E] |
| 1080p30 | H.264 | 3.000 | 4.500 | 5.000 | LiveKit [F] |
| 1080p30 | AV1 | 2.200 | 3.200 | 3.500 | [E] |
| 1080p60 texto/desktop | H.264 | 4.500 | 6.000 | 7.000 | Twitch [S] + [E] |
| 1080p60 jogo/motion | H.264 | 6.000 | 8.000 | 10.000 | [E] |
| 1080p60 texto/desktop | AV1 | 3.200 | 4.200 | 5.000 | [E] |
| 1440p60 | H.264 | 7.000 | 10.000 | 12.000 | [E] |
| 1440p60 | AV1 | 5.000 | 7.000 | 8.500 | [E] |
| 4K30 | H.264 | 10.000 | 15.000 | 18.000 | [E] |
| 4K30 | AV1 | 7.500 | 10.500 | 13.000 | [E] |
| 4K60 | H.264 | 18.000 | 25.000 | 30.000 | [E] |
| 4K60 | AV1 | 13.000 | 18.000 | 22.000 | [E] |
| 1440p120 / 4K120 | — | — | — | — | Sem fonte. Não habilitar por padrão |

Captura: `resolution` padrão de 1080 fora do Safari ([options.ts](https://cdn.jsdelivr.net/npm/livekit-client@2.19.1/src/room/track/options.ts)) [F]. Para 1440p/4K, pedir a resolução explicitamente.

## 4. Matemática de banda

### 4.1 Upload do sharer

Upload = stream principal + camadas de simulcast. Duas camadas somam ~30% [E]. Recomendado = 2x de folga [E].

| Preset (H.264, alvo) | Upload com simulcast | Recomendado |
|---|---|---|
| 720p30 (2 Mbps) | ~2,6 Mbps | 5 Mbps |
| 1080p30 (4,5) | ~5,9 | 12 |
| 1080p60 (6) | ~7,8 | 16 |
| 1440p60 (10) | ~13 | 26 |
| 4K30 (15) | ~19,5 | 40 |
| 4K60 (25) | ~32,5 | 65 |

### 4.2 Egress por viewer

Egress = bitrate da camada recebida. 1080p60 a 6 Mbps: 6 Mbps x 3.600 s = 21,6 Gb = **2,7 GB/h por viewer**.

### 4.3 Cenário: 5 amigos, 3 h/dia, 1080p60 a 6 Mbps

| Item | Conta | Resultado |
|---|---|---|
| Egress por viewer/dia | 2,7 GB x 3 h | 8,1 GB |
| Egress total/dia | 8,1 x 5 | 40,5 GB |
| Egress total/mês (30 dias) | 40,5 x 30 | **~1,2 TB** |
| Pico na porta | 5 x 6 Mbps | 30 Mbps |

Contabo Cloud VPS 4: porta de **200 Mbit/s** e tráfego **ilimitado com fair use** ([Contabo VPS](https://contabo.com/en-us/vps) [F]). Throttle é possível em uso excessivo; limite exato não documentado [S]. Com 30 Mbps de pico em 1080p60, cabe com folga. Em 4K60, 5 viewers somam ~125 Mbps, ainda dentro dos 200. Teto teórico contínuo: ~65 TB/mês. Risco real é o fair use, não a porta.

### 4.4 Upload típico no Brasil

- Ookla, mar/2026: download médio fixo de 221,5 Mbps ([Teletime](https://teletime.com.br/04/05/2026/221-mbps-velocidade-banda-larga-brasil/)) [S].
- V-Speed, 1º tri/2026: upload médio agregado de **100,6 Mbps** ([Portal IN](https://www.portalin.com.br/negocios/brasil-supera-media-global-em-velocidade-de-internet-e-fortalece-avanco-de-provedores-regionais/)) [S]. Metodologia diferente da Ookla.
- Upload por plano (500 Mega, 1 Giga) não encontrado. Medir no app.
- RTT Brasil → US East: estimativa [E] de 120-160 ms. Afeta atraso, não banda.

## 5. Regras práticas para o app

Entrada: `vendor`, `geração` (chip ou VCN), `upload_medido` (teste até o VPS, Mbps), `capacidades_viewers` (AV1 sim/não).

```
# 1. Capacidade de encode (fonte: tabelas 1.1-1.3)
NVIDIA: av1 = geração >= Ada ; h264 = sempre ; sessões = 12 (GeForce)
AMD:    av1 = VCN >= 4.0     ; h264 = sempre
Intel:  av1 = Arc A-series ou Server (UHD 730/770 = não confirmado, tratar como não)
Sem encoder de hardware: nenhum preset

# 2. Banda
util = upload_medido x 0,5
habilitar preset P SE util >= P.upload_recomendado (tabela 4.1)

# 3. Carga de GPU (teste de 10 s antes de transmitir)
desabilitar preset SE uso do encoder > 80% OU fps real < 95% do alvo
4K60 e 1440p60 exigem NVENC Ada+ ou dGPU dedicada

# 4. Codec
SE todos os viewers anunciam AV1 E nenhum é Safari/iOS: AV1 (SVC, L3T3_KEY)
SENAO: H.264 com simulcast

# 5. Simulcast
camada_media = metade da resolução, metade do bitrate
camada_baixa = 1/4 da resolução, 0,25x do bitrate, 5-15 fps

# 6. Padrão [E, validar]
upload >= 12 Mbps: 1080p30 H.264
upload < 12 Mbps: 720p30
1080p60 texto só se upload >= 16 Mbps e GPU suporta
```

- AV1 com SVC: Dynacast pausa só o stream inteiro ([LiveKit](https://docs.livekit.io/guides/video-codecs/) [F]).
- Não liberar 4K60 ou 1440p120 sem teste aprovado na máquina.

## Lacunas

1. Sessões concorrentes e resolução máxima por codec em AMD e Intel: tabelas em imagem ou sem limite por modelo.
2. Latência de encode (NVENC, VCN, Quick Sync): sem número oficial.
3. Intel UHD 730/770, Battlemage e Core Ultra com AV1 encode: não confirmado.
4. Presets de screen share 1440p/4K na LiveKit: não existem no código lido. Tabela 3.2 é estimativa.
5. Default de `contentHint` e de codec para screen share na LiveKit: fontes conflitam ou não dizem.
6. H.265 em WebRTC no Chrome (2026) e no Safari: estado padrão não confirmado.
7. YouTube 1080p60 e Discord Go Live: sem valor oficial.
8. Upload médio por plano de fibra no Brasil: não encontrado.
9. RTT Brasil → US East e existência de SFU em São Paulo na Contabo: não verificado.
10. Limite exato de fair use da Contabo: não documentado nas páginas lidas.
11. Preço Contabo Cloud VPS 4: fontes divergem (€4,40 e €5,50). Conferir a página atual.
12. AV1 com 4:2:2 em Blackwell: fórum aponta lacuna na matriz da NVIDIA.

# Pesquisa técnica: LiveKit + Rust + Tauri para app de voz e tela

Data da pesquisa: 24/11/2026. Pesquisa somente leitura na web. Nada foi instalado, compilado ou clonado.

Legenda: **[confirmado]** = visto na fonte primária citada. **[inferência]** = conclusão minha a partir das fontes. **[lacuna]** = não consegui confirmar.

## Resumo

- LiveKit Rust SDK: crate `livekit` 0.12.0 (changelog de 18/11/2026). Aceleração por hardware documentada só para Linux e Apple. Windows (NVENC/AMF/QSV) **não está documentado**.
- Caminho viável no Windows: codificar na GPU por conta própria (NVENC/AMF/QSV) e publicar com `NativeVideoSource::new_encoded` + `capture_encoded_frame` (vídeo pré-codificado).
- Captura de tela: `windows-capture` 2.0.1 (WGC e DXGI) entrega frames em CPU. Não achei caminho zero-copy documentado.
- Áudio do jogo: WASAPI process loopback (por PID, incluindo filhos). Requer Windows 10 build 20348 ou superior.
- Assinatura: Artifact Signing (antigo Trusted Signing) não aceita indivíduo do Brasil. Para o app, o caminho provável é certificado OV/EV comercial, a confirmar.
- Servidor: portas 7880/TCP, 7881/TCP, 50000-60000/UDP (ou 7882/UDP em modo mux), TURN 3478/UDP e 5349/TLS (443 sem load balancer).

---

## 1. LiveKit Rust SDK (`livekit`, `libwebrtc`, `livekit-api`)

**Versão.** [confirmado] `livekit` 0.12.0, entrada de 18/11/2026 no changelog. Fonte: [CHANGELOG do crate livekit](https://raw.githubusercontent.com/livekit/rust-sdks/main/livekit/CHANGELOG.md) e [docs.rs NativeVideoSource (livekit 0.12.0)](https://docs.rs/livekit/latest/livekit/webrtc/video_source/native/struct.NativeVideoSource.html).
[lacuna] Uma busca retornou `livekit` 0.7.42 (21/05/2026) em docs.rs. Ela está desatualizada em relação ao changelog. Confirmar no crates.io antes de fixar versão.

**Hardware encoding (fonte oficial).** [confirmado] A documentação do SDK (Rust e Python) lista:

| Plataforma | Codec por hardware | Fonte |
|---|---|---|
| Apple Silicon | VideoToolbox: H.264, H.265 | [docs LiveKit, encoders](https://docs.livekit.io/robotics/media/video/encoders/) |
| NVIDIA dGPU (Linux) | NVENC: H.264, H.265, AV1 | mesma página |
| AMD e Intel (Linux) | VAAPI: H.264 | mesma página |
| NVIDIA Jetson | MMAPI: H.264, H.265, AV1 (AV1 exige Orin) | mesma página |
| Windows | **não listado** | [README do rust-sdks](https://raw.githubusercontent.com/livekit/rust-sdks/main/README.md) |

- VP9 não aparece como codificador por hardware em nenhuma linha.
- **Ativação:** [confirmado] automática. O SDK usa o encoder de hardware quando a plataforma oferece um para o codec negociado; senão, cai para software. A página não cita variável de ambiente nem opção de configuração.
- **Build no Linux:** o README exige CUDA toolkit e `CUDA_HOME` para NVENC, e clang-21 para o build. Fonte: [README do rust-sdks](https://raw.githubusercontent.com/livekit/rust-sdks/main/README.md).
- **Problemas conhecidos (changelog):** [confirmado] 0.9.7 corrigiu vazamento no encoder VAAPI H.264 e erro falso no NVIDIA/Jetson quando uma camada de simulcast era pausada. 0.10.0 corrigiu carregamento do plugin Jetson. 0.10.1 permite H.265 pré-codificado mesmo sem encoder H.265 local. Fonte: [CHANGELOG](https://raw.githubusercontent.com/livekit/rust-sdks/main/livekit/CHANGELOG.md).

**Codecs.** H.264 e H.265 por hardware no NVIDIA dGPU. AV1 por hardware no NVIDIA, dependendo da GPU. VP9 só por software. Detalhes de codec da NVENC em [NVIDIA Video Codec SDK 12.1 (tabela de capacidades)](https://docs.nvidia.com/video-technologies/video-codec-sdk/12.1/nvenc-application-note/index.html).

**Simulcast e SVC.** [confirmado] A checklist oficial marca "Simulcast", "SVC codecs (AV1/VP9)" e "Dynacast" como suportados. "Adaptive Streaming" não está marcado. Fonte: [README do rust-sdks](https://raw.githubusercontent.com/livekit/rust-sdks/main/README.md).
[lacuna] Não achei na documentação Rust os nomes de `scalabilityMode` (L1T3, L3T3) nem como configurá-los. A página de publicação que consultei é da SDK Python.

**Screen share content hint.** [lacuna] Não encontrei `contentHint` na API Rust. O equivalente que achei é o parâmetro `is_screencast` de `NativeVideoSource::new(resolution, is_screencast)`. [lacuna] Não está claro o que ele muda.

**Log de versões relevantes (changelog):** 0.9.6 (20/10/2026), 0.9.7 (23/10/2026), 0.10.0 (28/10/2026), 0.10.1 (04/11/2026), 0.11.0 (13/11/2026), 0.12.0 (18/11/2026). Nenhuma entrada menciona AV1, SVC ou screen share de forma específica.

**livekit-api.** [confirmado] Docs.rs mostra `livekit-api` 0.11.0 com módulo `livekit_api::access_token` (`AccessToken`, `VideoGrants`). Fonte: [docs.rs livekit-api access_token](https://docs.rs/livekit-api/latest/livekit_api/access_token/index.html). [lacuna] Outra busca retornou 0.5.1 e 0.6.3. Conferir no crates.io.

---

## 2. Captura de tela no Windows e entrada no `NativeVideoSource`

**Crates de captura.**

| Crate | O que a fonte confirma | Limite |
|---|---|---|
| `windows-capture` 2.0.1 | Usa Windows Graphics Capture (WGC) e DXGI Desktop Duplication. Captura janela ou monitor. Opções de cursor (`CursorCaptureSettings`) e borda (`DrawBorderSettings`). Frames via `frame.buffer()` em CPU. Fonte: [README](https://github.com/NiiightmareXD/windows-capture) | HDR não mencionado. Versão mínima do Windows não informada. Sem números de benchmark. |
| `xcap` | Windows 8.1 ou superior. Captura de janela em X11, macOS e Windows. Gravação de janela "a desenvolver". Fonte: [README](https://github.com/nashaofu/xcap) | Cursor só tem efeito no macOS. HDR não mencionado. Gravação em desenvolvimento. |
| `scap` | [lacuna] O URL que testei retornou 404. Não consegui confirmar. | — |
| `crabgrab` | [lacuna] Não pesquisado. | — |

Para o caso de jogo em 1440p60 e 4K, `windows-capture` é o candidato mais maduro dos que li. A escolha entre WGC e DXGI precisa de teste no seu hardware.

**Entrada no LiveKit.** [confirmado] `NativeVideoSource`:
- `new(resolution: VideoResolution, is_screencast: bool)`
- `capture_frame<T: AsRef<dyn VideoBuffer>>(&self, frame: &VideoFrame<T>) -> bool`
- `new_encoded(resolution)` e `capture_encoded_frame(&self, frame: &EncodedVideoFrame) -> bool` para vídeo pré-codificado
- `take_keyframe_request()` e `take_rate_control_request()` para feedback do encoder

Fonte: [docs.rs NativeVideoSource](https://docs.rs/livekit/latest/livekit/webrtc/video_source/native/struct.NativeVideoSource.html).

**Zero-copy.** [lacuna] A documentação não diz que `capture_frame` aceita textura GPU do DXGI/D3D11 no Windows. O único caminho zero-copy documentado é DMA-buf, e é só para Jetson e marcado como depreciado. Fonte: mesma página.
[inferência] Na prática, o caminho é: WGC/DXGI entrega BGRA em GPU, copia para CPU, converte para I420/NV12 e chama `capture_frame`. Em 4K60 isso custa CPU e banda de memória. Por isso o caminho com encoder próprio (seção 5) tende a ser o melhor no Windows.

**Caminho alternativo (recomendado para testar).** [inferência] Capturar com WGC, codificar na GPU por NVENC (via Video Codec SDK) ou AMF ou QSV, e publicar o bitstream com `capture_encoded_frame`. A changelog 0.10.1 confirma que vídeo pré-codificado H.265 funciona sem encoder local. Isso evita a conversão para I420 na CPU. O custo é que você passa a cuidar de keyframes, rate control e formato do access unit.

---

## 3. Áudio do sistema e do jogo no Windows

**Loopback do sistema inteiro (WASAPI).** [confirmado] Modo loopback captura mistura do dispositivo de renderização. Só funciona em modo compartilhado; exclusivo não funciona. Fonte: [Loopback Recording (Microsoft Learn, 16/04/2025)](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording).
[confirmado] Esse modo pega tudo que toca no sistema, incluindo o áudio dos seus amigos se eles estiverem na mesma máquina. Vai precisar de filtro (ver AEC abaixo).

**Process loopback (por processo).** [confirmado] `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS` tem `TargetProcessId` e `ProcessLoopbackMode` (incluir ou excluir a árvore do processo, ou seja, o processo e seus filhos). Versão mínima: Windows 10 build 20348. Ativação por `ActivateAudioInterfaceAsync`. Fonte: [docs AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ns-audioclientactivationparams-audioclient_process_loopback_params).
[inferência] Para o jogo, use o PID do executável principal e modo "include". Jogos com launcher separado podem ter o áudio num processo filho. O modo "include" da árvore cobre isso.

**Crates.** [lacuna] `wasapi` (HEnquist/wasapi-rs) tem constantes de process loopback e um exemplo `record_application`. Não confirmei a API completa nem a versão atual. Fonte: [wasapi-rs](https://github.com/HEnquist/wasapi-rs). `cpal` não foi verificado para process loopback. Para sistema inteiro, cpal pode servir, mas não confirmei.

**Publicar áudio no LiveKit.** [lacuna] Não consultei a API de áudio do `livekit` Rust (`NativeAudioSource` ou equivalente). Preciso confirmar o nome e o formato de entrada antes de codar.

**Cancelamento de eco e ruído.**
- `webrtc-audio-processing` 2.0.x: wrapper do módulo APM do WebRTC (AEC, AGC, NS, VAD). Feature `bundled` compila o C++. Fonte: [docs.rs](https://docs.rs/webrtc-audio-processing/latest/webrtc_audio_processing/).
- `libwebrtc` 0.3.32 tem `apm.rs` com flags para AEC, AGC, high-pass e supressão de ruído. Fonte: [docs.rs libwebrtc 0.3.32](https://docs.rs/crate/libwebrtc/0.3.32/source/src/native/apm.rs).
- `sonora` 0.1.0: port em Rust puro de AEC3, supressão de ruído e AGC2. Maturidade não verificada. Fonte: [docs.rs sonora](https://docs.rs/crate/sonora/0.1.0).
- `aec3` 0.2.0: port em Rust do AEC3. Supressão de ruído estava planejada em versões anteriores. Fonte: [docs.rs aec3](https://docs.rs/crate/aec3/0.2.0).
- [lacuna] RNNoise e DeepFilterNet não pesquisados.
- [lacuna] Não confirmei se o LiveKit aplica APM automaticamente ao publicar áudio de fonte nativa.

---

## 4. Alternativa: mídia no WebView2 com o SDK JS do LiveKit

**O que a documentação LiveKit diz.** [confirmado] `setScreenShareEnabled(true)` abre o seletor de tela, janela ou aba. Áudio só existe com aba do navegador e a opção "Share tab audio" marcada. Áudio de janela ou de sistema não é capturado. "Audio sharing is only possible in certain browsers." Fonte: [docs LiveKit, screenshare](https://docs.livekit.io/transport/media/screenshare/).

**WebView2.** [lacuna] Não confirmei na documentação se `getDisplayMedia` está disponível no WebView2 nem se traz áudio do sistema. A página de flags do WebView2 não cita captura de tela. Cita `msWebView2TextureStream`, que transmite frames capturados ou compostos ao JS, mas é flag de desenvolvimento e não está documentado como caminho de produção. Fonte: [WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags). Os flags também avisam que apps de produção não devem usá-los.

**Comparação honesta para o seu caso.**

| Critério | JS no WebView2 | Pipeline Rust |
|---|---|---|
| Captura de janela ou jogo | Depende do seletor do WebView2 (não confirmado) | WGC ou DXGI diretos |
| Áudio do jogo | Limitado a aba do navegador (documentado) | Process loopback por PID |
| Codificação na GPU | Chromium decide (não controlável) | Você escolhe NVENC, AMF ou QSV |
| Qualidade e bitrate por perfil | Via `setScreenShareEnabled` e opções da SDK | Controle total |
| Complexidade | Baixa | Alta |

[inferência] Para 1440p60 e 4K com áudio de jogo, a pipeline Rust é o único caminho que cumpre o requisito com o que a documentação confirma. O JS no WebView2 pode servir só para a interface.

**Projetos Tauri + LiveKit.** Não achei exemplo oficial. O mais próximo é o [Hopp (tmchow/hopp)](https://github.com/tmchow/hopp), um app de pair programming em Tauri com LiveKit e screen share anunciado. [lacuna] Não li o código. O exemplo oficial do rust-sdks não tem screen share no que consegui ver ([README de exemplos](https://raw.githubusercontent.com/livekit/rust-sdks/main/examples/README.md) retornou 404; o exemplo pode ter mudado de lugar).

---

## 5. Detectar capacidades de encoder de GPU no Windows

**NVENC.** [confirmado] SDK 12.0 adicionou AV1 para 4:2:0 8 e 10 bits. Na tabela da SDK 12.1, AV1 main profile aparece para GPUs Ada. HEVC main10 e 4:4:4 para Pascal ou mais novo. HEVC B-frames só para Ada ou mais novo. SDK 13.0 adicionou HEVC 4:2:2 para Blackwell. Fonte: [NVENC Application Note 12.1](https://docs.nvidia.com/video-technologies/video-codec-sdk/12.1/nvenc-application-note/index.html) e [13.0](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvenc-application-note/index.html).
[lacuna] A assinatura de `nvEncGetEncodeCaps` não foi confirmada. A fonte que tenho está na SDK e no `nvEncodeAPI.h`.
[inferência] A consulta ideal é `nvEncGetEncodeCaps` por codec depois de abrir a sessão, porque reflete o driver instalado.

**Abordagem prática recomendada (proposta, não verificada):**
1. Enumerar adaptadores DXGI e ler o vendor ID: 0x10DE NVIDIA, 0x1002 AMD, 0x8086 Intel.
2. Tentar abrir a sessão do encoder do fornecedor (NVENC, AMF ou QSV) para H.264, H.265 e AV1. Se falhar, marcar como indisponível.
3. Fazer um teste curto de codificação com o perfil escolhido antes de liberar a resolução ao usuário.

Não é necessário tabela de IDs de dispositivo, porque o teste real é mais confiável.

**AMF e QSV.** [lacuna] Não pesquisei a API de capacidades do AMF nem do oneVPL/QSV. Media Foundation enumeration de MFTs de hardware também não.

---

## 6. livekit-server self-hosted

**Portas (documentação oficial).** [confirmado] Fonte: [LiveKit, ports e firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/).

| Serviço | Protocolo | Porta | Chave de config | Exposta |
|---|---|---|---|---|
| API e WebSocket | TCP | 7880 | `port` | Atrás de load balancer com SSL |
| ICE/TCP | TCP | 7881 | `rtc.tcp_port` | Sim |
| ICE/UDP | UDP | 50000-60000 | `rtc.port_range_start/end` | Sim (2 portas por participante) |
| ICE/UDP mux (opcional) | UDP | 7882 | `rtc.udp_port` | Sim; se definido, o range não é usado |
| TURN/UDP (opcional) | UDP | 3478 | `turn.udp_port` | Sim |
| TURN/TLS (opcional) | TLS | 5349 | `turn.tls_port` | Sim; deve ser 443 sem load balancer |

- TURN/UDP na 443 é opcional, para redes que liberam UDP 443. Fonte: [docs LiveKit, deployment](https://docs.livekit.io/transport/self-hosting/deployment/).
- [lacuna] Um guia de terceiros (governo francês) usa 7881/TCP, 7882/UDP e 443/UDP para TURN. Não é documentação oficial. Fonte: [guia Meet](https://documentation-meet.beta.numerique.gouv.fr/self-hosting/configuration/firewall/).

**Config mínima para grupo privado (base na docs oficial, sem valores de exemplo copiados):**
- `port: 7880`
- `rtc.tcp_port: 7881`, `rtc.port_range_start: 50000`, `rtc.port_range_end: 60000`
- `rtc.use_external_ip: true` (recomendado em nuvem com IP público que o processo não vê)
- `keys:` com par API key e secret, em segredo (nunca no git)
- `turn.enabled: true`, `turn.domain` igual ao certificado TLS, `turn.tls_port: 5349` (ou 443 sem load balancer)
- Redis: recomendado para produção. [lacuna] A documentação não diz se é obrigatório em nó único.

Fonte: [docs LiveKit, deployment](https://docs.livekit.io/transport/self-hosting/deployment/).

**Recursos por stream.** [lacuna] A documentação diz que a escala depende de CPU e banda, e recomenda 10 Gbps. Não há número de consumo por stream nem dimensionamento para 4 vCPU e 8 GB. Só dá para estimar com teste de carga.

**Latência Brasil para US East.** [inferência] Não verificado. O VPS fica em US East e os usuários no Brasil. Isso adiciona RTT alto para voz. Medir antes de decidir. Se o problema aparecer, a alternativa é um VPS em São Paulo, se o provedor tiver.

**Token em Rust.** [confirmado] `livekit-api` expõe `AccessToken` e `VideoGrants` em `livekit_api::access_token`. [lacuna] A página não mostra exemplo de código, TTL padrão nem como definir permissões de sala. Fonte: [docs.rs access_token](https://docs.rs/livekit-api/latest/livekit_api/access_token/index.html).

---

## 7. Assinatura de código para o instalador Tauri

**Artifact Signing (antigo Azure Trusted Signing).** [confirmado] Quickstart atualizado em 20/11/2026:
- Certificados Public Trust para organizações: EUA, Canadá, UE, Reino Unido, Austrália, Nova Zelândia, Japão, Coreia do Sul, Singapura, Suíça, Noruega e Israel. **Brasil não está na lista.**
- Desenvolvedor individual: "must be located in the United States or Canada". **Brasil não é elegível.**
- Brazil South aparece como região para hospedar o recurso. Isso não muda quem pode validar identidade.
- Fonte: [Quickstart Artifact Signing](https://learn.microsoft.com/azure/artifact-signing/quickstart).
- [lacuna] Uma resposta do Microsoft Q&A indica que, em 11/2026, indivíduos fora de EUA e Canadá não conseguem enviar novas solicitações públicas. Fonte: [Q&A](https://learn.microsoft.com/en-us/answers/questions/2238411/how-do-i-do-trusted-signing-identity-verification). É fonte secundária.

**OV e EV comerciais.** [confirmado] Tauri documenta OV e EV via `certificateThumbprint`, `digestAlgorithm` e `timestampUrl` em `bundle > windows` do `tauri.conf.json`, ou via `signCommand`. Também informa que EV e OV agora geram reputação SmartScreen do mesmo jeito, então um release novo ainda pode mostrar aviso. Fonte: [Tauri, Windows signing](https://tauri.app/distribute/sign/windows/).
[lacuna] Preço e emissor brasileiro não pesquisados.

**Artifact Signing via Tauri.** [confirmado] Tauri documenta `artifact-signing-cli` (instalado com Cargo) com `signCommand` (`-e`, `-a`, `-c`). Fonte: mesma página. Não serve para você por causa da elegibilidade acima.

**Assinatura do updater.** [confirmado] `tauri signer generate -w ...` gera o par de chaves. A chave pública vai em `plugins.updater.pubkey` (string completa). A privada vai em `TAURI_SIGNING_PRIVATE_KEY` (e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, se houver). `.env` não funciona. Perder a chave privada impede publicar updates para quem já instalou (aviso da doc v1). Fontes: [Tauri v2 updater](https://v2.tauri.app/plugin/updater/) (via busca) e [guia de chaves do updater](https://davidthegnomad.github.io/gnomad-desktop-assistant/UPDATER.html) (terceiros).
[lacuna] A página oficial de updater não foi lida por completo.

**Windows 11 Smart App Control.** [confirmado] Tauri informa que pode bloquear app sem assinatura. Fonte: [Tauri, Windows signing](https://tauri.app/distribute/sign/windows/).

---

## Riscos e lacunas

1. **Windows sem encoder por hardware documentado no LiveKit.** Se a SDK não usar NVENC no Windows, a encodagem em software em 4K60 pode ser inviável. Testar cedo, com o encoder próprio (seção 2).
2. **Zero-copy não confirmado.** Não achei caminho de textura GPU para `capture_frame` no Windows. O custo de CPU para 4K60 é uma hipótese.
3. **Scalability mode e content hint não confirmados na API Rust.** Só achei `is_screencast`.
4. **Versões conflitantes.** `livekit` 0.12.0 (changelog) contra 0.7.42 (busca). `livekit-api` 0.11.0 (docs.rs) contra 0.5.1 e 0.6.3 (busca). Conferir no crates.io.
5. **`scap` e `crabgrab` não confirmados.** O URL do `scap` deu 404.
6. **API de áudio do `livekit` Rust não lida.** Não sei o nome exato de `NativeAudioSource` nem se o SDK aplica APM por conta própria.
7. **RNNoise e DeepFilterNet não pesquisados.**
8. **`nvEncGetEncodeCaps` sem assinatura confirmada.** AMF e QSV não pesquisados. Media Foundation não pesquisado.
9. **WebView2 e `getDisplayMedia` não confirmados.** Não sei se há áudio do sistema ali.
10. **Process loopback no Windows 10 build 20348.** Confirmado na doc. Não confirmei o comportamento de versões Windows 10 ou 11 recentes além disso.
11. **Recursos do VPS 4 vCPU e 8 GB.** Sem número de consumo por stream. Precisa de teste de carga.
12. **Latência Brasil para US East.** Não medida.
13. **Assinatura para indivíduo no Brasil.** Artifact Signing não atende. Falta confirmar preço e emissor de OV/EV aceito para quem está no Brasil.
14. **Projeto Hopp não lido.** Exemplo Tauri + LiveKit + screen share é só indicação.
15. **Código não testado.** Nada foi compilado nem executado. Todas as afirmações vêm de documentação, changelog e READMEs.

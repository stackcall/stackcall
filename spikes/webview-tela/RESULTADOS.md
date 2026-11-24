# P6 · Transmissão de tela pelo WebView2

## Reproduzir no Windows

Na pasta `spikes/webview-tela`, com Node.js 20.19+ ou 22.12+, Rust MSVC, ferramentas de build C++ e WebView2 Runtime:

```powershell
npm ci
npm run tauri dev
```

Ensaio local em 24/11/2026 com Windows build 26300, WebView2 157.0.4341.60, Intel Iris Xe (driver 32.0.101.7088) e uma janela de teste com relógio animado. O app abriu via `npm run tauri dev`. `npm run build` e `cargo build --locked` passaram.

## 1. Captura

| Pedido | WebView2 | Falha e motivo |
| --- | --- | --- |
| Seletor nativo | Abriu na janela Tauri e ofereceu **Janela** e **Tela Inteira**. | Nenhum bloqueio de permissão observado. |
| 3840 × 2160 a 60 fps | `getSettings()`: 3840 × 2160, 60 fps, `displaySurface: window` e `resizeMode: crop-and-scale`. | A janela de origem era menor. As dimensões descrevem a saída redimensionada e os 60 fps são a configuração da trilha. |
| Pedir áudio | Zero trilhas na captura da janela de teste. | O seletor ofereceu **Compartilhar áudio do sistema**. A opção ficou desmarcada neste ensaio, então ainda falta provar áudio do jogo. |

O WebView2 documenta o evento nativo `ScreenCaptureStarting` para `getDisplayMedia`. O host pode cancelar ou adiar o seletor, mas a API do evento não recebe uma fonte escolhida pelo app. O Tauri expõe o WebView2 nativo por `with_webview`. Se o seletor falhar, um seletor próprio pode usar `GraphicsCapturePicker` com captura nativa, o que exige um caminho separado para entregar os quadros. A API web exige consentimento a cada captura. [WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2screencapturestartingeventargs) · [Tauri](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html#method.with_webview) · [GraphicsCapturePicker](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturepicker) · [Screen Capture](https://w3c.github.io/mediacapture-screen-share/)

## 2. Prévia

| Pedido | WebView2 | Falha e motivo |
| --- | --- | --- |
| Prévia e fps por `requestVideoFrameCallback` | O vídeo exibiu quadros. Duas amostras de cerca de 1 s deram **26,6** e **33,0 fps**. | A prévia ficou abaixo de 60 fps nas duas amostras. O teste não isola fonte, captura e renderização. |

## 3. Codecs

| Pedido | WebView2 | Falha e motivo |
| --- | --- | --- |
| H.264 a 1080p60 | RTP sim. `supported`, `smooth` e `powerEfficient` retornaram `true`. | Uso do codificador físico pendente. |
| VP9 a 1080p60 | RTP sim. `supported`, `smooth` e `powerEfficient` retornaram `true`. | Uso do codificador físico pendente. |
| AV1 a 1080p60 | RTP sim. `supported` e `smooth` retornaram `true`. `powerEfficient` retornou `false`. | O runtime não indicou codificação eficiente nessa configuração. |
| H.265 a 1080p60 | Ausente do RTP. As três propriedades retornaram `false`. | O runtime não ofereceu H.265 para envio neste ambiente. |

As consultas usaram 8 Mbit/s e o primeiro perfil anunciado de cada codec. `powerEfficient` é uma estimativa do runtime. A confirmação de uso físico depende do motor **Video Encode** durante o envio. [Media Capabilities](https://w3c.github.io/media-capabilities/#dom-mediacapabilitiesinfo-powerefficient)

## 4. Publicação

| Pedido | WebView2 | Falha e motivo |
| --- | --- | --- |
| H.264 em 1080p60 e 1440p60 com fps, bitrate e `qualityLimitationReason` | Pendente no PC de casa | O ensaio com LiveKit e GPU dedicada ficou para essa máquina. |

### Ensaio no PC de casa

1. Abra o spike e registre Windows, WebView2, GPU, driver e resolução e taxa de atualização da fonte. Execute **Consultar codecs**.
2. Solicite captura de uma tela com movimento contínuo e som conhecido. Se o seletor mostrar a opção de áudio, marque-a. Registre a fonte, as configurações reais, o total de trilhas de áudio e os fps da prévia. Repita com a janela do jogo para distinguir áudio do sistema e áudio da janela.
3. Cole a URL e um token de publicação da P1. Se a P1 ainda estiver indisponível, rode `livekit-server --dev` localmente e gere um token temporário no terminal com `lk token create --dev --join --room p6 --identity p6-emissor --valid-for 10m`. Use `ws://localhost:7880`. Gere outro token com identidade distinta para o espectador e use o LiveKit Meet apontado para o mesmo servidor. As credenciais de desenvolvimento servem para o servidor local. [CLI do LiveKit](https://docs.livekit.io/reference/developer-tools/livekit-cli/rooms/)
4. Publique em 1080p60 por pelo menos 60 segundos com um espectador conectado. Anote resolução e codec RTP reais, fps, bitrate em bit/s, motivo de limitação e se o espectador ouviu o jogo. Anote também o uso de CPU e do motor **Video Encode** no Gerenciador de Tarefas.
5. Desconecte, encerre a captura e capture novamente antes de publicar em 1440p60. Repita as medições. Use uma fonte de no mínimo 2560 × 1440 a 60 Hz para esse preset. Os botões solicitam limites de resolução e fps, que podem cair conforme a fonte, a carga e a rede.

**Conclusão:** o WebView2 é candidato a reserva com captura de janela confirmada e prévia de 26,6 a 33,0 fps nas amostras, mas a qualidade máxima de transmissão e o som do jogo seguem sem validação.

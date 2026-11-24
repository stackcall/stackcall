# Resultados da fase 0

Medições do Claude Code em 24/11/2026. Servidor: VPS Contabo (EUA leste), LiveKit 1.13.11 e porteiro 0.1.0 em `stackcall.80-190-79-129.sslip.io`.

| Prova | Máquina | Data | Comando | Resultado | Passou | Observações |
|---|---|---|---|---|---|---|
| P1 | Notebook (rede da empresa) → VPS | 24/11 13:25 | Token do porteiro + LiveKit Meet | Porteiro: saúde ok, token 200, convite errado 401. Cliente entrou na sala e conectou por UDP. | Sim (conexão) | Voz nos dois sentidos não testada: o navegador de teste bloqueia o microfone. Fica para o app v0.1. |
| P2 | PC de casa, RTX 5060 → VPS → notebook | 24/11 13:57 | `publish --codec h264 --res 1080p --fps 60 --bitrate 6000 --source 'window:Stackcall Clock' --duration 120` | Atraso de ponta a ponta ~215 ms (3 amostras, relógios corrigidos por `w32tm`). 59,5 fps, CPU do processo 0,5 a 0,9%, codificador da GPU 5%, codificação p95 1,2 ms. | Sim | Quadros perdidos na captura: ~0,5% (janela estática). |
| P3 | PC de casa, RTX 5060 | 24/11 14:00 | `publish --codec av1 --res 4k --fps 60 --bitrate 18000 --source 'window:Stackcall Clock' --duration 600` | 10 minutos estáveis: 59,3 fps, 391 quadros perdidos de ~35 mil (1,12%), CPU máx. 1,5%, GPU máx. 19%, p95 máx. 10,3 ms, 8,7 Mbps médios. O notebook recebeu 3840x2160. | Quase | 1,12% contra a meta de 1%. As perdas são na captura (`captured_fps` = `encoded_fps`), não no codificador. Rever a contagem com fonte em movimento. |
| P4 | — | — | — | Não medida | — | Precisa de um jogo tocando som no PC de casa, com alguém presente. |
| P5 | Notebook (rede da empresa) | 24/11 13:23 | `scripts/medir-latencia.ps1 -Ip 80.190.79.129` | HTTP: mediana 138 ms, p95 154 ms. ICMP 149 ms. | Sim | Comparação no mesmo horário: Discord voz Brasil 31 a 43 ms; Discord Atlanta ~150 ms; Fluxer 164 a 225 ms. |
| P6 | Notebook, Iris Xe | 24/11 13:00 | `spikes/webview-tela` | Seletor nativo abriu no WebView2. Trilha 3840x2160 a 60 fps; prévia medida 26 a 33 fps. H.264, VP9 e AV1 oferecidos; H.264 e VP9 com hardware. | Sim (como reserva) | Sem áudio do sistema. Envio real pelo LiveKit não medido. |

## Probe do codificador na RTX 5060 (quadros sintéticos)

| Codificador | 720p30 | 1080p60 | 1440p60 | 4K60 |
|---|---|---|---|---|
| `h264_nvenc` | 1059 fps | 564 fps | 332 fps | 150 fps (p95 6,9 ms) |
| `av1_nvenc` | 804 fps | 569 fps | 326 fps | 157 fps (p95 6,5 ms) |
| `h264_amf` (Vega do 5600G) | 650 fps | 320 fps | 185 fps | 85 fps (p95 23,6 ms) |

Indisponíveis nessa máquina: `av1_amf`, `h264_qsv` e `av1_qsv`, como previsto (a placa integrada é VCN 2.0 e não há Intel).

## Conclusão

O caminho escolhido funciona: captura WGC → FFmpeg NVENC → vídeo pré-codificado no LiveKit. Ele roda com folga de 2,6 vezes em 4K60 AV1 e quase nenhuma CPU. A fase 1 pode seguir com o núcleo Rust para a v0.2, enquanto a v0.1 usa o WebView2.

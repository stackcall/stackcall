# Núcleo Go Live

Prova técnica Windows x64 para P2 (H.264), P3 (AV1) e P4 (áudio do jogo).
O token da sala deve permitir publicação e trazer a identidade `<usuário>:tela`.

## Compilar

Instale Rust para `x86_64-pc-windows-msvc`, Visual Studio 2022 Build Tools com
C++ e Windows SDK, e LLVM x64 com `libclang.dll`. O SDK LiveKit baixa o
WebRTC pré-compilado durante o build. Use Windows 11 para as provas com áudio.
O loopback por processo requer build 20348 ou posterior.

Execute `scripts/preparar-ffmpeg.ps1 -OnlyDownload` na raiz do repositório
para baixar, conferir o SHA-256 e configurar o FFmpeg LGPL fixado para a sessão.
O diretório indicado em `FFMPEG_DIR` fica fora do repositório e deve
conter `include`, `lib` e `bin`. A compilação usa as bibliotecas de importação
MSVC. O WebRTC pré-compilado usa o runtime C++ estático. O FFmpeg
continua vinculado por DLL. As chamadas importam explicitamente
`avcodec-63.dll`, `avutil-61.dll` e `swscale-10.dll` para separar o FFmpeg
LGPL dos símbolos internos do WebRTC. A pilha de 16 MiB evita o estouro observado ao gerar as bindings
do FFmpeg com bindgen. Use um diretório de build curto para que o MSVC
encontre os cabeçalhos aninhados do WebRTC. Para executar, mantenha o diretório `bin` no PATH ou coloque as DLLs
dele ao lado de `stackcall-core.exe`.

```powershell
& ./scripts/preparar-ffmpeg.ps1 -OnlyDownload
$env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'sc-target'
$env:RUSTFLAGS = '-C target-feature=+crt-static -C link-arg=/STACK:16777216'
cargo test --locked
cargo build --locked --release
$exe = Join-Path $env:CARGO_TARGET_DIR 'release\stackcall-core.exe'
& $exe probe
& $exe sources
& $exe clock
```

Use os drivers atuais do fabricante. A opção `--cpu-path` faz a leitura da
textura e a conversão BGRA → NV12 na CPU, mantendo a codificação no
hardware. O caminho padrão usa o processador de vídeo D3D11 para converter e
redimensionar a textura na GPU. Quick Sync tenta mapear as superfícies D3D11 para QSV.
Se a sessão D3D11 não abrir, o núcleo tenta a conversão na CPU com o mesmo codificador de hardware.

## Executar as provas

Defina `$url` e `$token` na sessão com os dados da sala de teste. Use
um JWT de curta duração. A passagem como argumento deixa o token visível
a ferramentas locais que leem a linha de comando do processo.

```powershell
# P2
& $exe publish --url $url --token $token --codec h264 --res 1080p --fps 60 --bitrate 6000 --source 'window:CS2'

# P3
& $exe publish --url $url --token $token --codec av1 --res 4k --fps 60 --bitrate 18000 --source monitor:0 --duration 600

# P4
& $exe publish --url $url --token $token --codec h264 --res 1080p --fps 60 --bitrate 6000 --source 'window:CS2' --audio-pid $gamePid
```

O índice de monitor começa em zero, `window:` usa o título exato e
`pid:` seleciona a primeira janela capturável com esse PID.
`--encoder auto` tenta NVENC, AMF e QSV em ordem. Use Ctrl+C para parar.

`publish --pause-when-alone` é experimental e vem desligado. Após o primeiro
quadro, a codificação e o envio de vídeo pausam quando a sala fica sem
participantes remotos e voltam com um quadro-chave quando alguém entra.
Com participantes presentes, o SDK não informa quando o último espectador
cancela a inscrição na faixa. A captura de áudio continua durante a pausa.

Para medir atraso, abra `clock` e repita P2 com `--source 'window:Stackcall Clock'`.
Abra a transmissão no LiveKit Meet e tire uma captura com os dois relógios
lado a lado. Subtraia o horário da transmissão do horário da janela original.
A prova P2 pede menos de 400 ms e CPU abaixo de 15% na RTX 5060. P3 pede
10 minutos com até 1% de quadros perdidos. Em P4, confira a sincronia e
mantenha a chamada em outro processo para verificar o isolamento.

## JSON no stdout

`sources` imprime um array de objetos com `id`, `title`, `process_name`,
`pid`, `width`, `height`, `minimized` e `thumbnail`. Passe o `id` diretamente em
`publish --source`. Monitores têm `process_name` e `pid` nulos. A miniatura
é um PNG de até 320 × 320 px codificado em base64. O campo pode ser nulo
quando o Windows não entrega um quadro para prévia.
Janelas minimizadas usam o tamanho restaurado ou o do monitor, sem miniatura.
Se o Windows não informar nenhum tamanho utilizável, `width` e `height` são nulos.

`probe` imprime um objeto com `adapters` e `trials`. Cada adaptador
inclui `name`, `driver_version` (versão DXGI em quatro partes ou texto vazio
quando indisponível),
`vendor_id` (decimal), `vendor`, `dedicated_bytes` e `shared_bytes`.
Cada ensaio inclui `encoder`, `resolution`, `target_fps`
e `ok`. O ensaio processa até cinco segundos de quadros sintéticos NV12
sem espera entre quadros. Cada amostra tem um teto de 1,5 s de processamento
antes de drenar o codificador. Assim, `fps` mede a capacidade inclusive
acima da taxa nominal.

```json
{"encoder":"av1_qsv","resolution":"4k","target_fps":60,"ok":false,"error":"opening av1_qsv"}
```

Um ensaio bem-sucedido inclui `fps`, `encoded_frames`, `encode_ms_p50`,
`encode_ms_p95` e `encoder_load_percent` (taxa nominal dividida pela taxa
medida, em porcentagem, limitada a 100). Os percentis medem da submissão
até a saída do pacote. O teste cobre os seis presets da seção 3.2 do plano.

`publish --control-stdin` aceita uma linha JSON por comando: `{"cmd":"stop"}`,
`{"cmd":"bitrate","kbps":4500}` ou `{"cmd":"keyframe"}`. Passe o token como
primeira linha do stdin antes dos comandos ou por `--token`.
Fechar o stdin encerra a transmissão. Com essa opção, cada evento ocupa
uma linha no stdout. `started` é emitido após o primeiro quadro codificado e
inclui `encoder` e `cpu_path` (se a conversão ocorre na CPU). `stats` sai a cada dois segundos. O evento final é `stopped`
ou `error` com `reason`. Sem `--control-stdin`, as estatísticas mantêm o
formato original e o intervalo de cinco segundos.

```json
{"event":"stats","captured_fps":60.0,"encoded_fps":59.8,"dropped_frames":1,"encode_ms_p50":2.2,"encode_ms_p95":4.1,"bitrate_kbps":5800.0,"cpu_percent":11.0,"gpu_encoder_percent":34}
```

`captured_fps` conta callbacks WGC. `dropped_frames` conta intervalos
da taxa solicitada sem quadro entre callbacks aceitos. A captura pode
reduzir a cadência em conteúdo estático. `bitrate_kbps` mede o payload
codificado, sem cabeçalhos de transporte. CPU é normalizada pelo número de núcleos lógicos disponíveis. A leitura NVML, quando disponível, mede o primeiro dispositivo
NVIDIA e inclui outras sessões de codificação. Leituras indisponíveis
e percentis sem amostras saem como `null`.

### Opções experimentais de publicação

| Flag | Efeito |
|---|---|
| `--limit-capture-fps` | Pede ao WGC um intervalo mínimo de até 90% do período do FPS alvo, ajustado à frequência da tela. Em versões do Windows sem suporte, usa a captura padrão. |
| `--cbr` | Ativa CBR de baixa latência e configura VBV de 100 ms. |
| `--adaptive-bitrate` | Aplica mudanças de pelo menos 20%, com intervalo mínimo de três segundos. QSV tenta ajustar a sessão ativa. Ao reabrir o encoder, reaproveita o conversor se o tamanho da fonte for o mesmo. |
| `--cache-cpu-scaler` | Reaproveita o contexto de escala e o buffer BGRA na conversão pela CPU. |
| `--hardware-quality` | Tenta H.264 High e volta ao perfil anterior se o encoder recusar a abertura. |
| `--nvenc-probe <arquivo>` | Com `--hardware-quality`, lê a recomendação de preset do probe. |

Para testar presets NVENC, salve o JSON de `probe --hardware-quality` em UTF-8.
Acrescente `--cbr` ao probe quando for usar CBR na publicação. O probe tenta
`p4` e `p3` nessa ordem. A recomendação exige carga estimada de até 60% e p95
de codificação de até 60% do período de um quadro. A publicação usa a recomendação
do mesmo codec, resolução, FPS e modo CBR. Sem recomendação aplicável ou se o
encoder recusar o preset, usa `p1`.

O backend pré-codificado do LiveKit 0.12.0 anuncia H.264 constrained baseline.
Teste `--hardware-quality` com os espectadores alvo antes de ativar H.264 High
no app.

Com `--audio-pid`, o som do jogo usa Opus com teto de 96 kbps e DTX desativado.

## Pontos para validar em hardware

O código-fonte do LiveKit 0.12.0 com libwebrtc 0.4.2 expõe
`EncodedVideoCodec::H264` e `AV1` e aceita a publicação pelo backend
`PreEncoded`. O áudio usa `NativeAudioSource` com PCM estéreo i16 a 48 kHz
em blocos de 10 ms. A entrega, a latência, os formatos dos access units e a
sincronia precisam das provas na sala. Sem `--adaptive-bitrate`, uma mudança
relevante de bitrate solicitada pelo SDK reabre o encoder e inicia com um keyframe.

Em máquinas híbridas, o caminho na GPU exige que o dispositivo D3D11 da
captura seja compatível com o encoder escolhido. Se necessário, selecione
a GPU de alto desempenho nas configurações gráficas do Windows para o
executável de teste.

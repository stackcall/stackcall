# Prompt T3: P2 a P4, núcleo Rust "Go Live"

Modelo: Codex `gpt-6.1-sol`, esforço high. Branch: `feat/fase0-nucleo`.

---

Você está no repositório `stackcall/stackcall`. Leia antes de começar: `AGENTS.md`, `docs/PLANO.md` (seções 2.1, 2.2, 3 e 5), `docs/pesquisa/01-tecnica-livekit-rust.md` e `docs/pesquisa/03-presets-gpu-banda.md`. Siga as regras do `AGENTS.md`: Conventional Commits, nada copiado de projetos AGPL/GPL nem do Discord, nenhum segredo no git, **nenhum gancho dentro de jogos** (anti-cheat).

## Contexto

O Stackcall transmite a tela de quem joga para os amigos. A codificação do vídeo precisa acontecer na placa de vídeo de quem transmite (NVENC, AMF ou Quick Sync). O servidor LiveKit só repassa.

O SDK Rust do LiveKit (`livekit`) **não documenta** codificação por hardware no Windows. Por isso o caminho escolhido é este:

1. Capturar a tela pelo Windows Graphics Capture (crate `windows-capture`).
2. Codificar na GPU com o FFmpeg (crate `ffmpeg-next`, build LGPL com DLLs, link dinâmico): `h264_nvenc`, `av1_nvenc`, `h264_amf`, `av1_amf`, `h264_qsv`, `av1_qsv`.
3. Publicar o vídeo já codificado no LiveKit com `NativeVideoSource::new_encoded` + `capture_encoded_frame` (confirmado no changelog do `livekit` 0.10.1 para H.265; confira H.264 e AV1 no código-fonte da versão que você fixar).
4. Capturar o som só do jogo por WASAPI process loopback (`AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`, modo incluir a árvore do processo; crate `wasapi` ou chamada direta via `windows`).

Esta tarefa é uma **prova técnica**: o objetivo é medir se o caminho funciona e quanto custa. Código limpo e bem estruturado, mas sem interface gráfica.

## Entregáveis

### 1. Workspace Cargo na raiz

Membros: `core` (binário `stackcall-core`) e, se a sua divisão pedir, `server` já existente em outra branch (não dependa dele).

### 2. `stackcall-core probe`

- Lista os adaptadores de vídeo (DXGI): fabricante (`0x10DE` NVIDIA, `0x1002` AMD, `0x8086` Intel), nome e memória.
- Para cada codificador candidato do FFmpeg: tenta abrir uma sessão e codifica 3 segundos de quadros sintéticos em 720p30, 1080p60, 1440p60 e 4K60.
- Mede fps alcançado e tempo de codificação por quadro (p50 e p95).
- Saída JSON no stdout (formato documentado em `core/README.md`). É a base do futuro `sonda.exe`, que roda num processo separado: estruture o código para isso (função pura que recebe opções e devolve o resultado).
- Uma falha de codificador vira `"ok": false` com o erro, nunca derruba o programa.

### 3. `stackcall-core publish`

```
stackcall-core publish --url <wss://...> --token <JWT> \
  --source monitor:0 | window:"<título>" | pid:<n> \
  --codec h264|av1 --res 720p|1080p|1440p|4k --fps 30|60 --bitrate <kbps> \
  [--encoder auto|nvenc|amf|qsv] [--audio-pid <n>] [--cpu-path] [--duration <s>]
```

- Entra na sala como o participante do token (o token já traz a identidade `<usuario>:tela`).
- Publica uma trilha de vídeo de tela pré-codificada, marcada como screencast.
- **Caminho na GPU (padrão):** textura D3D11 do WGC → quadro de hardware do FFmpeg (`AV_HWDEVICE_TYPE_D3D11VA`) → codificador. Evite copiar para a CPU.
- **Caminho na CPU (`--cpu-path`):** BGRA → NV12 na CPU → codificador. Serve para comparar.
- Atende os pedidos do servidor: `take_keyframe_request()` gera um keyframe; `take_rate_control_request()` ajusta o bitrate.
- Keyframe a cada 2 segundos e sem B-frames (baixa latência).
- `--audio-pid`: publica o som daquele processo e dos filhos como trilha de áudio (Opus pelo SDK). Confirme o nome e o formato da fonte de áudio nativa na versão fixada do `livekit`.
- A cada 5 segundos, uma linha JSON no stdout com:
  - fps capturado, fps codificado, quadros perdidos;
  - codificação em ms (p50/p95);
  - bitrate real;
  - CPU do processo (%);
  - uso do codificador da GPU, quando der para ler (NVML na NVIDIA via `nvml-wrapper`; nos outros fabricantes, deixe nulo).
- Encerra limpo com Ctrl+C ou `--duration`.

### 4. `core/README.md`

- Como obter o FFmpeg LGPL com DLLs (por exemplo, o build `lgpl-shared` do BtbN) e onde colocar as DLLs.
- Como compilar no Windows (MSVC) e as dependências do sistema.
- Exemplos de comando para cada prova abaixo.
- Formato das saídas JSON.

### 5. Teste do relógio para medir atraso

`stackcall-core clock`: abre uma janela simples que mostra um relógio com milissegundos, grande. Quem mede transmite essa janela e tira um print com ela e com a transmissão lado a lado. A diferença entre os dois relógios é o atraso de ponta a ponta.

## Provas e critérios (medidos depois no PC de casa pelo Claude Code)

| Prova | Comando | Passa se |
|---|---|---|
| P2 | `publish --codec h264 --res 1080p --fps 60 --bitrate 6000 --source window:"CS2"` | Assistido no LiveKit Meet; atraso abaixo de 400 ms pelo relógio; CPU do processo abaixo de 15% numa RTX 5060 |
| P3 | `publish --codec av1 --res 4k --fps 60 --bitrate 18000` | Estável por 10 minutos, sem quadros perdidos acima de 1% |
| P4 | P2 com `--audio-pid <pid do jogo>` | Som sincronizado com o vídeo e sem a voz dos amigos misturada |

No seu ambiente, prove só o que dá sem placa dedicada: compilação, testes unitários (conversão de resolução e bitrate, formato JSON, análise dos argumentos) e o `probe` rodando com o que houver (mesmo que só software).

## Se o caminho pré-codificado não funcionar

Se `new_encoded` não aceitar H.264 ou AV1 nesta versão do SDK, não force um contorno frágil. Documente o motivo exato (versão, função, erro), implemente o modo de reserva `--fallback-sdk` (quadros I420 para `NativeVideoSource::new` e codificação pelo próprio SDK) e registre no PR. A decisão fica com o Filippe.

## Fora do escopo

- Interface gráfica, Tauri, login, chat.
- Simulcast e várias camadas (fase 2).
- Linux e macOS.

## Ao terminar

- Commits pequenos em Conventional Commits.
- PR para a `main` com: o que foi feito, como compilar, o que foi testado aqui, o que depende do teste no PC de casa e os riscos encontrados.
- Não marque nada como "funcionando" sem ter executado.

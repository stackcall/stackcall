# Plano: Stackcall, app próprio de voz e tela (Tauri + LiveKit)

Nome: **Stackcall** (decidido em 24/11; antes, codinome Telão). Versão 1 do plano, 24/11/2026. Base: as três pesquisas em `pesquisa/`.

Objetivo: um app instalado (.exe) para o Filippe e os amigos. Salas de voz, transmissão de tela em 720p30 até 4K60 conforme a placa de cada um, som do jogo junto, chat simples e entrada só por convite. A VPS só repassa o vídeo; quem codifica é a placa de vídeo de quem transmite.

---

## 1. Decisões que ficam com o Filippe

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Onde hospedar o servidor | **VPS atual (Contabo)**, decidido em 24/11 por custo. Nome grátis pelo sslip.io (ver D2), sem ligação com o nome do Fivestack. Limites de memória nos containers. Bitrate total do app limitado a 100 Mbit/s para sobrar porta para o Fivestack. |
| D2 | Nome do app | **Decidido em 24/11: Stackcall.** Sem domínio comprado no início: o servidor usa `stackcall.80-190-79-129.sslip.io` (grátis, sem conta, certificado Let's Encrypt pelo Caddy). Domínio próprio só quando o código ficar público, se valer a pena. |
| D3 | Licença | **Decidido em 24/11: código privado no início, público depois.** Copiar código só de projetos MIT/Apache. Projetos AGPL (Fluxer, Element Call) entram só como ideia. Assim a abertura futura fica livre. |
| D4 | Assinatura do .exe | **Decidido em 24/11: sem certificado no início.** Os amigos passam pelo aviso do SmartScreen ("Executar assim mesmo"). Quem tem o Smart App Control ligado fica bloqueado. Quando o código ficar público: pedir a assinatura grátis da SignPath Foundation (exige licença aberta, repositório público e build no GitHub Actions). Plano B pago: Certum Open Source, a partir de cerca de €69. |
| D5 | Quem programa | No T3 Code: núcleo de mídia em Rust e servidor com o Codex; interface com o Claude. |
| D6 | Repositório | **Decidido em 24/11: organização nova `stackcall` no GitHub**, repositório privado `stackcall/stackcall`. O Filippe cria a organização e o repositório; o primeiro push leva o plano e a estrutura. |

---

## 2. Arquitetura

```
 PC de quem transmite                         VPS                        PC de quem assiste
┌──────────────────────────┐          ┌────────────────────┐          ┌──────────────────────┐
│ Interface (WebView2)     │◄──WSS───►│ Porteiro (Rust)    │◄──WSS───►│ Interface (WebView2) │
│  voz, chat, assistir     │          │  convites, contas, │          │  voz, chat, assistir │
│                          │          │  tokens, chat      │          │                      │
│ Núcleo Rust "Go Live"    │          │                    │          │                      │
│  captura WGC             │──WebRTC─►│ livekit-server     │──WebRTC─►│ decodifica na GPU    │
│  codifica na GPU         │  (UDP)   │  só repassa (SFU)  │  (UDP)   │  (Chromium)          │
│  som do jogo (loopback)  │          │                    │          │                      │
└──────────────────────────┘          └────────────────────┘          └──────────────────────┘
```

### 2.1 Cliente (Tauri 2)

O cliente tem duas partes.

1. **Interface web (WebView2):** React + Vite + TypeScript + Tailwind + componentes Radix/shadcn. Usa o SDK JS do LiveKit (`livekit-client`) para três coisas: voz do microfone, assistir transmissões e chat. O WebView2 é um Chromium. Ele decodifica H.264 e AV1 na GPU de quem assiste sem código nosso.
2. **Núcleo Rust "Go Live":** só para transmitir a tela. Entra na sala como um segundo participante (`<usuario>:tela`) e publica vídeo e som do jogo. A interface mostra esse participante como a transmissão do usuário, não como outra pessoa.

Por que separar: o SDK JS não captura o som do jogo no Windows e não deixa escolher o codificador da GPU. O núcleo Rust faz as duas coisas.

### 2.2 Pipeline de transmissão (Rust)

| Etapa | Peça | Estado |
|---|---|---|
| Captura de tela ou janela | `windows-capture` (Windows Graphics Capture) | Crate maduro; entrega o quadro já na GPU (D3D11) |
| Codificação na GPU | **FFmpeg** (`ffmpeg-next`): `h264_nvenc`/`av1_nvenc`, `h264_amf`/`av1_amf`, `h264_qsv`/`av1_qsv` | Uma API para NVIDIA, AMD e Intel. Entrada D3D11 evita copiar para a CPU. **Validar na fase 0.** |
| Envio | `livekit` Rust: `NativeVideoSource::new_encoded` + `capture_encoded_frame` | Vídeo pré-codificado confirmado no changelog 0.10.1 |
| Som do jogo | WASAPI process loopback por PID (crate `wasapi`), modo "incluir filhos" | Windows 10 build 20348 ou mais novo |
| Pedidos do servidor | `take_keyframe_request()` e `take_rate_control_request()` | O núcleo gera keyframe e muda o bitrate quando o LiveKit pede |

Motivo do FFmpeg: o SDK Rust do LiveKit só documenta codificação por hardware no Linux e no Mac. No Windows, codificamos por conta própria e entregamos o vídeo pronto. O FFmpeg vai como DLL (LGPL, link dinâmico), então não contamina a licença do app.

### 2.3 Servidor (VPS)

| Serviço | Função | RAM estimada |
|---|---|---|
| `livekit-server` | Repassa voz e vídeo | 50 a 150 MB, depende do número de transmissões; medir |
| Porteiro (Rust, axum + SQLite) | Convites, contas (senha com argon2), salas, permissão de transmitir, emissão de token do LiveKit (`livekit-api`), histórico do chat | 20 a 40 MB |
| Caddy | HTTPS do porteiro e do WebSocket do LiveKit | já existe ou 15 MB |

Portas abertas na internet: 443/tcp (Caddy), 7881/tcp, 7882/udp (modo mux, uma porta só) e o TURN em 3478/udp e 5349/tcp para redes que bloqueiam UDP.

Banda: a Contabo Cloud VPS 4 tem porta de 200 Mbit/s e tráfego "ilimitado com fair use". O cenário de 5 amigos, 3 h por dia, em 1080p60, dá cerca de 1,2 TB por mês e 30 Mbit/s de pico. Cabe com folga.

---

## 3. Qualidade da transmissão por placa

### 3.1 O que cada placa codifica

| Placa | H.264 | AV1 |
|---|---|---|
| NVIDIA GTX 10xx, 16xx, RTX 20xx, 30xx | Sim | Não |
| NVIDIA RTX 40xx e 50xx (a RTX 5060 de casa) | Sim | **Sim** |
| AMD Ryzen 5000G (Vega), RX 5000, RX 6000 | Sim | Não |
| AMD RX 7000, RX 9000, Ryzen 8000G | Sim | **Sim** |
| Intel UHD 630 | Sim | Não |
| Intel Arc | Sim | **Sim** |

HEVC fica de fora: o WebRTC do Chromium e do WebView2 não publica HEVC.

Como todos usam o nosso app, todos conseguem assistir AV1, mesmo sem decodificador de AV1 na placa (o Chromium decodifica por software). Por isso o AV1 vira o padrão quando a placa de quem transmite codifica AV1.

### 3.2 Presets e banda

| Preset | Codec | Bitrate alvo | Upload necessário (com folga) | Dados por pessoa assistindo |
|---|---|---|---|---|
| 720p 30 fps | H.264 / AV1 | 2,0 / 1,4 Mbps | 5 Mbps | 0,9 / 0,6 GB por hora |
| 1080p 30 fps | H.264 / AV1 | 4,5 / 3,2 Mbps | 12 Mbps | 2,0 / 1,4 GB por hora |
| 1080p 60 fps | H.264 / AV1 | 6 a 8 / 4,2 Mbps | 16 Mbps | 2,7 a 3,6 / 1,9 GB por hora |
| 1440p 60 fps | H.264 / AV1 | 10 / 7 Mbps | 26 Mbps | 4,5 / 3,2 GB por hora |
| 4K 30 fps | H.264 / AV1 | 15 / 10,5 Mbps | 40 Mbps | 6,8 / 4,7 GB por hora |
| 4K 60 fps | H.264 / AV1 | 25 / 18 Mbps | 65 Mbps | 11 / 8,1 GB por hora |

Os valores de 1440p e 4K são estimativas. A fase 0 mede a qualidade real e ajusta a tabela.

### 3.3 Regra do seletor

Na primeira vez, o app faz um teste de 15 segundos. O teste roda num processo separado (`sonda.exe`), como o `gpu_encoder_helper.exe` do Discord: se o driver travar, o app continua aberto.

1. **Placa:** lê o fabricante e o modelo (DXGI). Tenta abrir cada codificador (H.264 e AV1) no FFmpeg.
2. **Carga:** codifica 5 segundos de cada preset candidato. Mede os quadros por segundo reais e o uso do codificador.
3. **Upload:** manda dados para o porteiro por 5 segundos e mede a velocidade.

Depois do teste, cada preset aparece como cartão com um destes estados:

- **Disponível:** mostra o upload que vai usar, a carga estimada da placa e os dados por hora de cada pessoa que assistir.
- **Bloqueado, com motivo:** "sua placa não codifica AV1", "seu upload aguenta até 1080p60" ou "a placa não segurou 60 fps neste preset".

Regras:

```
preset liberado  = placa codifica E fps_medido >= 95% do alvo E uso_encoder <= 80%
                   E upload_medido x 0,5 >= upload_necessario
codec            = AV1 se a placa codifica AV1, senão H.264
padrão sugerido  = o maior preset liberado até 1080p60
4K e 1440p       = só aparecem se o teste passou nesta máquina
```

O teste refaz sozinho quando o driver da placa muda, e o usuário pode refazer pelas configurações.

---

## 4. Interface

**Direção visual escolhida em 24/11: Sala de Controle** (mesa de corte de TV e multiview do OBS, escuro neutro com roxo só no que está no ar). Protótipo das telas no canvas "Stackcall: direções visuais". Componentes, cores, botões e fontes serão ajustados depois.

Atualização dentro do app, versão e changelog: ver [VERSIONAMENTO.md](VERSIONAMENTO.md).

### 4.1 Layout principal

- **Coluna esquerda:** salas de voz fixas (por exemplo "Geral", "CS", "Filme"), com quem está em cada uma e um ícone ao vivo em quem transmite.
- **Centro:** o palco. Quando alguém transmite, o palco muda sozinho para destaque (ideia do Element Call). Sem transmissão, mostra a grade de quem está falando.
- **Direita:** chat da sala e lista de participantes. Pode recolher.
- **Barra inferior:** microfone, fone, **Go Live**, câmera, configurações e sair.

### 4.2 Fluxo "Go Live"

1. O usuário clica em **Go Live**.
2. O app mostra miniaturas das telas e janelas abertas.
3. Ao escolher um jogo, o app já marca "transmitir som deste app" (process loopback do PID da janela).
4. O app mostra os cartões de qualidade da seção 3.3, com prévia ao vivo do preset escolhido.
5. O usuário clica em **Transmitir**.

### 4.3 Recursos de quem assiste e da voz

| Recurso | Fase | Ideia vinda de |
|---|---|---|
| Assistir só quando clicar (economiza banda, como no Discord) | 1 | Discord |
| Contador "3 assistindo" | 1 | ideia própria |
| Tela cheia e janela solta (picture-in-picture) | 2 | Discord e Jitsi |
| Volume por pessoa e por transmissão | 1 | LiveKit Meet |
| Push-to-talk com atalho global (plugin `global-shortcut` do Tauri) | 2 | Discord |
| Supressão de ruído (a do Chromium na fase 1; RNNoise na fase 2) | 1 e 2 | LiveKit e Jitsi |
| Anel de quem está falando | 1 | LiveKit components |
| Permissão de transmitir separada de entrar na sala | 2 | Fluxer (permissão STREAM) |
| Criptografia ponta a ponta opcional por sala | 3 | LiveKit E2EE |

---

## 5. Fases

### Fase 0: provas técnicas (cerca de 1 semana)

Cada prova termina com "funciona" ou "não funciona" e um número medido.

| # | Prova | Critério de sucesso |
|---|---|---|
| P1 | `livekit-server` na VPS escolhida + porteiro mínimo que emite token | Dois navegadores conversam por voz pelo LiveKit Meet |
| P2 | Núcleo Rust: captura WGC, NVENC H.264 pelo FFmpeg, publicação pré-codificada | 1080p60 assistido no LiveKit Meet. Atraso abaixo de 400 ms e CPU abaixo de 15% na RTX 5060 |
| P3 | Mesmo pipeline em AV1 e em 4K60 | 4K60 AV1 estável por 10 minutos |
| P4 | Som do jogo por process loopback publicado junto | Som sincronizado com o vídeo, sem eco da voz |
| P5 | Latência do Brasil até a VPS | RTT medido de 2 ou 3 casas; voz aceitável abaixo de 180 ms |
| P6 | Plano B: `getDisplayMedia` dentro do WebView2 | Saber se dá para transmitir pelo WebView como reserva |

Se a P2 falhar, a alternativa é codificar por software no próprio LiveKit Rust e limitar a 1080p30, até achar outro caminho.

### Fase 1: MVP (cerca de 2 semanas)

- Instalador Tauri com atualização dentro do app, versão SemVer, changelog por categoria e CI de release ([VERSIONAMENTO.md](VERSIONAMENTO.md)). Chave do updater guardada no Bitwarden.
- Entrada por convite. Conta com usuário e senha.
- Salas de voz fixas, voz do microfone, anel de quem fala, volume por pessoa.
- Go Live com H.264 e AV1, seletor de qualidade com o teste da seção 3.3 e som do jogo.
- Assistir por clique, contador de quem assiste, tela cheia.
- Chat de texto da sala com histórico no porteiro.

### Fase 2: acabamento

Push-to-talk, janela solta, RNNoise, permissão de transmitir, duas camadas de qualidade para amigos com internet fraca (simulcast feito pelo núcleo com duas sessões de codificação), câmera, sons de entrar e sair.

### Fase 3: depois, se fizer sentido

Criptografia ponta a ponta, soundboard, versão para Linux, app de celular só para assistir.

---

## 6. Riscos

| Risco | Impacto | Como tratar |
|---|---|---|
| FFmpeg + D3D11 + LiveKit pré-codificado não funcionar bem no Windows | Alto: é o coração do app | Prova P2 antes de qualquer tela |
| Atraso do Brasil até US East | Médio: voz com atraso | Prova P5. Se ficar ruim, procurar VPS mais perto do Brasil |
| Smart App Control bloqueando o .exe sem assinatura | Alto para amigos com SAC ligado | Certificado OV antes de distribuir (D4). Preço e emissor a confirmar |
| Fair use da Contabo em transmissões longas em 4K | Baixo | Monitorar no Beszel; limitar 4K a quem pedir |
| Sem simulcast na fase 1 | Médio: um amigo com internet fraca trava | Escolher o preset pelo pior viewer ou entrar na fase 2 |
| Copiar código AGPL sem querer | Médio | Regra D3. Revisão de origem em cada PR |
| Chave do updater perdida | Alto: ninguém recebe atualização | Guardar no Bitwarden no dia em que for gerada |

---

## 7. O que copiar de projetos abertos

| De onde | O que | Como |
|---|---|---|
| LiveKit Meet (Apache-2.0) | Layout de sala, uso do `components-react`, ideia de E2EE | Pode copiar código com atribuição |
| SDK JS do LiveKit (Apache-2.0) | Presets de tela e bitrates | Dependência normal |
| Sharkord (MIT) | Visual com shadcn e Tailwind, servidor em um binário só | Pode copiar código com atribuição |
| Galène (MIT) | Ideia de servidor leve | Referência |
| Fluxer (AGPL) | "Go Live" como transmissão extra na sala de voz, permissão STREAM | Só ideia, código nosso |
| Element Call (AGPL) | Destaque automático ao transmitir | Só ideia, código nosso |
| OwnCord (AGPL), Kizuna, Voxium | Exemplos de Tauri com voz | Só leitura |

---

## 8. O que o mapeamento do Discord confirmou (24/11, Craft Anything)

Só ideias; nada de código do Discord (os termos dele proíbem engenharia reversa e o código tem dono).

| No Discord | No nosso plano |
|---|---|
| `gpu_encoder_helper.exe` (Rust) só testa codificadores, por fornecedor e backend (NVIDIA CUDA/DX11, AMD DX11, Intel e Media Foundation), e devolve JSON | **Adotar:** o teste de codificadores roda num processo separado (`sonda.exe`). Se o driver travar no teste, o app não cai. |
| Captura por WGC (janela e tela), DXGI Desktop Duplication, GDI e gancho dentro do jogo (DX12) | WGC como padrão e DXGI como reserva. **Sem gancho no jogo:** anti-cheat (CS2, Valorant, FACEIT) pode punir. |
| Codifica com NVENC, AMF, Intel QSV e Media Foundation, em H.264, H.265 e AV1 | Confirma o FFmpeg com os três fornecedores. Media Foundation entra como reserva genérica. H.265 fica fora, porque o WebView2 não publica H.265. |
| Software: VP8 (libvpx) e OpenH264 baixado na hora | Reserva por software para PC sem codificador na placa, limitada a 720p30. |
| Decodifica AV1 com dav1d (software) | Confirma o AV1 como padrão: o Chromium também decodifica AV1 por software. |
| Tone-mapping HDR (Rec709/Rec2020) | Fase 2: sem isso, a tela HDR fica lavada para quem assiste. |
| Som do jogo por `ActivateAudioInterfaceAsync` com `VAD\Process_Loopback` | Igual ao plano (process loopback por PID). O gancho de som do Discord fica de fora. |
| Krisp (proprietário) para ruído e detecção de voz | RNNoise ou DeepFilterNet (abertos). |

## 9. Próximos passos

1. O Filippe decide D1 a D6 e manda as referências visuais.
2. Rodada de design das telas principais (layout, Go Live, cartões de qualidade).
3. Prompts do T3 para a fase 0: um para o núcleo Rust (P2 a P4) e outro para servidor e porteiro (P1).
4. Revisão dos resultados da fase 0 e ajuste da tabela de presets com números reais.

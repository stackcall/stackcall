# Prompt T3: P6 transmissão pelo WebView2 (plano B)

Modelo: Codex `gpt-6.1-sol`, esforço medium. Branch: `feat/fase0-webview`.

---

Você está no repositório `stackcall/stackcall`. Leia antes de começar: `AGENTS.md` e `docs/PLANO.md` (seções 2.1 e 5). Siga as regras do `AGENTS.md`: Conventional Commits, nada copiado de projetos AGPL/GPL nem do Discord, nenhum segredo no git.

## Contexto

O cliente do Stackcall é um app Tauri 2. No Windows, a interface roda no WebView2 (Chromium). O plano principal transmite a tela por um núcleo em Rust. Esta prova responde se dá para transmitir direto pelo WebView2, como reserva, e com que limites.

## Entregável

Um app Tauri 2 mínimo em `spikes/webview-tela/` (React + Vite + TypeScript), com uma tela só e quatro testes:

1. **Captura:** botão que chama `navigator.mediaDevices.getDisplayMedia({ video: { width: 3840, height: 2160, frameRate: 60 }, audio: true })`.
   - Mostra se o seletor de tela abre dentro do WebView2.
   - Mostra o que foi concedido: resolução e fps reais (`track.getSettings()`) e se veio trilha de áudio.
   - Se o WebView2 não oferecer o seletor, procure a forma suportada no Tauri 2 (permissões, `getDisplayMedia` com seletor próprio, plugin) e documente o que achou, com links.
2. **Prévia:** mostra a captura num `<video>` com contador de fps medido (`requestVideoFrameCallback`).
3. **Codecs:** lista o que `RTCRtpSender.getCapabilities('video')` oferece (H.264, VP9, AV1, H.265) e se há codificação por hardware (`MediaCapabilities.encodingInfo` com `powerEfficient`).
4. **Publicação (opcional):** com URL e token colados em dois campos, publica a captura numa sala do LiveKit pelo `livekit-client`, nas resoluções 1080p60 e 1440p60. Mostra as estatísticas do envio (`getStats`: fps, bitrate, `qualityLimitationReason`). O token vem do porteiro da prova P1; se ele ainda não existir, documente como testar com um token gerado pela CLI do LiveKit.

## Relatório

`spikes/webview-tela/RESULTADOS.md` com uma tabela por teste: o que foi pedido, o que o WebView2 entregou, o que falhou e por quê. No fim, responda em uma frase: dá para usar o WebView2 como reserva até qual qualidade, e com ou sem som do jogo?

## Como provar

- `npm run tauri dev` abre o app no Windows.
- Rode os testes 1 a 3 no seu ambiente e preencha o relatório com o que observou.
- O teste 4 e as medições com GPU dedicada ficam para o Claude Code no PC de casa: deixe o passo a passo no relatório.

## Fora do escopo

- Visual caprichado (é uma prova técnica).
- Login, chat, salas.

## Ao terminar

- PR para a `main` com o relatório, o que foi testado e o que depende do PC de casa.
- Não marque nada como "funcionando" sem ter executado.

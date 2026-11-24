# Stackcall

App de voz e transmissão de tela para um grupo de amigos. Cliente desktop em Tauri 2, mídia pelo LiveKit num servidor próprio.

- Salas de voz, transmissão de tela de 720p30 a 4K60 conforme a placa de vídeo, som do jogo junto e chat.
- Quem transmite codifica na própria GPU (NVENC, AMF ou Quick Sync); o servidor só repassa.
- Entrada só por convite.

Estado: planejamento. Comece por [docs/PLANO.md](docs/PLANO.md). As pesquisas que embasam o plano estão em [docs/pesquisa/](docs/pesquisa/).

## Estrutura planejada

| Pasta | Conteúdo |
|---|---|
| `app/` | Cliente Tauri 2: interface React + Vite + TypeScript + Tailwind, voz e assistir pelo `livekit-client` |
| `core/` | Núcleo Rust "Go Live": captura WGC, codificação na GPU pelo FFmpeg, som do jogo por process loopback, publicação pré-codificada no LiveKit |
| `sonda/` | Processo separado que testa os codificadores da placa e devolve JSON |
| `server/` | Porteiro em Rust (axum + SQLite): convites, contas, salas, tokens do LiveKit, chat |
| `infra/` | Configuração do `livekit-server`, do Caddy e do Docker Compose da VPS |

## Licença

Código privado por enquanto, todos os direitos reservados. A abertura com licença livre está prevista para depois (ver decisão D3 no plano).

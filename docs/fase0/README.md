# Fase 0: provas técnicas

Três tarefas para o T3 Code, independentes entre si. Cada arquivo é o prompt completo: cole o texto inteiro numa thread nova do T3, no repositório `stackcall/stackcall`.

| Arquivo | Provas | Modelo no T3 | Branch |
|---|---|---|---|
| [P1-servidor.md](P1-servidor.md) | P1 servidor e porteiro, P5 medição de latência | Codex `gpt-6.1-sol`, esforço medium | `feat/fase0-servidor` |
| [P2-nucleo.md](P2-nucleo.md) | P2 captura e GPU, P3 AV1 e 4K60, P4 som do jogo | Codex `gpt-6.1-sol`, esforço high | `feat/fase0-nucleo` |
| [P6-webview.md](P6-webview.md) | P6 transmissão pelo WebView2 (plano B) | Codex `gpt-6.1-sol`, esforço medium | `feat/fase0-webview` |

## Divisão de trabalho

- **T3** escreve o código, os testes e a documentação de cada prova, e abre o PR.
- **Claude Code** faz o que depende de máquina ou servidor:
  - publica o servidor na VPS, com aprovação do Filippe;
  - roda as medições no PC de casa (RTX 5060), que tem a placa de referência;
  - preenche os resultados em `docs/fase0/resultados.md`.
- Nenhuma tarefa do T3 acessa a VPS ou o PC de casa.

## Critério para passar da fase 0

A fase 1 só começa quando a P2 passar. Se a P2 falhar, o plano B é codificar por software no LiveKit e limitar a 1080p30 (seção 5 do `docs/PLANO.md`).

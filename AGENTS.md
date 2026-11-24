# Instruções para agentes (Codex, Claude Code, T3)

Leia `docs/PLANO.md` antes de qualquer tarefa. As decisões D1 a D6 já estão tomadas; não as reabra sem pedido do Filippe.

## Idioma

- Conversa com o Filippe: português do Brasil, curto e direto.
- Código, comentários, nomes de commit e documentação técnica: inglês nos identificadores; documentação do projeto em português, como o plano.

## Regras de licença e origem do código

O código é privado agora e vai ser aberto depois. Por isso:

1. Copie código só de projetos MIT, Apache-2.0, BSD ou zlib, com atribuição no arquivo `NOTICE`.
2. Projetos AGPL ou GPL (Fluxer, Element Call, Stoat, Spacebar, OwnCord, Vesktop) entram só como ideia. Nunca copie trechos.
3. Nada do Discord: nem código, nem recursos, nem textos. O mapeamento do Discord serve só como referência de arquitetura.
4. Dependências fechadas ou pagas (por exemplo, Krisp) são proibidas: elas impedem a assinatura grátis da SignPath no futuro.
5. FFmpeg só com build LGPL e link dinâmico.

## Arquitetura (resumo; o plano manda)

- `app/`: Tauri 2 + React. Voz, chat e assistir pelo `livekit-client`.
- `core/`: Rust. Transmite a tela como segundo participante `<usuario>:tela`, com vídeo pré-codificado (`NativeVideoSource::new_encoded`).
- `sonda/`: teste de codificadores em processo separado.
- `server/`: porteiro em Rust (axum + SQLite).
- `infra/`: VPS Contabo já em uso por outros serviços. Portas públicas só as do plano. Limite de memória em todo container.

## Segurança

- Segredos (chave e segredo do LiveKit, chave do updater do Tauri, senhas) nunca entram no git. Use `.env` fora do repositório ou segredos do GitHub Actions.
- Senhas com argon2. Tokens do LiveKit com validade curta.
- Nunca use gancho dentro de jogos (anti-cheat).
- Antes de tornar o repositório público, tire de `docs/` o IP da VPS e as menções a outros serviços que rodam nela.

## Fluxo

- Commits no padrão Conventional Commits (`feat:`, `fix:`, `perf:`, `ui:`, `chore:`...). O tipo vira a categoria do changelog que o usuário lê no app; regras em `docs/VERSIONAMENTO.md`.
- Uma issue, uma branch, um PR. Nada direto na `main`.
- Commit e push ao fim de cada tarefa.
- Não afirme que algo funciona sem ter executado.

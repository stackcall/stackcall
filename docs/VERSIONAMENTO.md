# Versão, atualização no app e changelog

Decidido em 24/11/2026. Objetivo: o Filippe solta versões novas com frequência, e os amigos atualizam com um clique dentro do app, sem baixar o instalador de novo.

## 1. Número de versão

- **SemVer** (`MAIOR.MENOR.CORREÇÃO`). Enquanto o app estiver em teste entre amigos, a versão fica em `0.x.y`:
  - `0.MENOR.0`: novidade ou mudança visível.
  - `0.x.CORREÇÃO`: só correção.
- **Uma fonte só:** a versão vive no `app/src-tauri/tauri.conf.json`. Um script (`scripts/versao.mjs`) copia o número para `Cargo.toml` e `package.json`. O CI recusa a build se os três divergirem.
- **Tag no git:** cada versão publicada é uma tag `vX.Y.Z` na `main`.
- O app mostra a versão no rodapé das configurações e na tela "Novidades".

## 2. Commits e categorias do changelog

Commits seguem o padrão Conventional Commits. O tipo do commit define a categoria da nota:

| Tipo do commit | Categoria no app | Exemplo |
|---|---|---|
| `feat:` | Novidade | `feat: volume por pessoa na sala` |
| `perf:` ou `improve:` | Melhoria | `perf: menos CPU ao assistir 4K` |
| `fix:` | Correção | `fix: som do jogo cortava ao trocar de janela` |
| `style:`, `refactor:` com efeito visível, `ui:` | Ajuste | `ui: botão de sair maior` |
| `chore:`, `ci:`, `docs:`, `test:` | Não aparece para o usuário | `ci: cache do cargo` |

- Uma linha `BREAKING CHANGE:` no corpo do commit marca mudança que exige versão nova de todos (ver seção 5).
- O changelog sai sozinho dos commits com o **git-cliff** (Rust, licença MIT), configurado em `cliff.toml` com as categorias acima, em português.
- Saídas geradas a cada versão:
  - `CHANGELOG.md` no repositório.
  - `changelog.json` publicado junto da versão, que o app lê para montar a tela "Novidades".
- O Filippe pode reescrever as linhas antes de publicar: o texto final da versão fica em `docs/release-notes/vX.Y.Z.md`, e esse arquivo vence o texto gerado.

## 3. Como uma versão sai (CI)

Workflow do GitHub Actions disparado por tag `v*`:

1. Confere que a versão da tag bate com a do `tauri.conf.json`.
2. Compila o instalador Windows (NSIS) do Tauri.
3. Assina o pacote de atualização com a chave do updater (`TAURI_SIGNING_PRIVATE_KEY`, segredo do GitHub). Essa assinatura é do updater do Tauri e não depende do certificado de código.
4. Gera `changelog.json` e o manifesto `latest.json` (versão, data, notas, URL e assinatura do pacote).
5. Envia instalador, pacote, `latest.json` e `changelog.json` para a VPS, na pasta servida pelo Caddy em `https://stackcall.80-190-79-129.sslip.io/updates/`.
6. Cria a release no GitHub (privada) com os mesmos arquivos, como cópia de segurança.

Por que a VPS e não as releases do GitHub: o repositório é privado, e o updater do app não consegue baixar de release privada sem um token. Um token embutido no app vazaria. A VPS serve os arquivos sem expor nada do repositório.

Custo do CI: o GitHub dá 2.000 minutos por mês para repositório privado, e o runner Windows conta em dobro. Uma build do Tauri leva perto de 10 a 15 minutos, então cabem cerca de 60 versões por mês. Isso não foi medido.

## 4. Atualização dentro do app

Plugin oficial `tauri-plugin-updater`, apontado para `…/updates/latest.json`.

| Momento | O que acontece |
|---|---|
| Ao abrir o app e a cada 6 horas | Checa o `latest.json` em segundo plano. |
| Há versão nova | Aparece uma faixa discreta no topo: "Versão 0.4.0 disponível". Botões: **Atualizar e reiniciar** e **Ver novidades**. Nunca interrompe uma chamada. |
| Usuário clica em atualizar | Baixa com barra de progresso, confere a assinatura e reinstala por cima. O app reabre na mesma sala, se ainda estiver nela. |
| Em chamada ou transmitindo | O botão vira "Atualizar ao sair da sala". A instalação espera a chamada acabar. |
| Depois de atualizar | Abre uma vez a tela "Novidades" com as notas daquela versão. |
| Configurações → Sobre e atualizações | Versão atual, canal, data da última checagem, botão **Procurar atualização** e o histórico completo do changelog. |

- **Canais:** `estável` (todos) e `teste` (o Filippe e quem quiser testar antes). Cada canal tem o seu `latest.json`.
- **Voltar uma versão:** o servidor guarda as últimas versões. Para desfazer uma versão ruim, o `latest.json` volta a apontar para a anterior com número maior de correção (por exemplo, `0.4.1` com o conteúdo da `0.3.2`).
- **Download pelo updater:** o arquivo baixado pelo próprio app não recebe a marca de "baixado da internet", então o aviso do SmartScreen normalmente não reaparece a cada versão. O Smart App Control continua avaliando o executável. Isso precisa ser confirmado na fase 0.

## 5. Compatibilidade entre app e servidor

- O porteiro informa `versao_minima_app` na API.
- Se o app estiver abaixo do mínimo (mudança com `BREAKING CHANGE`), ele mostra uma tela única: "Esta versão não conversa mais com o servidor. Atualize para continuar", com o botão de atualizar.
- Mudanças sem quebra nunca forçam atualização.

## 6. Chaves e segredos

| Segredo | Onde fica | Se perder |
|---|---|---|
| Chave privada do updater (e a senha dela) | Bitwarden + segredo do GitHub Actions | Ninguém recebe atualização: todos precisam reinstalar à mão |
| Chave SSH de deploy para a VPS | Segredo do GitHub Actions | Gerar outra |

A chave do updater é gerada uma vez (`tauri signer generate`), no dia da primeira versão, e vai para o Bitwarden no mesmo dia.

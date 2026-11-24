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
| `chore:`, `ci:`, `docs:`, `test:`, `build:` | Não aparece para o usuário | `ci: cache do cargo` |

- Uma linha `BREAKING CHANGE:` no corpo do commit marca mudança que exige versão nova de todos (ver seção 5).
- O changelog sai sozinho dos commits com o **git-cliff** (Rust, licença MIT), configurado em `cliff.toml` com as categorias acima, em português.
- Saídas geradas a cada versão:
  - `CHANGELOG.md` no repositório, atualizado no PR da versão.
  - `changelog.json` publicado junto da versão. É uma lista da versão mais nova para a mais antiga. Cada entrada tem `version` (sem `v`), `date` (AAAA-MM-DD) e `categories`. Cada categoria tem `name` e `items`, com `message` e o booleano `breaking` em cada item.
- O texto em `docs/release-notes/vX.Y.Z.md`, quando presente, vai para a página da versão e para as notas do updater. O histórico categorizado é gerado pelos commits.

## 3. Como uma versão sai (CI)

Workflow do GitHub Actions disparado por tag `v*`:

1. Confere a versão da tag nos três arquivos do app.
2. Gera as notas da versão e o histórico `changelog.json`.
3. Compila o instalador Windows (NSIS) e assina o pacote com a chave do updater. A assinatura do Tauri é independente do certificado de código do Windows.
4. Anexa o instalador, a assinatura, o manifesto `latest.json` e o `changelog.json` ao rascunho em `stackcall/releases`.
5. Publica o rascunho com as notas depois de validar os anexos.

O repositório público `stackcall/releases` permite que o app baixe a atualização sem autenticação. O código continua no repositório privado `stackcall/stackcall`.

Custo do CI: o GitHub dá 2.000 minutos por mês para repositório privado, e o runner Windows conta em dobro. Uma build do Tauri leva perto de 10 a 15 minutos, então cabem cerca de 60 versões por mês. Isso não foi medido.

## 4. Atualização dentro do app

O plugin `tauri-plugin-updater` consulta [o manifesto da versão estável](https://github.com/stackcall/releases/releases/latest/download/latest.json).

| Momento | O que acontece |
|---|---|
| Ao abrir o app e a cada 6 horas | Checa o `latest.json` em segundo plano. |
| Há versão nova | Aparece uma faixa discreta no topo: "Versão 0.4.0 disponível". Botões: **Atualizar e reiniciar** e **Ver novidades**. Nunca interrompe uma chamada. |
| Usuário clica em atualizar | Baixa com barra de progresso, confere a assinatura e reinstala por cima. O app reabre na mesma sala, se ainda estiver nela. |
| Em chamada ou transmitindo | O botão vira "Atualizar ao sair da sala". A instalação espera a chamada acabar. |
| Depois de atualizar | Abre uma vez a tela "Novidades" com as notas daquela versão. |
| Configurações → Sobre e atualizações | Versão atual, canal, data da última checagem, botão **Procurar atualização** e o histórico completo do changelog. |

- **Canais:** `estável` usa a última release estável do GitHub. Tags como `v0.2.0-teste.1` publicam uma pré-release com o próprio `latest.json`, base para o futuro canal `teste`.
- **Voltar uma versão:** publique uma correção com o conteúdo da versão que funcionava e com número maior (por exemplo, `0.4.1` com o conteúdo da `0.3.2`).
- **Download pelo updater:** o arquivo baixado pelo próprio app não recebe a marca de "baixado da internet", então o aviso do SmartScreen normalmente não reaparece a cada versão. O Smart App Control continua avaliando o executável. Isso precisa ser confirmado na fase 0.

## 5. Compatibilidade entre app e servidor

- O porteiro informa `versao_minima_app` na API.
- Se o app estiver abaixo do mínimo (mudança com `BREAKING CHANGE`), ele mostra uma tela única: "Esta versão não conversa mais com o servidor. Atualize para continuar", com o botão de atualizar.
- Mudanças sem quebra nunca forçam atualização.

## 6. Chaves e segredos

| Segredo | Onde fica | Se perder |
|---|---|---|
| Chave privada do updater (e a senha dela) | Bitwarden e ambiente `release` do GitHub Actions | Ninguém recebe atualização: todos precisam reinstalar à mão |
| `RELEASES_TOKEN` | Ambiente `release` do GitHub Actions. Token fino com `Contents: read and write` apenas em `stackcall/releases` | Gerar outro |

A chave do updater é gerada uma vez (`tauri signer generate`), no dia da primeira versão, e vai para o Bitwarden no mesmo dia.

No GitHub, restrinja o ambiente `release` a tags `v*`, configure um revisor obrigatório e mantenha os segredos da release nesse ambiente. O disparo manual gera um instalador NSIS para teste. O push de tag envia o instalador ao job de publicação, que o assina e publica os arquivos do updater.

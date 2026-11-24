# Stackcall

App de voz e transmissão de tela para um grupo de amigos. Cliente desktop em Tauri 2, mídia pelo LiveKit num servidor próprio.

- Salas de voz, transmissão de tela de 720p30 a 4K60 conforme a placa de vídeo, som do jogo junto e chat.
- Quem transmite codifica na própria GPU (NVENC, AMF ou Quick Sync); o servidor só repassa.
- Entrada só por convite.

O plano e as fases do projeto estão em [docs/PLANO.md](docs/PLANO.md). As referências ficam em [docs/pesquisa/](docs/pesquisa/).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `app/` | Cliente Tauri 2: interface React + Vite + TypeScript + Tailwind, voz e assistir pelo `livekit-client` |
| `core/` | Núcleo Rust "Go Live": captura WGC, codificação na GPU pelo FFmpeg, som do jogo por process loopback, publicação pré-codificada no LiveKit |
| `sonda/` | Processo separado que testa os codificadores da placa e devolve JSON |
| `server/` | Porteiro em Rust com Axum. A prova atual valida convites e emite tokens do LiveKit |
| `infra/` | Configuração do `livekit-server`, do Caddy e do Docker Compose da VPS |
| `spikes/` | Provas técnicas isoladas |
| `scripts/` | Versionamento, geração de changelog e medição de latência |
| `releases-repo/` | README sincronizado com a página pública de downloads |

## Rodar localmente

### App

Quando `app/` estiver na sua branch, use Windows com Node.js 24, Rust estável, Visual Studio Build Tools com C++ e WebView2.

```powershell
cd app
npm ci
npm run tauri dev
```

Com o app aberto, rode `.\scripts\medir-leveza.ps1 -Situacao parado` a partir da raiz para medir CPU e memória por 60 segundos. O CSV e o resumo ficam em `docs/medidas/`.

### Porteiro

Na raiz, configure o par de chaves do seu LiveKit, a URL pública e o convite de desenvolvimento no ambiente da sessão. Para um LiveKit rodando na mesma máquina, use `ws://localhost:7880` como URL.

```powershell
$env:LIVEKIT_API_KEY = '<chave do LiveKit local>'
$env:LIVEKIT_API_SECRET = '<segredo do LiveKit local>'
$env:LIVEKIT_PUBLIC_URL = 'ws://localhost:7880'
$env:STACKCALL_CONVITE_DEV = '<convite de desenvolvimento>'
cargo run -p porteiro
```

O porteiro escuta em `127.0.0.1:8100` por padrão. Para subir a infraestrutura junto, consulte o [guia de infraestrutura](infra/README.md).

## Hospedar seu próprio servidor

Use uma VPS Linux com pelo menos 2 GB de RAM, Docker com Compose, Git, curl e OpenSSL. Se usar um domínio próprio, aponte o DNS para a VPS antes de instalar. Libere **443/tcp, 7881/tcp, 7882/udp e 3478/udp**.

Leia o [script de instalação](infra/instalar.sh) antes de rodar.

```bash
curl -fsSL https://raw.githubusercontent.com/stackcall/stackcall/main/infra/instalar.sh | bash
```

Informe o domínio ou pressione Enter para usar `<ip-publico>.sslip.io`. Guarde em privado o convite do dono que aparece quando o servidor responde.

- **Rede local:** no Linux, rode `bash infra/instalar.sh --local` a partir do checkout. No Windows com Docker Desktop em modo Linux, leia [instalar.ps1](infra/instalar.ps1) e rode `.\infra\instalar.ps1`. Ambos usam o IPv4 da rede, sem TLS, nas portas 8100/tcp, 7881/tcp e 7882/udp.
- **Backup:** pare o porteiro e copie `stackcall.sqlite3` do volume `stackcall-selfhost_porteiro-data`, junto de `stackcall.sqlite3-wal` se existir. Guarde também o `.env` privado, por padrão em `~/.config/stackcall/` no Linux ou `%LOCALAPPDATA%\Stackcall\selfhost\` no Windows. Reinicie o porteiro após a cópia.
- **Atualização:** use o mesmo comando com `bash -s -- --atualizar` no lugar de `bash`, ou rode `.\infra\instalar.ps1 -Atualizar` no Windows. Os contêineres são recriados com o mesmo banco e as mesmas credenciais.

## Soltar uma versão

1. Na branch da versão, rode os comandos abaixo na raiz. Use git-cliff 2.14.2 para atualizar o histórico que fica no repositório.

   ```sh
   node scripts/versao.mjs X.Y.Z
   git-cliff --offline --use-branch-tags --tag vX.Y.Z --output CHANGELOG.md
   git add app/src-tauri/tauri.conf.json app/src-tauri/Cargo.toml app/package.json CHANGELOG.md
   git commit -m "chore: bump version to X.Y.Z"
   ```

2. Abra o PR da versão. Se quiser escrever as notas à mão, inclua `docs/release-notes/vX.Y.Z.md` no PR.
3. Depois do merge, atualize sua `main`, marque o commit da versão e envie as tags.

   ```sh
   git switch main
   git pull --ff-only
   git tag vX.Y.Z
   git push --tags
   ```

O Actions confere as versões, gera as notas e o histórico, compila o instalador NSIS no Windows e assina o pacote para o updater. A release fica em rascunho até o instalador, o manifesto e o changelog estarem anexados. Tags como `v0.2.0-teste.1` saem como pré-release. Para testar a compilação sem publicar, execute o workflow **Release** manualmente com a versão já gravada no app, sem o prefixo `v`. O instalador e a assinatura ficam nos artefatos da execução.

Os instaladores e o histórico público ficam em [Stackcall Releases](https://github.com/stackcall/releases/releases). O updater consulta [o manifesto da versão estável](https://github.com/stackcall/releases/releases/latest/download/latest.json).

## Licença

Código privado por enquanto, todos os direitos reservados. A abertura com licença livre está prevista para depois (ver decisão D3 no plano).

# App Stackcall (v0.1)

Cliente Tauri 2 + React. Voz, chat e transmissão pelo `livekit-client`, dentro do WebView2. O núcleo Rust e o som do jogo entram na v0.2.

## Rodar

```powershell
npm ci
npm run tauri dev        # abre a tela de entrada
npm test                 # testes de componente (Vitest)
npm run tauri build      # gera src-tauri/target/release/bundle/nsis/Stackcall_0.1.0_x64-setup.exe
```

Modo de demonstração, sem servidor: `npm run dev` e abra `http://127.0.0.1:1420/?demo=1`. O parâmetro `tela` abre uma tela direto: `entrada`, `ar`, `config` ou `novidades` (ex.: `?demo=1&tela=ar`).

## Pontos que dependem de outra parte

- **Porteiro:** o app precisa do `POST /api/upload-test` e do CORS liberando `http://tauri.localhost`, adicionados em `server/` nesta mesma versão. O porteiro publicado antes disso recusa o app; é preciso publicar de novo.
- **Updater:** o `npm run tauri build` local termina com erro na assinatura se `TAURI_SIGNING_PRIVATE_KEY` não estiver definida. O instalador sai antes desse passo. A chave fica só nos segredos do GitHub.
- **1440p60:** fica bloqueado até a prova P6 passar no PC de casa. Para liberar, mude `P6_1440P60_VALIDATED` em `src/lib/presets.ts`.
- **Convite:** fica no Gerenciador de Credenciais do Windows (crate `keyring`), nunca no `localStorage`.

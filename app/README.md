# App Stackcall

Cliente Tauri 2 + React. O WebView2 cuida de voz, chat e reprodução. O Go Live usa o núcleo Rust para captura, codificação na GPU e áudio por PID. Se a máquina não sustentar o núcleo ou ele falhar, o app oferece a captura pelo WebView2.

## Rodar

```powershell
npm ci
npm run tauri dev        # abre a tela de entrada
npm test                 # testes de componente (Vitest)
npm run tauri build      # gera src-tauri/target/release/bundle/nsis/Stackcall_<versão>_x64-setup.exe
```

Modo de demonstração, sem servidor: `npm run dev` e abra `http://127.0.0.1:1420/?demo=1`. O parâmetro `tela` abre uma tela direto: `entrada`, `ar`, `config` ou `novidades` (ex.: `?demo=1&tela=ar`).

## Pontos que dependem de outra parte

- **Build Windows x64.** Instale Rust MSVC, Visual Studio Build Tools com C++ e Windows SDK, e LLVM com `libclang.dll`. Os comandos do Tauri preparam o FFmpeg LGPL e compilam o sidecar antes de compilar o app.
- **Porteiro.** Para o Go Live nativo, publique a versão que aceita nomes com sufixo `:tela`. O seletor usa o `POST /api/upload-test` para medir a conexão.
- **Updater.** A chave de assinatura fica nos segredos do GitHub. Para gerar um instalador local de teste, passe ao Tauri `--config` com um arquivo JSON contendo `{"bundle":{"createUpdaterArtifacts":false}}`.
- **Convite:** fica no Gerenciador de Credenciais do Windows (crate `keyring`), nunca no `localStorage`.

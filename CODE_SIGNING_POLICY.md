# Code signing policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation

## Equipe

- Autor com acesso de commit e revisor das contribuições: [Filippe Faria](https://github.com/bronze-ff).
- Aprovador dos pedidos de assinatura: [Filippe Faria](https://github.com/bronze-ff). Cada pedido exige aprovação manual. O GitHub Actions só envia os pedidos.

## Artefatos assinados

O GitHub Actions compila o Stackcall a partir do código do repositório. A SignPath verifica a origem da build e assina `stackcall.exe`, `stackcall-core.exe` e o instalador Windows `-setup.exe` com Authenticode. As DLLs do FFmpeg entram no instalador como foram distribuídas pelo projeto de origem. O atualizador do Stackcall verifica uma assinatura separada, gerada pelo Tauri sobre o instalador final.

## Privacidade

O Stackcall não envia telemetria. Os dados de conta e de perfil, as mensagens, a voz e a transmissão de tela são enviados aos serviços do grupo que você escolhe. O administrador desse servidor responde pelo tratamento dos dados do grupo.

O app consulta o GitHub para obter atualizações e ler as novidades das versões. A conexão de voz e vídeo pode consultar serviços STUN/TURN para estabelecer ou retransmitir a conexão WebRTC. O instalador pode baixar da Microsoft o WebView2 quando esse componente do Windows estiver ausente. [Privacidade do GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) · [Privacidade do Google, cujo STUN pode ser usado pelo LiveKit](https://policies.google.com/privacy) · [Privacidade da Microsoft](https://privacy.microsoft.com/privacystatement)

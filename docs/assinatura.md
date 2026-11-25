# Assinatura do Stackcall para Windows

## Inscrição e origem da build

1. Remova de `docs/` o IP da VPS e as menções a outros serviços nela hospedados, conforme `AGENTS.md`, e torne `stackcall/stackcall` público. Confira o README, a licença AGPL-3.0, a página de downloads e os links para a política de assinatura antes de enviar a inscrição.
2. Ative a autenticação de dois fatores no GitHub e crie a conta pelo [formulário da SignPath Foundation](https://signpath.org/apply). Informe o repositório de código, a [página de downloads](https://github.com/stackcall/releases/releases), a [política de assinatura](../CODE_SIGNING_POLICY.md), a licença e o workflow `.github/workflows/release.yml`. Ative MFA também na conta SignPath. Quem ganhar acesso à equipe deve usar MFA nos dois serviços. [Termos da Foundation](https://signpath.org/terms)
3. Instale o [GitHub App da SignPath](https://github.com/apps/signpath) na organização `stackcall`, com acesso ao repositório `stackcall/stackcall`. Em **Administration > Trusted Build Systems**, adicione o conector predefinido **GitHub.com**. Vincule-o ao projeto **Stackcall**, slug `stackcall`, com **Repository URL** `https://github.com/stackcall/stackcall`. [Integração com GitHub](https://docs.signpath.io/trusted-build-systems/github)
4. Crie a política `release`, de tipo **Release**, com o certificado da Foundation. Exija **Trusted build system verification**, **Verify origin** e **Use approval process**, com um voto de aprovação e Filippe Faria como aprovador. Restrinja a origem às refs usadas nas releases. Comece pela `main` e confirme como o conector identifica a ref na primeira execução por tag `v*`. Restrinja a criação dessas tags aos mantenedores e marque commits já revisados na `main`. [Configuração de políticas](https://docs.signpath.io/projects#signing-policies)

## Configurações de artefato

No projeto **Stackcall**, crie as duas configurações abaixo em **Artifact Configurations**. Use a opção de XML personalizado. A primeira assina os executáveis em um ZIP. A segunda assina o instalador já montado em outro ZIP. O workflow envia a versão da tag, ou a versão informada em uma build manual, no parâmetro `version`. Os arquivos devem declarar o produto `Stackcall` e essa mesma versão em seus metadados PE. [Restrições de metadados da SignPath](https://docs.signpath.io/artifact-configuration/reference#file-metadata-restrictions)

**Slug `windows-binaries`**

```xml
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <parameters>
    <parameter name="version" required="true" />
  </parameters>
  <zip-file>
    <pe-file path="stackcall.exe" product-name="Stackcall" product-version="${version}">
      <authenticode-sign />
    </pe-file>
    <pe-file path="stackcall-core.exe" product-name="Stackcall" product-version="${version}">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

**Slug `windows-nsis`**

```xml
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <parameters>
    <parameter name="version" required="true" />
  </parameters>
  <zip-file>
    <pe-file path="stackcall-setup.exe" product-name="Stackcall" product-version="${version}">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

## Credenciais no GitHub

Crie um **CI User** dedicado ao Stackcall em **Users** na SignPath e dê a ele somente a permissão **Submitter** na política `release`. Gere o token desse usuário e copie o **Organization ID** da página da organização. Cadastre os valores em **Settings > Secrets and variables > Actions**, no repositório `stackcall/stackcall`. [Usuários e tokens na SignPath](https://docs.signpath.io/users/#ci-users)

| Onde | Nome | Valor |
| --- | --- | --- |
| Repository secret | `SIGNPATH_API_TOKEN` | Token do CI User |
| Repository variable | `SIGNPATH_ORGANIZATION_ID` | ID da organização na SignPath |
| Repository variable | `SIGNPATH_PROJECT_SLUG` | `stackcall` |
| Repository variable | `SIGNPATH_SIGNING_POLICY_SLUG` | `release` |

Se faltar algum dos quatro valores, o workflow gera o instalador sem Authenticode. A assinatura do atualizador continua sendo feita nas publicações por tag, usando `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` no ambiente `release`.

## Testar com uma pré-release

1. Escolha uma versão de teste inédita `X.Y.Z-teste.1`. Rode `node scripts/versao.mjs X.Y.Z-teste.1`, abra o PR dessa versão e faça o merge. Na `main` atualizada, use `git tag vX.Y.Z-teste.1` e `git push origin vX.Y.Z-teste.1`.
2. Na SignPath, confira a origem e o commit antes de aprovar o pedido `windows-binaries`. Depois que o Actions montar o NSIS, faça a mesma conferência e aprove `windows-nsis`. Cada etapa aguarda a aprovação por até uma hora. O log deve registrar as verificações Authenticode e de DLLs antes de o instalador seguir para publicação.
3. Em [Stackcall Releases](https://github.com/stackcall/releases/releases), abra a pré-release dessa tag. Ela não substitui o manifesto da versão estável. Confira que `latest.json` contém `X.Y.Z-teste.1`, que `platforms.windows-x86_64.url` aponta para o instalador da pré-release e que `platforms.windows-x86_64.signature` tem o mesmo valor do arquivo `-setup.exe.sig`.
4. No Windows, rode `Get-AuthenticodeSignature -LiteralPath .\Stackcall_X.Y.Z-teste.1_x64-setup.exe` e confira o status `Valid` e o editor **SignPath Foundation**. Instale em uma máquina de teste e confirme o mesmo status nos arquivos `stackcall.exe` e `stackcall-core.exe` da instalação.

O `workflow_dispatch` com a versão da `main` também permite testar as duas assinaturas Authenticode sem publicar. Nesse modo, o instalador sai no artefato `stackcall-nsis`. O teste por tag cobre também a assinatura do atualizador e o manifesto.

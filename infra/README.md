# Publicação da fase 0

Execute na VPS após a aprovação do Filippe. Os comandos partem da raiz do checkout.

## Preparar chaves e portas

Gere as credenciais com a imagem fixada no Compose e um convite aleatório. Transfira os valores diretamente para o arquivo privado, sem registrá-los no terminal compartilhado ou no Git.

```sh
docker compose -f infra/docker-compose.yml --env-file infra/.env.example run --rm --no-deps livekit generate-keys
openssl rand -hex 32
umask 077
mkdir -p ~/.config/stackcall
install -m 600 infra/.env.example ~/.config/stackcall/.env
chmod 600 ~/.config/stackcall/.env
```

Edite `~/.config/stackcall/.env` e preencha `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e `STACKCALL_CONVITE_DEV`. O Compose monta `LIVEKIT_KEYS` com o mesmo par usado pelo porteiro. Mantenha `PORTEIRO_ADDR=0.0.0.0:8100` no contêiner. A publicação no host é restrita a loopback e o porteiro confia no gateway da rede privada do Compose para receber o IP informado pelo Caddy. Reserve a sub-rede `172.31.240.0/29` para esse serviço.

Confira as regras existentes antes de adicionar as que faltam.

```sh
sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw allow 3478/udp
```

O Docker pode encaminhar portas publicadas antes das regras do UFW. Mantenha também a mesma lista no firewall do provedor, se houver. Use Docker Engine 28 ou mais recente para o isolamento das portas publicadas em loopback.

## Subir e verificar

Crie o diretório de atualizações e instale o bloco de configuração.

```sh
sudo install -d -m 0755 /srv/stackcall/updates
sudo install -m 0644 infra/caddy/stackcall.caddy /etc/caddy/stackcall.caddy
```

Adicione `import /etc/caddy/stackcall.caddy` ao Caddyfile do host. Valide e recarregue. A emissão do certificado pode usar o desafio TLS-ALPN pela porta 443/tcp.

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy

docker compose -p stackcall -f infra/docker-compose.yml --env-file ~/.config/stackcall/.env config --quiet
docker compose -p stackcall -f infra/docker-compose.yml --env-file ~/.config/stackcall/.env up -d --build
docker compose -p stackcall -f infra/docker-compose.yml --env-file ~/.config/stackcall/.env ps

curl --fail --silent --show-error http://127.0.0.1:7880/
curl --fail --silent --show-error https://stackcall.80-190-79-129.sslip.io/api/health
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://stackcall.80-190-79-129.sslip.io/api/rtt
```

Espere `ok: true` na saúde do porteiro e HTTP 204 no RTT. Para P1, peça dois tokens em `POST /api/token` com o convite privado, nomes diferentes e a mesma sala. Use os tokens no LiveKit Meet e confirme voz nos dois sentidos. Para P5, execute `powershell -NoProfile -File scripts/medir-latencia.ps1 -Json` em duas ou três casas. A primeira amostra pode incluir DNS e TLS, e o cliente HTTP pode reutilizar a conexão nas amostras seguintes. Registre os resultados em `docs/fase0/resultados.md`.

## Desfazer

```sh
docker compose -p stackcall -f infra/docker-compose.yml --env-file ~/.config/stackcall/.env down
```

Remova o `import` do Caddyfile, valide e recarregue o Caddy com os comandos acima. Remova o arquivo `/etc/caddy/stackcall.caddy`. Remova apenas as regras de firewall criadas para o Stackcall, por exemplo `sudo ufw delete allow 7881/tcp`, `sudo ufw delete allow 7882/udp` e `sudo ufw delete allow 3478/udp`. Preserve o acesso HTTPS compartilhado. Se a retirada for definitiva, remova o arquivo de credenciais privado e arquive os arquivos de atualização antes de retirar o diretório.

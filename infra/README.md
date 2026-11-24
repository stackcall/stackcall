# Infraestrutura do Stackcall

Para uma instância nova, use [Hospedar seu próprio servidor](../README.md#hospedar-seu-próprio-servidor). O instalador gera as credenciais, guarda o `.env` fora do checkout e usa o Compose com Caddy. O volume `<projeto>_porteiro-data` contém o SQLite e as imagens. Para copiar o volume inteiro, pare o porteiro primeiro. Preserve também o `.env` privado e, no modo HTTPS, os volumes do Caddy.

## Instância com Caddy já instalado no host

Use apenas `docker-compose.yml`, que publica o porteiro e a sinalização do LiveKit em loopback. Configure as chaves existentes do LiveKit e defina `INSTANCIA_URL` com a origem HTTPS e `LIVEKIT_PUBLIC_URL` com o WebSocket público seguido de `/rtc`. Use `infra/.env.example` como referência. `INSTANCIA_NOME` personaliza o nome retornado ao app. `STEAM_API_KEY` é opcional e serve para importar nome e avatar da Steam.

O [bloco do Caddy](caddy/stackcall.caddy) encaminha API, convites, mídia e sinalização. Ele sobrescreve `X-Forwarded-For` com o IP da conexão. Mantenha a rede privada `172.31.240.0/29` reservada para a instância e `PORTEIRO_TRUSTED_PROXY` apontado para o gateway `172.31.240.1`. No Compose do instalador, o proxy tem endereço próprio. Use Docker Engine 28 ou mais recente para o isolamento das portas publicadas em loopback.

Da raiz do checkout, com o arquivo de configuração já preenchido:

```sh
docker compose -p stackcall -f infra/docker-compose.yml --env-file ~/.config/stackcall/.env config --quiet
docker compose -p stackcall -f infra/docker-compose.yml --env-file ~/.config/stackcall/.env up -d --build
curl --fail --silent --show-error http://127.0.0.1:8100/api/instancia
```

Após instalar ou migrar com o banco vazio, procure `Convite do primeiro admin` no log privado do porteiro. O link vence após 30 dias ou quando a primeira conta é criada. O grupo Galera e a sala Geral ficam no SQLite. A API do app está em [PLANO-ABERTO.md](../docs/PLANO-ABERTO.md#api-contrato-entre-porteiro-e-app).

## Portas

| Modo | Portas publicadas |
|---|---|
| HTTPS | 443/tcp, 7881/tcp, 7882/udp, 3478/udp |
| LAN | 8100/tcp, 7881/tcp, 7882/udp no IPv4 escolhido |

O Docker pode encaminhar portas antes das regras do UFW. Em uma VPS, aplique também a lista no firewall do provedor, se houver. Ao parar a instância com `docker compose down`, mantenha os volumes para preservar contas, grupos, sessões e mídias.

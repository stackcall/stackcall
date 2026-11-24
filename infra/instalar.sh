#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; exit 1; }

local_mode=false
domain=
ip=
while (( $# )); do
    case "$1" in
        --local) local_mode=true; shift ;;
        --dominio) [[ $# -ge 2 ]] || die 'Falta o domínio.'; domain=$2; shift 2 ;;
        --ip) [[ $# -ge 2 ]] || die 'Falta o IPv4.'; ip=$2; shift 2 ;;
        *) die "Uso: instalar.sh [--local] [--ip <IPv4>] [--dominio <domínio>]" ;;
    esac
done

docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || die 'Inicie o Docker Engine.'
docker compose version >/dev/null 2>&1 || die 'Instale o Docker Compose v2.24.4 ou mais recente.'
command -v openssl >/dev/null || die 'Instale o OpenSSL.'

install_dir="${STACKCALL_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/stackcall}"
mkdir -p -- "$install_dir"
install_dir=$(cd -- "$install_dir" && pwd -P)
env_file="$install_dir/.env"
script="${BASH_SOURCE[0]:-}"
if [[ -n "$script" && -f "$(dirname -- "$script")/docker-compose.selfhost.yml" ]]; then
    infra=$(cd -- "$(dirname -- "$script")" && pwd -P)
else
    if [[ ! -f "$install_dir/source/infra/docker-compose.selfhost.yml" ]]; then
        git clone --depth 1 https://github.com/stackcall/stackcall.git "$install_dir/source"
    fi
    infra="$install_dir/source/infra"
fi

check_ip() {
    local octet
    [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ && "$1" != 0.0.0.0 ]] || die 'Informe um IPv4 válido.'
    local -a octets
    IFS=. read -r -a octets <<< "$1"
    for octet in "${octets[@]}"; do
        (( 10#$octet <= 255 )) || die 'Informe um IPv4 válido.'
    done
}

if [[ ! -f "$env_file" ]]; then
    if $local_mode; then
        [[ -z "$domain" ]] || die 'Use apenas o IP no modo local.'
        if [[ -z "$ip" ]]; then
            ip=$(ip -4 route get 1.1.1.1 | awk '{for (i=1;i<NF;i++) if ($i=="src") {print $(i+1);exit}}')
        fi
        check_ip "$ip"
        origin="http://$ip:8100"
        livekit_url="ws://$ip:8100/rtc"
        bind_ip=$ip
        caddy_port=8100
        caddy_config=local.caddy
    else
        if [[ -z "$domain" ]] && (: </dev/tty) 2>/dev/null; then
            read -r -p 'Domínio (Enter para usar sslip.io): ' domain </dev/tty || true
        fi
        if [[ -z "$domain" ]]; then
            ip=${ip:-$(curl -4fsS --max-time 10 https://api.ipify.org)}
            check_ip "$ip"
            domain="$ip.sslip.io"
        fi
        [[ "$domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ ]] || die 'Informe um domínio válido.'
        origin="https://$domain"
        livekit_url="wss://$domain/rtc"
        bind_ip=0.0.0.0
        caddy_port=443
        caddy_config=selfhost.caddy
    fi

    cat > "$install_dir/livekit.yaml" <<EOF
port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  tcp_port: 7881
  udp_port: 7882
EOF
    if $local_mode; then
        printf '  use_external_ip: false\n  node_ip: %s\n' "$ip" >> "$install_dir/livekit.yaml"
    else
        printf '  use_external_ip: true\nturn:\n  enabled: true\n  udp_port: 3478\n  domain: %s\n' "$domain" >> "$install_dir/livekit.yaml"
    fi
    livekit_key=$(openssl rand -hex 16)
    livekit_secret=$(openssl rand -hex 32)
    temp_env=$(mktemp "$install_dir/.env.XXXXXX")
    trap 'rm -f -- "$temp_env"' EXIT
    cat > "$temp_env" <<EOF
LIVEKIT_API_KEY=$livekit_key
LIVEKIT_API_SECRET=$livekit_secret
LIVEKIT_PUBLIC_URL=$livekit_url
INSTANCIA_URL=$origin
MODO_CADASTRO=convite
LIVEKIT_CONFIG='$install_dir/livekit.yaml'
CADDY_BIND_IP=$bind_ip
CADDY_PORT=$caddy_port
CADDY_CONFIG=$caddy_config
EOF
    ln -- "$temp_env" "$env_file"
    rm -- "$temp_env"
    trap - EXIT
    unset livekit_key livekit_secret
fi

chmod 600 -- "$env_file"
compose=(docker compose --project-name "${COMPOSE_PROJECT_NAME:-stackcall}"
    --env-file "$env_file" -f "$infra/docker-compose.yml" -f "$infra/docker-compose.selfhost.yml")
if grep -qx 'CADDY_CONFIG=local.caddy' "$env_file"; then
    compose+=(-f "$infra/docker-compose.local.yml")
    ports='Na rede local: 8100/tcp, 7881/tcp e 7882/udp.'
else
    ports='Abra no firewall: 443/tcp, 7881/tcp, 7882/udp e 3478/udp.'
fi

"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --wait
for ((i=0; i<30; i++)); do
    logs=$("${compose[@]}" logs --no-color --no-log-prefix porteiro)
    if [[ "$logs" == *'Porteiro ouvindo em'* ]]; then
        printf '%s\n' "$ports"
        grep -m1 '^Convite do primeiro admin: ' <<< "$logs" || true
        exit 0
    fi
    sleep 1
done
die 'O porteiro não iniciou. Confira o estado com docker compose ps.'

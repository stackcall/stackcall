#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; exit 1; }

valid_ip() {
    local octet
    local -a octets
    [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ && "$1" != 0.0.0.0 ]] || return 1
    IFS=. read -r -a octets <<< "$1"
    for octet in "${octets[@]}"; do
        (( 10#$octet <= 255 )) || return 1
    done
}

main() {
    local local_mode=false update=false simulate=false domain='' ip='' origin livekit_url
    local bind_ip port site external_ip ports invite script infra temp_env key secret idle_minutes
    local -a compose curl_options up_options=(-d --build)
    while (( $# )); do
        case "$1" in
            --local) local_mode=true; shift ;;
            --atualizar) update=true; shift ;;
            --simular) simulate=true; shift ;;
            --dominio) [[ $# -ge 2 ]] || die 'Falta o domínio.'; domain=$2; shift 2 ;;
            --ip) [[ $# -ge 2 ]] || die 'Falta o IPv4.'; ip=$2; shift 2 ;;
            -h|--help)
                printf '%s\n' 'Uso: instalar.sh [--atualizar] [--simular] [--dominio domínio | --local [--ip IPv4]]'
                return ;;
            *) die "Opção desconhecida: $1. Veja --help." ;;
        esac
    done
    if $local_mode; then
        [[ -z "$domain" ]] || die 'Use --ip para informar o endereço da rede local.'
    else
        [[ -z "$ip" ]] || die 'Use --dominio para informar o endereço público.'
    fi

    local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/stackcall"
    local env_file="$config_dir/.env"
    if ! $simulate; then
        command -v docker >/dev/null || die 'Instale o Docker.'
        docker compose version >/dev/null 2>&1 || die 'Instale o plugin Docker Compose.'
        docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || die 'Inicie o Docker e confira se seu usuário tem acesso a ele.'
        command -v curl >/dev/null || die 'Instale o curl.'
    fi

    if [[ -f "$env_file" ]] && ! $simulate; then
        origin=$(sed -n 's/^SERVIDOR_URL=//p' "$env_file")
        case "$origin" in
            http://*:8100) local_mode=true ;;
            https://*) ! $local_mode || die 'Este servidor já está configurado para HTTPS.' ;;
            *) die 'Confira SERVIDOR_URL no arquivo de configuração existente.' ;;
        esac
        if [[ ( -n "$domain" && "$origin" != "https://${domain,,}" ) ||
            ( -n "$ip" && "$origin" != "http://$ip:8100" ) ]]; then
            die 'O endereço já está salvo. Rode sem --dominio ou --ip para reutilizá-lo.'
        fi
    elif $local_mode; then
        if [[ -z "$ip" ]]; then
            if $simulate; then
                ip=192.168.1.23
            else
                command -v ip >/dev/null || die 'Instale o iproute2 ou informe --ip.'
                ip=$(ip -4 route get 192.0.2.1 | awk '{for (i=1;i<NF;i++) if ($i=="src") {print $(i+1); exit}}')
            fi
        fi
        valid_ip "$ip" || die 'Informe um IPv4 válido da rede local.'
        origin="http://$ip:8100"
    else
        if [[ -z "$domain" ]] && ! $simulate && (: </dev/tty) 2>/dev/null; then
            read -r -p 'Domínio (Enter para usar sslip.io): ' domain </dev/tty || true
        fi
        if [[ -z "$domain" ]]; then
            if $simulate; then
                ip=203.0.113.10
            else
                ip=$(curl -4fsS --max-time 10 https://api.ipify.org) || die 'Informe um domínio com --dominio.'
            fi
            valid_ip "$ip" || die 'Não foi possível descobrir o IPv4 público. Informe --dominio.'
            domain="$ip.sslip.io"
            ip=
        fi
        [[ "$domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$ && ${#domain} -le 253 ]] ||
            die 'Informe um domínio válido, sem protocolo ou porta.'
        origin="https://${domain,,}"
    fi

    curl_options=(--noproxy '*' -fsS --max-time 3)
    if $local_mode; then
        bind_ip=${origin#http://}
        bind_ip=${bind_ip%:8100}
        port=8100
        site=selfhost-local.caddy
        external_ip=false
        livekit_url="ws://${origin#http://}/rtc"
        ports='Na rede local: 8100/tcp, 7881/tcp, 7882/udp.'
    else
        domain=${origin#https://}
        bind_ip=0.0.0.0
        port=443
        site=selfhost.caddy
        external_ip=true
        livekit_url="wss://$domain/rtc"
        ports='Abra no firewall: 443/tcp, 7881/tcp, 7882/udp, 3478/udp.'
        curl_options+=(--resolve "$domain:443:127.0.0.1")
    fi

    if $simulate; then
        printf '%s\n' 'Conferir Docker e Compose e preparar o .env privado com permissão 600.'
        if $update; then
            printf '%s\n' 'Atualizar o checkout, puxar imagens e usar up --force-recreate.'
        fi
        printf '%s\n' "Subir livekit, porteiro e caddy em $origin." "$ports" \
            'Esperar /api/health e ler CONVITE_DONO no log do porteiro.'
        return
    fi

    mkdir -p -- "$config_dir"
    script=${BASH_SOURCE[0]:-}
    infra=$(cd -- "$(dirname -- "${script:-.}")" && pwd)
    if [[ ! -f "$infra/docker-compose.selfhost.yml" ]]; then
        command -v git >/dev/null || die 'Instale o Git para baixar o Stackcall.'
        if [[ ! -d "$config_dir/source/.git" ]]; then
            (
                # O Caddy precisa ler os arquivos do checkout montados no contêiner.
                umask 022
                git clone --depth 1 --branch main https://github.com/stackcall/stackcall.git "$config_dir/source"
            )
        fi
        infra="$config_dir/source/infra"
    fi
    if $update; then
        (
            umask 022
            git -C "$infra" pull --ff-only
        )
        up_options+=(--force-recreate)
    fi
    [[ -f "$infra/docker-compose.selfhost.yml" ]] || die 'A versão baixada ainda não inclui o Compose do instalador.'

    if [[ ! -f "$env_file" ]]; then
        command -v openssl >/dev/null || die 'Instale o OpenSSL para gerar as credenciais.'
        key=$(openssl rand -hex 16)
        secret=$(openssl rand -hex 32)
        temp_env=$(mktemp "$config_dir/.env.XXXXXX")
        trap 'rm -f -- "$temp_env"' EXIT
        cat > "$temp_env" <<EOF
LIVEKIT_API_KEY=$key
LIVEKIT_API_SECRET=$secret
LIVEKIT_PUBLIC_URL=$livekit_url
LIVEKIT_EXTERNAL_IP=$external_ip
LIVEKIT_NODE_IP=$ip
SERVIDOR_URL=$origin
STACKCALL_DOMAIN=$domain
STACKCALL_BIND_IP=$bind_ip
CADDY_PORT=$port
CADDY_SITE=$site
LIVEKIT_IDLE_MINUTES=0
EOF
        ln -- "$temp_env" "$env_file" || die 'Outro processo criou o .env. Rode o instalador novamente.'
        rm -- "$temp_env"
        trap - EXIT
        unset key secret
    fi
    chmod 600 -- "$env_file"

    compose=(docker compose --project-name stackcall-selfhost --env-file "$env_file" -f "$infra/docker-compose.selfhost.yml")
    if ! $local_mode; then
        compose+=(-f "$infra/docker-compose.public.yml")
    fi
    idle_minutes=$(sed -n 's/^LIVEKIT_IDLE_MINUTES=//p' "$env_file")
    idle_minutes=${idle_minutes:-0}
    [[ "$idle_minutes" =~ ^[0-9]{1,5}$ ]] && (( 10#$idle_minutes <= 10080 )) ||
        die 'LIVEKIT_IDLE_MINUTES deve estar entre 0 e 10080.'
    if (( 10#$idle_minutes > 0 )); then
        [[ -f "$infra/docker-compose.sleep.yml" ]] || die 'O checkout não inclui o Compose de suspensão.'
        compose+=(-f "$infra/docker-compose.sleep.yml")
    elif [[ -f "$infra/docker-compose.sleep.yml" ]]; then
        # Desativa um controlador criado numa instalação anterior.
        "${compose[@]}" -f "$infra/docker-compose.sleep.yml" rm --force --stop livekit-control
    fi
    printf '%s\n' "$ports"
    "${compose[@]}" config --quiet
    if $update; then
        "${compose[@]}" pull --ignore-buildable
    fi
    "${compose[@]}" up "${up_options[@]}"

    local deadline=$((SECONDS + 180))
    while (( SECONDS < deadline )); do
        if curl "${curl_options[@]}" "$origin/api/health" >/dev/null 2>&1; then
            printf 'Porteiro pronto em %s\n' "$origin"
            invite=$("${compose[@]}" logs --no-color --no-log-prefix porteiro |
                sed -En 's#^(CONVITE_DONO=|Convite do dono: )(https?://[^[:space:]]+/c/[^[:space:]]+)$#\2#p' | tail -n 1)
            if [[ -n "$invite" ]]; then
                printf 'Convite do dono (uso privado): %s\n' "$invite"
            else
                printf '%s\n' 'O porteiro não publicou um novo convite do dono.'
            fi
            return
        fi
        sleep 2
    done
    die 'O porteiro não respondeu em /api/health. Confira o Docker e, no modo público, o DNS e a porta 443/tcp.'
}

main "$@"

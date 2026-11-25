#!/usr/bin/env bash
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
sandbox=$(mktemp -d)
trap 'rmdir -- "$sandbox"' EXIT
export XDG_CONFIG_HOME="$sandbox"

public=$(bash "$repo/infra/instalar.sh" --simular --dominio stackcall.example)
[[ "$public" == *'https://stackcall.example'* && "$public" == *'443/tcp, 7881/tcp, 7882/udp, 3478/udp'* ]]
fallback=$(bash "$repo/infra/instalar.sh" --simular)
[[ "$fallback" == *'https://203.0.113.10.sslip.io'* ]]

lan=$(bash "$repo/infra/instalar.sh" --simular --local --ip 192.168.1.23 --atualizar)
[[ "$lan" == *'http://192.168.1.23:8100'* && "$lan" == *'--force-recreate'* ]]
[[ "$lan" == *'8100/tcp, 7881/tcp, 7882/udp'* && "$lan" != *'3478/udp'* ]]

if bash "$repo/infra/instalar.sh" --simular --local --ip 192.168.1.999 >/dev/null 2>&1; then
    printf 'O instalador aceitou um IPv4 inválido.\n' >&2
    exit 1
fi
[[ ! -e "$sandbox/stackcall" ]]
printf 'Simulação pública, LAN e atualização conferidas.\n'

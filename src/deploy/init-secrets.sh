#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]] || [[ ! "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    printf 'Utilização: %s <dominio>\n' "$0" >&2
    exit 2
fi

command -v openssl >/dev/null 2>&1 || {
    printf 'É necessário instalar o OpenSSL para gerar os segredos.\n' >&2
    exit 1
}

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ -e .env || -e secrets/admin_key || -e secrets/session_secret ]]; then
    printf 'Já existe configuração ou pelo menos um segredo. Não vou substituir credenciais existentes.\n' >&2
    exit 1
fi

umask 077
mkdir -p secrets
printf 'DOMAIN=%s\n' "$1" > .env
openssl rand -hex 32 > secrets/admin_key
openssl rand -hex 32 > secrets/session_secret
chmod 600 .env secrets/admin_key secrets/session_secret

printf 'Configuração criada. Confirma que o DNS aponta para esta VPS e executa: docker compose up --build -d\n'

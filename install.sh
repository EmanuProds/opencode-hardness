#!/usr/bin/env bash
#
# install.sh — Instala o plugin delegation no OpenCode do usuário.
#
# Faz backup da configuração existente antes de sobrescrever.
#
# Uso:
#   ./install.sh
#

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="${REPO_DIR}/plugins/delegation/delegation.ts"
PLUGIN_DST_DIR="${HOME}/.config/opencode/plugins"
PLUGIN_DST="${PLUGIN_DST_DIR}/delegation.ts"

CONFIG_SRC="${REPO_DIR}/opencode.json"
CONFIG_DST="${HOME}/.config/opencode/opencode.json"

echo "==> Instalando plugin delegation (opencode-hardness)"

# --- Garante que o diretório de plugins exista ---
mkdir -p "${PLUGIN_DST_DIR}"

# --- Copia o plugin ---
if [[ -f "${PLUGIN_SRC}" ]]; then
  cp "${PLUGIN_SRC}" "${PLUGIN_DST}"
  echo "   plugin copiado para ${PLUGIN_DST}"
else
  echo "   ERRO: plugin não encontrado em ${PLUGIN_SRC}" >&2
  exit 1
fi

# --- Backup e instalação do opencode.json ---
if [[ -f "${CONFIG_SRC}" ]]; then
  if [[ -f "${CONFIG_DST}" ]]; then
    BACKUP="${CONFIG_DST}.bak.$(date +%Y%m%d%H%M%S)"
    cp "${CONFIG_DST}" "${BACKUP}"
    echo "   backup da config existente: ${BACKUP}"
  fi
  cp "${CONFIG_SRC}" "${CONFIG_DST}"
  echo "   opencode.json instalado em ${CONFIG_DST}"
else
  echo "   AVISO: opencode.json não encontrado em ${CONFIG_SRC}, pulando."
fi

echo "==> Instalação concluída."

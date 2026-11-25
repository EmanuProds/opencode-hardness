#!/usr/bin/env bash
#
# install.sh — Installs the delegation plugin into the user's OpenCode.
#
# Backs up existing configuration before overwriting.
#
# Usage:
#   ./install.sh
#

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="${REPO_DIR}/plugins/delegation/delegation.ts"
PLUGIN_DST_DIR="${HOME}/.config/opencode/plugins"
PLUGIN_DST="${PLUGIN_DST_DIR}/delegation.ts"

CONFIG_SRC="${REPO_DIR}/opencode.json"
CONFIG_DST="${HOME}/.config/opencode/opencode.json"

echo "==> Installing delegation plugin (opencode-hardness)"

# --- Ensure plugin directory exists ---
mkdir -p "${PLUGIN_DST_DIR}"

# --- Copy the plugin ---
if [[ -f "${PLUGIN_SRC}" ]]; then
  cp "${PLUGIN_SRC}" "${PLUGIN_DST}"
  echo "   plugin copied to ${PLUGIN_DST}"
else
  echo "   ERROR: plugin not found at ${PLUGIN_SRC}" >&2
  exit 1
fi

# --- Backup and install opencode.json ---
if [[ -f "${CONFIG_SRC}" ]]; then
  if [[ -f "${CONFIG_DST}" ]]; then
    BACKUP="${CONFIG_DST}.bak.$(date +%Y%m%d%H%M%S)"
    cp "${CONFIG_DST}" "${BACKUP}"
    echo "   backup of existing config: ${BACKUP}"
  fi
  cp "${CONFIG_SRC}" "${CONFIG_DST}"
  echo "   opencode.json installed to ${CONFIG_DST}"
else
  echo "   WARNING: opencode.json not found at ${CONFIG_SRC}, skipping."
fi

echo "==> Installation complete."
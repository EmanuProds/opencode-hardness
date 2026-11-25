#!/usr/bin/env bash
#
# install.sh — Installs all OpenCode plugins from this repository.
#
# Backs up existing configuration before overwriting.
#
# Usage:
#   ./install.sh
#

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_SRC_DIR="${REPO_DIR}/plugins"
PLUGIN_DST_DIR="${HOME}/.config/opencode/plugins"
CONFIG_SRC="${REPO_DIR}/opencode.json"
CONFIG_DST="${HOME}/.config/opencode/opencode.json"

echo "==> Installing OpenCode plugins from opencode-hardness"

# --- Ensure plugin directory exists ---
mkdir -p "${PLUGIN_DST_DIR}"

# --- Copy every plugin from plugins/*/<plugin>.ts ---
installed=0
for plugin_dir in "${PLUGINS_SRC_DIR}"/*/; do
  plugin_name="$(basename "${plugin_dir}")"
  plugin_src="${plugin_dir}/${plugin_name}.ts"

  if [[ -f "${plugin_src}" ]]; then
    cp "${plugin_src}" "${PLUGIN_DST_DIR}/${plugin_name}.ts"
    echo "   plugin installed: ${plugin_name}.ts"
    installed=$((installed + 1))
  else
    echo "   WARNING: no ${plugin_name}.ts found in ${plugin_dir}, skipping."
  fi
done

if [[ "${installed}" -eq 0 ]]; then
  echo "   ERROR: no plugins were installed." >&2
  exit 1
fi

echo "   ${installed} plugin(s) installed to ${PLUGIN_DST_DIR}"

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

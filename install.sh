#!/usr/bin/env bash
#
# install.sh — Installs all OpenCode plugins from this repository.
#
# Copies only the plugin entrypoint file (<plugin>.ts or <plugin>.js).
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

# --- Copy only the plugin entrypoint file ---
installed=0
for plugin_dir in "${PLUGINS_SRC_DIR}"/*/; do
  plugin_name="$(basename "${plugin_dir}")"

  # Skip non-plugin directories (e.g. lib/)
  if [[ ! -f "${plugin_dir}/${plugin_name}.ts" && ! -f "${plugin_dir}/${plugin_name}.js" ]]; then
    echo "   skipping non-plugin directory: ${plugin_name}"
    continue
  fi

  # Prefer .js, fallback to .ts
  if [[ -f "${plugin_dir}/${plugin_name}.js" ]]; then
    cp "${plugin_dir}/${plugin_name}.js" "${PLUGIN_DST_DIR}/${plugin_name}.js"
  elif [[ -f "${plugin_dir}/${plugin_name}.ts" ]]; then
    cp "${plugin_dir}/${plugin_name}.ts" "${PLUGIN_DST_DIR}/${plugin_name}.ts"
  fi

  echo "   plugin installed: ${plugin_name}"
  installed=$((installed + 1))
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

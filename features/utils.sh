#!/bin/bash

# ────── Commande d'installation adaptée au package manager ──────
get_install_cmd() {
  local PM=$1
  case "$PM" in
    yarn) echo "add" ;;
    pnpm|npm) echo "install" ;;
    *) echo "install" ;;
  esac
}

# ────── Vérifie si une commande est installée ──────
assert_command_exists() {
  local CMD=$1
  if ! command -v "$CMD" &> /dev/null; then
    echo "❌ Commande introuvable : $CMD"
    echo "👉 Installe-la ou vérifie ton PATH"
    exit 1
  fi
}

# ────── Formatage ──────
to_pascal_case() {
  echo "$1" | sed -E 's/(^|-|_)([a-z])/\U\2/g'
}
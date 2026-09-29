#!/usr/bin/env bash

NEST_CLI_VERSION="12.0.0"

assert_package_manager() {
  local package_manager=$1
  case "$package_manager" in
    npm|pnpm|yarn) assert_command_exists "$package_manager" ;;
    *)
      echo "❌ Package manager non supporté : $package_manager. Valeurs acceptées : npm, pnpm, yarn."
      return 1
      ;;
  esac
}

pm_add() {
  local package_manager=$1
  shift
  case "$package_manager" in
    npm) npm install "$@" ;;
    pnpm) pnpm add "$@" ;;
    yarn) yarn add "$@" ;;
  esac
}

pm_add_dev() {
  local package_manager=$1
  shift
  case "$package_manager" in
    npm) npm install --save-dev "$@" ;;
    pnpm) pnpm add --save-dev "$@" ;;
    yarn) yarn add --dev "$@" ;;
  esac
}

pm_exec() {
  local package_manager=$1
  shift
  case "$package_manager" in
    npm) npm exec -- "$@" ;;
    pnpm) pnpm exec "$@" ;;
    yarn) yarn exec "$@" ;;
  esac
}

nest_new() {
  local package_manager=$1
  local destination=$2
  case "$package_manager" in
    npm) npx --yes "@nestjs/cli@${NEST_CLI_VERSION}" new "$destination" --package-manager npm --skip-git ;;
    pnpm) pnpm dlx "@nestjs/cli@${NEST_CLI_VERSION}" new "$destination" --package-manager pnpm --skip-git ;;
    yarn) yarn dlx "@nestjs/cli@${NEST_CLI_VERSION}" new "$destination" --package-manager yarn --skip-git ;;
  esac
}

# ────── Vérifie si une commande est installée ──────
assert_command_exists() {
  local CMD=$1
  if ! command -v "$CMD" &> /dev/null; then
    echo "❌ Commande introuvable : $CMD"
    echo "👉 Installe-la ou vérifie ton PATH"
    return 1
  fi
}

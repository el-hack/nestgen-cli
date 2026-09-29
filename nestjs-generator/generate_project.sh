#!/usr/bin/env bash

# ────── INIT ──────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FEATURES_PATH="$SCRIPT_DIR/features"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"

# ────── DEBUG MODE ──────
DEBUG=false
for arg in "$@"; do
  [[ "$arg" == "--debug" ]] && DEBUG=true
done

debug_log() {
  if [ "$DEBUG" = true ]; then
    echo "🐞 [DEBUG] $1" | tee /dev/tty
  fi
}

run_step() {
  local step=$1
  shift

  log_info "$step"
  if "$@"; then
    return 0
  else
    local status=$?
    log_error "$step a échoué (code $status)."
    exit "$status"
  fi
}

debug_log "Script lancé avec les arguments : $*"
debug_log "Chemin du script courant : $(pwd)"
debug_log "Features path : $FEATURES_PATH"

# ────── INFOS UTILISATEUR ──────
APP_NAME=${APP_NAME:-$(read -p "📛 Nom du projet : " tmp && echo "$tmp")}
PROJECT_PATH=${PROJECT_PATH:-$(read -p "📁 Chemin d’installation (vide = ici) : " tmp && echo "${tmp:-$(pwd)}")}
FULL_PATH="$PROJECT_PATH/$APP_NAME"
PM=${PM:-$(read -p "📦 Package manager (npm/yarn/pnpm) : " tmp && echo "$tmp")}
ORM=${ORM:-$(read -p "🧠 ORM ? (typeorm/prisma) : " tmp && echo "$tmp")}

INSTALL_CMD=$(get_install_cmd "$PM")
debug_log "Install command : $PM $INSTALL_CMD"

# ────── Vérification de Nest CLI ──────
if ! command -v nest &> /dev/null; then
  log_warn "Nest CLI non installée. Installation avec npm..."
  run_step "Installation de Nest CLI" npm install -g @nestjs/cli
fi

# ────── Création du projet ──────
log_info "Création du projet à $FULL_PATH"
mkdir -p "$FULL_PATH"
cd "$FULL_PATH" || {
  log_error "Erreur : impossible de se déplacer dans $FULL_PATH"
  exit 1
}

run_step "Création du projet NestJS" nest new . --package-manager "$PM" --skip-git

run_step "Installation des packages communs" "$PM" "$INSTALL_CMD" @nestjs/cqrs class-validator class-transformer @nestjs/config

# ────── ORM SETUP ──────
case "$ORM" in
  typeorm)
    debug_log "Appel de typeorm.sh"
    run_step "Configuration de TypeORM" bash "$FEATURES_PATH/typeorm.sh" "$PM" "$APP_NAME"
    ;;
  prisma)
    debug_log "Appel de prisma.sh"
    run_step "Configuration de Prisma" bash "$FEATURES_PATH/prisma.sh" "$PM" "$APP_NAME"
    ;;
  *)
    log_error "❌ ORM non reconnu : $ORM"
    exit 1
    ;;
esac

# ────── Docker, Swagger, Git ──────
WITH_DOCKER=${WITH_DOCKER:-$(read -p "🐳 Activer Docker ? (y/n) : " tmp && echo "$tmp")}
if [ "$WITH_DOCKER" = "y" ]; then
  run_step "Configuration Docker" bash "$FEATURES_PATH/docker.sh" "$APP_NAME"
fi

WITH_SWAGGER=${WITH_SWAGGER:-$(read -p "📚 Activer Swagger ? (y/n) : " tmp && echo "$tmp")}
if [ "$WITH_SWAGGER" = "y" ]; then
  run_step "Configuration Swagger" bash "$FEATURES_PATH/swagger.sh" "$PM"
fi

WITH_GIT=${WITH_GIT:-$(read -p "🔃 Initialiser Git ? (y/n) : " tmp && echo "$tmp")}
if [ "$WITH_GIT" = "y" ]; then
  run_step "Initialisation Git" bash "$FEATURES_PATH/git.sh"
fi

# ────── Modules à générer ──────
MODULES=${MODULES-$(read -p "👤 Modules à générer (séparés par espaces) : " tmp && echo "$tmp")}
for MODULE in $MODULES; do
  debug_log "Génération du module $MODULE"
  run_step "Génération du module $MODULE" bash "$FEATURES_PATH/add_module.sh" "$MODULE" "$ORM"
done

# ────── Résumé final ──────
echo ""
log_success "✅ Projet NestJS \"$APP_NAME\" généré avec succès 🎉"
echo "📁 Localisation : $FULL_PATH"
echo "📦 Package manager : $PM"
echo "🧠 ORM : $ORM"
if [ "$WITH_DOCKER" = "y" ]; then echo "🐳 Docker activé"; fi
if [ "$WITH_SWAGGER" = "y" ]; then echo "📚 Swagger activé"; fi
if [ "$WITH_GIT" = "y" ]; then echo "🔃 Git initialisé"; fi
if [ -n "$MODULES" ]; then echo "📦 Modules générés : $MODULES"; fi

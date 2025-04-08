#!/bin/bash

# ────── INIT ──────
set -e

FEATURES_PATH="$(dirname "$0")/features"
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
  npm install -g @nestjs/cli
  if ! command -v nest &> /dev/null; then
    log_error "Nest CLI toujours indisponible après installation"
    echo "💡 Fais : source ~/.zshrc ou redémarre ton terminal"
    exit 1
  fi
fi

# ────── Création du projet ──────
log_info "Création du projet à $FULL_PATH"
mkdir -p "$FULL_PATH"
cd "$FULL_PATH" || {
  log_error "Erreur : impossible de se déplacer dans $FULL_PATH"
  exit 1
}

nest new . --package-manager "$PM" --skip-git || {
  log_error "Échec de nest new"
  exit 1
}

log_info "Installation des packages communs..."
$PM $INSTALL_CMD @nestjs/cqrs class-validator class-transformer @nestjs/config

# ────── ORM SETUP ──────
case "$ORM" in
  typeorm)
    debug_log "Appel de typeorm.sh"
    bash "$FEATURES_PATH/typeorm.sh" "$PM" "$APP_NAME"
    ;;
  prisma)
    debug_log "Appel de prisma.sh"
    bash "$FEATURES_PATH/prisma.sh" "$PM" "$APP_NAME"
    ;;
  *)
    log_error "❌ ORM non reconnu : $ORM"
    exit 1
    ;;
esac

# ────── Docker, Swagger, Git (ENV + fallback interactif) ──────
WITH_DOCKER=${WITH_DOCKER:-$(read -p "🐳 Activer Docker ? (y/n) : " tmp && echo "$tmp")}
[ "$WITH_DOCKER" = "y" ] && bash "$FEATURES_PATH/docker.sh" "$APP_NAME"

WITH_SWAGGER=${WITH_SWAGGER:-$(read -p "📚 Activer Swagger ? (y/n) : " tmp && echo "$tmp")}
[ "$WITH_SWAGGER" = "y" ] && bash "$FEATURES_PATH/swagger.sh" "$PM"

WITH_GIT=${WITH_GIT:-$(read -p "🔃 Initialiser Git ? (y/n) : " tmp && echo "$tmp")}
[ "$WITH_GIT" = "y" ] && bash "$FEATURES_PATH/git.sh"

# ────── Modules à générer (ENV + fallback) ──────
MODULES=${MODULES:-$(read -p "👤 Modules à générer (séparés par espaces) : " tmp && echo "$tmp")}
for MODULE in $MODULES; do
  debug_log "Génération du module $MODULE"
  bash "$FEATURES_PATH/add_module.sh" "$MODULE" "$ORM"
done

# ────── Ajout de TypeOrmModule si besoin ──────
if [ "$ORM" = "typeorm" ]; then
  log_info "Ajout automatique de TypeOrmModule.forRoot dans app.module.ts"

  cat > src/app.module.ts <<EOF
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'appdb',
      synchronize: true,
      autoLoadEntities: true,
    }),
  ],
})
export class AppModule {}
EOF
fi

# ────── Résumé final ──────
echo ""
log_success "✅ Projet NestJS \"$APP_NAME\" généré avec succès 🎉"
echo "📁 Localisation : $FULL_PATH"
echo "📦 Package manager : $PM"
echo "🧠 ORM : $ORM"
[ "$WITH_DOCKER" = "y" ] && echo "🐳 Docker activé"
[ "$WITH_SWAGGER" = "y" ] && echo "📚 Swagger activé"
[ "$WITH_GIT" = "y" ] && echo "🔃 Git initialisé"
[ -n "$MODULES" ] && echo "📦 Modules générés : $MODULES"

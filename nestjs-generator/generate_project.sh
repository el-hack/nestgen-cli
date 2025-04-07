#!/bin/bash

# ────── INIT ──────
set -e

FEATURES_PATH="$(dirname "$0")/features"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"

DEBUG=false
for arg in "$@"; do
  if [[ "$arg" == "--debug" ]]; then
    DEBUG=true
  fi
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
read -p "📛 Nom du projet : " APP_NAME
read -p "📁 Chemin d’installation (vide = ici) : " PROJECT_PATH
PROJECT_PATH=${PROJECT_PATH:-$(pwd)}
FULL_PATH="$PROJECT_PATH/$APP_NAME"
read -p "📦 Package manager (npm/yarn/pnpm) : " PM
read -p "🧠 ORM ? (typeorm/prisma) : " ORM

INSTALL_CMD=$(get_install_cmd "$PM")
debug_log "Install command pour $PM : $PM $INSTALL_CMD"

# ────── Vérifier Nest CLI ──────
if ! command -v nest &> /dev/null; then
  log_warn "La CLI NestJS (nest) n’est pas installée."
  log_info "Installation via : npm install -g @nestjs/cli"
  npm install -g @nestjs/cli

  if ! command -v nest &> /dev/null; then
    log_error "nest CLI toujours indisponible après installation."
    echo "💡 source ~/.zshrc ou redémarre ton terminal"
    exit 1
  fi
fi

# ────── Génération du projet ──────
log_info "Création du projet à $FULL_PATH"
mkdir -p "$FULL_PATH"
cd "$FULL_PATH" || {
  log_error "Impossible de se déplacer dans $FULL_PATH"
  exit 1
}

nest new . --package-manager "$PM" --skip-git || {
  log_error "Échec de nest new"
  exit 1
}

log_info "Installation des packages de base..."
$PM $INSTALL_CMD @nestjs/cqrs class-validator class-transformer @nestjs/config

# ────── ORM ──────
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
    log_error "ORM non reconnu : $ORM"
    exit 1
    ;;
esac

# ────── Docker, Swagger, Git ──────
read -p "🐳 Activer Docker ? (y/n) : " WITH_DOCKER
[ "$WITH_DOCKER" = "y" ] && bash "$FEATURES_PATH/docker.sh" "$APP_NAME"

read -p "📚 Activer Swagger ? (y/n) : " WITH_SWAGGER
[ "$WITH_SWAGGER" = "y" ] && bash "$FEATURES_PATH/swagger.sh" "$PM"

read -p "🔃 Initialiser Git ? (y/n) : " WITH_GIT
[ "$WITH_GIT" = "y" ] && bash "$FEATURES_PATH/git.sh"

# ────── Modules ──────
read -p "👤 Modules à générer (séparés par espaces) : " MODULES
for MODULE in $MODULES; do
  debug_log "Génération du module $MODULE"
  bash "$FEATURES_PATH/add_module.sh" "$MODULE" "$ORM"
done

# ────── TypeORM Root Config ──────
if [ "$ORM" = "typeorm" ]; then
  log_info "Ajout de TypeOrmModule.forRoot dans app.module.ts"
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
log_success "Projet NestJS \"$APP_NAME\" généré avec succès 🎉"
echo "📁 Localisation : $FULL_PATH"
echo "🧠 ORM utilisé : $ORM"
echo "📦 Package manager : $PM"
[ "$WITH_DOCKER" = "y" ] && echo "🐳 Docker activé"
[ "$WITH_SWAGGER" = "y" ] && echo "📚 Swagger activé"
[ "$WITH_GIT" = "y" ] && echo "🔃 Git initialisé"
[ -n "$MODULES" ] && echo "📦 Modules générés : $MODULES"

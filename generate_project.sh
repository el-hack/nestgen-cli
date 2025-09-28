#!/bin/bash
set -euo pipefail

# CLI paths
CLI_ROOT="$(cd "$(dirname "$0")" && pwd)"
CLI_FEATURES="$CLI_ROOT/features"
source "$CLI_FEATURES/utils.sh"
source "$CLI_FEATURES/logger.sh"

# Prompts/env
APP_NAME=${APP_NAME:-$(read -p "📛 Nom du projet : " tmp && echo "$tmp")}
PROJECT_PATH=${PROJECT_PATH:-$(read -p "📁 Chemin d’installation (vide = ici) : " tmp && echo "${tmp:-$(pwd)}")}
FULL_PATH="$PROJECT_PATH/$APP_NAME"
PM=${PM:-$(read -p "📦 Package manager (npm/yarn/pnpm) : " tmp && echo "$tmp")}
ORM=${ORM:-$(read -p "🧠 ORM ? (typeorm/prisma) : " tmp && echo "$tmp")}
WITH_DOCKER=${WITH_DOCKER:-$(read -p "🐳 Activer Docker ? (y/n) : " tmp && echo "$tmp")}
WITH_SWAGGER=${WITH_SWAGGER:-$(read -p "📚 Activer Swagger ? (y/n) : " tmp && echo "$tmp")}
WITH_GIT=${WITH_GIT:-$(read -p "🔃 Initialiser Git ? (y/n) : " tmp && echo "$tmp")}
MODULES=${MODULES:-$(read -p "👤 Modules à générer (séparés par espaces) : " tmp && echo "$tmp")}

INSTALL_CMD=$(get_install_cmd "$PM")

# Nest CLI
command -v nest >/dev/null 2>&1 || { log_warn "Nest CLI absente, install via npm…"; npm i -g @nestjs/cli; }

# Créer projet
log_info "Création du projet : $FULL_PATH"
mkdir -p "$FULL_PATH"
cd "$FULL_PATH"
nest new . --package-manager "$PM" --skip-git

# Déps communes
log_info "Installation des packages communs…"
$PM $INSTALL_CMD @nestjs/cqrs class-validator class-transformer @nestjs/config

# ORM setup (scripts DU CLI, cwd = projet)
case "$ORM" in
  typeorm) bash "$CLI_FEATURES/typeorm.sh" "$PM" "$APP_NAME" ;;
  prisma)  bash "$CLI_FEATURES/prisma.sh"  "$PM" "$APP_NAME" ;;
  *) log_error "ORM non reconnu: $ORM"; exit 1 ;;
esac

# Options
[[ "$WITH_DOCKER" == "y" ]] && bash "$CLI_FEATURES/docker.sh" "$APP_NAME"
[[ "$WITH_SWAGGER" == "y" ]] && bash "$CLI_FEATURES/swagger.sh" "$PM"
[[ "$WITH_GIT"    == "y" ]] && bash "$CLI_FEATURES/git.sh"

# ─── Copier vendor du CLI vers le projet ───
if [ -d "$CLI_ROOT/templates/src/vendor" ]; then
  log_info "📦 Copie du vendor dans le projet"
  # On est déjà cd dans $FULL_PATH
  cp -R "$CLI_ROOT/templates/src/vendor" "src/"
  log_success "✅ Vendor copié dans src/vendor"
else
  log_warn "ℹ️  Aucun dossier $CLI_ROOT/templates/src/vendor trouvé — étape ignorée"
fi


# Génération des modules demandés (scripts DU CLI, cwd = projet)
for MODULE in $MODULES; do
  [[ -z "$MODULE" ]] && continue
  bash "$CLI_FEATURES/add_module.sh" "$MODULE" "$ORM"
done

# Injection globale dans src/app.module.ts
APP_MODULE="src/app.module.ts"

# CqrsModule
if ! grep -q "CqrsModule" "$APP_MODULE"; then
  sed -i '' "1i\\
import { CqrsModule } from '@nestjs/cqrs';
" "$APP_MODULE"
  sed -i '' "s|imports: \[|imports: [CqrsModule, |" "$APP_MODULE" || true
  echo "✅ CqrsModule injecté"
fi

# TypeOrmModule
if [[ "$ORM" == "typeorm" ]]; then
  if ! grep -q "TypeOrmModule" "$APP_MODULE"; then
    sed -i '' "1i\\
import { TypeOrmModule } from '@nestjs/typeorm';
" "$APP_MODULE"
    echo "✅ Import de TypeOrmModule ajouté"
  fi
  if ! grep -q "TypeOrmModule.forRoot" "$APP_MODULE"; then
    sed -i '' -E 's/(imports: \[[^]]*)(])/\1\
    TypeOrmModule.forRoot({\
      type: '\''postgres'\'',\
      host: '\''localhost'\'',\
      port: 5432,\
      username: '\''postgres'\'',\
      password: '\''postgres'\'',\
      database: '\''appdb'\'',\
      synchronize: true,\
      autoLoadEntities: true,\
    }), \2/g' "$APP_MODULE"
    echo "✅ TypeOrmModule.forRoot injecté"
  fi
fi

# Injection des modules (utilise script DU CLI)
for MODULE in $MODULES; do
  [[ -z "$MODULE" ]] && continue
  bash "$CLI_FEATURES/inject_module_to_app.sh" "$MODULE" "$ORM"
done

echo ""
log_success "✅ Projet NestJS \"$APP_NAME\" généré avec succès 🎉"
echo "📁 Localisation : $FULL_PATH"
echo "📦 Package manager : $PM"
echo "🧠 ORM : $ORM"
[[ "$WITH_DOCKER" == "y" ]] && echo "🐳 Docker activé"
[[ "$WITH_SWAGGER" == "y" ]] && echo "📚 Swagger activé"
[[ "$WITH_GIT"    == "y" ]] && echo "🔃 Git initialisé"
[[ -n "$MODULES" ]] && echo "📦 Modules générés : $MODULES"

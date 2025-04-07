#!/bin/bash

PM=$1
APP_NAME=$2

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"

INSTALL_CMD=$(get_install_cmd "$PM")

log_info "📦 Installation de TypeORM et PostgreSQL..."

$PM $INSTALL_CMD @nestjs/typeorm typeorm pg

log_success "✅ TypeORM installé avec succès"

log_info "💡 TypeORM sera automatiquement configuré dans app.module.ts"

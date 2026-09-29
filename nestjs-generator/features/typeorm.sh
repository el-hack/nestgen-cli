#!/usr/bin/env bash

set -euo pipefail

PM=${1:?Package manager requis}
APP_NAME=${2:?Nom_application_requis}

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"

log_info "📦 Installation de TypeORM et PostgreSQL..."

pm_add "$PM" @nestjs/typeorm@12 typeorm@0.3 pg@8

log_success "✅ TypeORM installé avec succès"

log_info "💡 TypeORM sera automatiquement configuré dans app.module.ts"

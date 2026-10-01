#!/usr/bin/env bash

set -euo pipefail

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"


PM=${1:?Package manager requis}

pm_add "$PM" @nestjs/swagger@12 swagger-ui-express@5
log_success "Swagger sera activé sur /api dans src/main.ts."

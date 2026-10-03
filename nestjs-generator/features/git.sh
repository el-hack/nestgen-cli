#!/usr/bin/env bash

set -euo pipefail

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"


git init
git add .
git commit -m "🚀 Initial commit (NestJS starter clean architecture)"
log_success "Git initialisé et commité !"

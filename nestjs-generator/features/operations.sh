#!/usr/bin/env bash

source "$(dirname "${BASH_SOURCE[0]}")/logger.sh"

set -euo pipefail

ORM=${1:?ORM requis}
FEATURES_PATH="$(dirname "$0")"

if [[ "$ORM" != "typeorm" && "$ORM" != "prisma" ]]; then
  log_error "ORM non supporté : $ORM" >&2
  exit 1
fi

node "$FEATURES_PATH/operational_foundation.mjs" src "$ORM"
node "$FEATURES_PATH/update_app_module.mjs" src/app.module.ts OperationsModule './operations/operations.module' "$ORM"

log_success "Socle d’exploitation configuré : /health/live et /health/ready."

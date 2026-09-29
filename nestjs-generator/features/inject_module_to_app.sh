#!/usr/bin/env bash

set -euo pipefail

RAW_NAME=${1:-}
ORM=${2:-}
APP_MODULE="src/app.module.ts"
MODULE_FILE="src/app/${RAW_NAME}/${RAW_NAME}.module.ts"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$RAW_NAME" ]]; then
  echo "❌ Tu dois fournir un nom de module." >&2
  exit 1
fi

if [[ "$ORM" != "typeorm" && "$ORM" != "prisma" ]]; then
  echo "❌ ORM non supporté : ${ORM:-vide}." >&2
  exit 1
fi

if [[ ! -f "$MODULE_FILE" ]]; then
  echo "❌ Le fichier $MODULE_FILE est introuvable." >&2
  exit 1
fi

MODULE_CLASS=$(grep -oE 'export class [A-Za-z0-9_]+' "$MODULE_FILE" | awk '{print $3}')

if [[ -z "$MODULE_CLASS" ]]; then
  echo "❌ Impossible de détecter la classe du module dans $MODULE_FILE" >&2
  exit 1
fi

MODULE_PATH="./app/${RAW_NAME}/${RAW_NAME}.module"

if [[ ! -f "$APP_MODULE" ]]; then
  echo "📄 Création de $APP_MODULE"
  mkdir -p src
  cat > "$APP_MODULE" <<'EOF'
import { Module } from '@nestjs/common';

@Module({
  imports: [],
})
export class AppModule {}
EOF
fi

# Le transformateur prépare le nouveau contenu en mémoire et n'écrit qu'après
# avoir validé le décorateur @Module et son tableau imports.
node "$SCRIPT_DIR/update_app_module.mjs" "$APP_MODULE" "$MODULE_CLASS" "$MODULE_PATH" "$ORM"

echo "🎯 Module $MODULE_CLASS injecté dans app.module.ts avec succès 🧩"

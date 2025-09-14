#!/bin/bash

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")/features"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"


git init
git add .
git commit -m "🚀 Initial commit (NestJS starter clean architecture)"
echo "✅ Git initialisé et commité !"

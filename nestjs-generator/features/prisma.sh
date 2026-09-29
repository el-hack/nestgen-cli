#!/usr/bin/env bash

set -euo pipefail

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"


PM=${1:?Package manager requis}
APP_NAME=${2:?Nom_application_requis}

if [ -e prisma/schema.prisma ]; then
  echo "❌ prisma/schema.prisma existe déjà. Aucune configuration Prisma n'a été remplacée."
  exit 1
fi

$PM install prisma --save-dev
$PM install @prisma/client
npx prisma init

if [ ! -e .env ]; then
cat > .env <<EOF
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/$APP_NAME"
EOF
else
  echo "ℹ️  .env existe déjà et a été conservé."
fi

cat > prisma/schema.prisma <<EOF
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
EOF

npx prisma generate

echo "✅ Prisma initialisé avec succès !"

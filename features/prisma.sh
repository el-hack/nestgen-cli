#!/bin/bash

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")/features"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"


PM=$1
APP_NAME=$2

$PM install prisma --save-dev
$PM install @prisma/client
npx prisma init

cat > .env <<EOF
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/$APP_NAME"
EOF

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

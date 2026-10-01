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

pm_add_dev "$PM" prisma@6
pm_add "$PM" @prisma/client@6
pm_exec "$PM" prisma init

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

mkdir -p src/prisma
cat > src/prisma/prisma.service.ts <<'EOF'
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
EOF

cat > src/prisma/prisma.module.ts <<'EOF'
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
EOF

pm_exec "$PM" prisma generate

echo "✅ Prisma initialisé avec succès !"

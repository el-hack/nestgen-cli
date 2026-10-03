#!/usr/bin/env bash

set -euo pipefail

PM=${1:?Package manager requis}
APP_NAME=${2:?Nom_application_requis}

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"

log_info "Installation de TypeORM et PostgreSQL..."

pm_add "$PM" @nestjs/typeorm@12 typeorm@0.3 pg@8 dotenv@16
pm_add_dev "$PM" ts-node@10

mkdir -p src/database/migrations

cat > src/database/typeorm.config.ts <<'EOF'
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export function typeOrmOptions(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: required('DATABASE_HOST'),
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: required('DATABASE_USER'),
    password: required('DATABASE_PASSWORD'),
    database: required('DATABASE_NAME'),
    autoLoadEntities: true,
    synchronize: false,
    migrationsRun: false,
    migrations: ['dist/database/migrations/*.js'],
  };
}
EOF

cat > src/database/data-source.ts <<'EOF'
import 'dotenv/config';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { typeOrmOptions } from './typeorm.config';

const options = typeOrmOptions();

export default new DataSource({
  ...(options as DataSourceOptions),
  entities: ['src/**/*.entity{.ts,.js}'],
  migrations: ['src/database/migrations/*{.ts,.js}'],
});
EOF

cat > src/database/migrations/0000000000000-InitialSchema.ts <<'EOF'
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema0000000000000 implements MigrationInterface {
  async up(_queryRunner: QueryRunner): Promise<void> {}
  async down(_queryRunner: QueryRunner): Promise<void> {}
}
EOF

if [ ! -e .env.example ]; then
  cat > .env.example <<'EOF'
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=change-me
DATABASE_NAME=appdb
EOF
fi

log_success "TypeORM installé avec succès"

log_info "TypeORM utilise src/database/typeorm.config.ts et src/database/data-source.ts pour des migrations explicites."

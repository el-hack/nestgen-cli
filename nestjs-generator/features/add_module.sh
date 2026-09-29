#!/bin/bash

set -euo pipefail

RAW_NAME=${1:-}
ORM=${2:-}

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"


if [[ ! "$RAW_NAME" =~ ^[A-Za-z][A-Za-z0-9_-]*$ ]]; then
  log_error "Le nom du module doit commencer par une lettre et ne contenir que des lettres, chiffres, tirets ou underscores."
  exit 1
fi

if [[ "$ORM" != "typeorm" && "$ORM" != "prisma" ]]; then
  log_error "ORM non supporté : ${ORM:-vide}. Valeurs acceptées : typeorm, prisma."
  exit 1
fi

# ────── Formatage portable ──────
if ! RESOURCE_DATA=$(node "$FEATURES_PATH/resource_name.mjs" "$RAW_NAME"); then
  log_error "Impossible de normaliser le nom de la ressource."
  exit 1
fi

while IFS='=' read -r key value; do
  case "$key" in
    NAME) NAME=$value ;;
    PASCAL) PASCAL=$value ;;
    CAMEL) CAMEL=$value ;;
    PLURAL) PLURAL=$value ;;
    ROUTE) ROUTE=$value ;;
    TABLE) TABLE=$value ;;
  esac
done <<< "$RESOURCE_DATA"

if [[ -z "${NAME:-}" || -z "${PASCAL:-}" || -z "${CAMEL:-}" || -z "${ROUTE:-}" || -z "${TABLE:-}" ]]; then
  log_error "Impossible de normaliser le nom de la ressource."
  exit 1
fi

REPOSITORY_TOKEN="${PASCAL}RepositoryToken"

PROJECT_ROOT="$(pwd -P)"
SOURCE_ROOT="$PROJECT_ROOT/src/app"

if ! node "$FEATURES_PATH/preflight.mjs" "$PROJECT_ROOT" "$ORM" >/dev/null; then
  log_error "Le projet cible ne satisfait pas les préconditions de génération."
  exit 1
fi

if [ -L "$PROJECT_ROOT/src" ] || [ -L "$SOURCE_ROOT" ]; then
  log_error "Les liens symboliques ne sont pas pris en charge dans src/app."
  exit 1
fi

mkdir -p "$SOURCE_ROOT"
MODULE_DIR="$SOURCE_ROOT/$NAME"

if [ -e "$MODULE_DIR" ] || [ -L "$MODULE_DIR" ]; then
  log_error "Le module $NAME existe déjà. Aucune modification n'a été appliquée."
  exit 1
fi

mkdir -p "$MODULE_DIR"/{core/{application/{commands,events,queries},domain/{entities,ports}},infrastructure/{adapters,persistences/repositories},interfaces/{controllers,dtos}}

# ────── Entity ──────
cat > "$MODULE_DIR/core/domain/entities/${NAME}.entity.ts" <<EOF
export class $PASCAL {
  constructor(
    public readonly id: string,
    public name: string,
    public email: string,
  ) {}
}
EOF

# ────── Port ──────
cat > "$MODULE_DIR/core/domain/ports/${NAME}.repository.ts" <<EOF
import { $PASCAL } from '../entities/${NAME}.entity';

export const ${REPOSITORY_TOKEN} = Symbol('${PASCAL}RepositoryPort');

export interface ${PASCAL}RepositoryPort {
  save(${CAMEL}: $PASCAL): Promise<$PASCAL>;
  findById(id: string): Promise<$PASCAL | null>;
}
EOF

# ────── Command ──────
cat > "$MODULE_DIR/core/application/commands/create-${NAME}.command.ts" <<EOF
export class Create${PASCAL}Command {
  constructor(public readonly name: string, public readonly email: string) {}
}
EOF

# ────── Command Handler ──────
cat > "$MODULE_DIR/core/application/commands/create-${NAME}.handler.ts" <<EOF
import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Create${PASCAL}Command } from './create-${NAME}.command';
import { $PASCAL } from '../../domain/entities/${NAME}.entity';
import { ${PASCAL}RepositoryPort, ${REPOSITORY_TOKEN} } from '../../domain/ports/${NAME}.repository';

@CommandHandler(Create${PASCAL}Command)
export class Create${PASCAL}Handler implements ICommandHandler<Create${PASCAL}Command> {
  constructor(
    @Inject(${REPOSITORY_TOKEN}) private readonly repo: ${PASCAL}RepositoryPort,
  ) {}

  async execute(command: Create${PASCAL}Command): Promise<string> {
    const $CAMEL = new $PASCAL(Date.now().toString(), command.name, command.email);
    const saved = await this.repo.save($CAMEL);
    return saved.id;
  }
}
EOF

# ────── DTO ──────
cat > "$MODULE_DIR/interfaces/dtos/create-${NAME}.dto.ts" <<EOF
import { IsEmail, IsString } from 'class-validator';

export class Create${PASCAL}Dto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;
}
EOF

# ────── Controller ──────
cat > "$MODULE_DIR/interfaces/controllers/${NAME}.controller.ts" <<EOF
import { Controller, Post, Body } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Create${PASCAL}Command } from '../../core/application/commands/create-${NAME}.command';
import { Create${PASCAL}Dto } from '../dtos/create-${NAME}.dto';

@Controller('${ROUTE}')
export class ${PASCAL}Controller {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  async create(@Body() dto: Create${PASCAL}Dto) {
    const id = await this.commandBus.execute(
      new Create${PASCAL}Command(dto.name, dto.email)
    );
    return { id };
  }
}
EOF

# ────── Repository ORM ──────
REPO_CLASS=""
ENTITY_IMPORT=""
REPO_PROVIDER=""

if [ "$ORM" == "typeorm" ]; then
  cat > "$MODULE_DIR/infrastructure/persistences/repositories/${NAME}.orm.ts" <<EOF
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('${TABLE}')
export class ${PASCAL}Entity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;
}
EOF

  cat > "$MODULE_DIR/infrastructure/persistences/repositories/${NAME}.typeorm.repository.ts" <<EOF
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ${PASCAL} } from '../../../core/domain/entities/${NAME}.entity';
import { ${PASCAL}RepositoryPort } from '../../../core/domain/ports/${NAME}.repository';
import { ${PASCAL}Entity } from './${NAME}.orm';

@Injectable()
export class ${PASCAL}TypeOrmRepository implements ${PASCAL}RepositoryPort {
  constructor(@InjectRepository(${PASCAL}Entity) private readonly repo: Repository<${PASCAL}Entity>) {}

  async save(${CAMEL}: $PASCAL): Promise<$PASCAL> {
    const entity = this.repo.create(${CAMEL});
    const saved = await this.repo.save(entity);
    return new $PASCAL(saved.id, saved.name, saved.email);
  }

  async findById(id: string): Promise<$PASCAL | null> {
    const found = await this.repo.findOneBy({ id });
    return found ? new $PASCAL(found.id, found.name, found.email) : null;
  }
}
EOF

  REPO_CLASS="${PASCAL}TypeOrmRepository"
  ENTITY_IMPORT="TypeOrmModule.forFeature([${PASCAL}Entity])"
  REPO_PROVIDER="{
      provide: ${REPOSITORY_TOKEN},
      useClass: ${PASCAL}TypeOrmRepository,
    }"

elif [ "$ORM" == "prisma" ]; then
  cat > "$MODULE_DIR/infrastructure/persistences/repositories/${NAME}.prisma.repository.ts" <<EOF
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma.service';
import { ${PASCAL} } from '../../../core/domain/entities/${NAME}.entity';
import { ${PASCAL}RepositoryPort } from '../../../core/domain/ports/${NAME}.repository';

@Injectable()
export class ${PASCAL}PrismaRepository implements ${PASCAL}RepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(${CAMEL}: ${PASCAL}): Promise<${PASCAL}> {
    const saved = await this.prisma.${NAME}.create({
      data: {
        id: ${CAMEL}.id,
        name: ${CAMEL}.name,
        email: ${CAMEL}.email,
      },
    });
    return new ${PASCAL}(saved.id, saved.name, saved.email);
  }

  async findById(id: string): Promise<${PASCAL} | null> {
    const found = await this.prisma.${NAME}.findUnique({ where: { id } });
    return found ? new ${PASCAL}(found.id, found.name, found.email) : null;
  }
}
EOF

  REPO_CLASS="${PASCAL}PrismaRepository"
  ENTITY_IMPORT=""
  REPO_PROVIDER="{
      provide: ${REPOSITORY_TOKEN},
      useClass: ${PASCAL}PrismaRepository,
    }"
fi

# ────── Module.ts ──────
IMPORTS="import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ${PASCAL}Controller } from './interfaces/controllers/${NAME}.controller';
import { Create${PASCAL}Handler } from './core/application/commands/create-${NAME}.handler';
import { ${REPOSITORY_TOKEN} } from './core/domain/ports/${NAME}.repository';
import { $REPO_CLASS } from './infrastructure/persistences/repositories/${NAME}.${ORM}.repository';"

if [ "$ORM" = "typeorm" ]; then
  IMPORTS="$IMPORTS
import { TypeOrmModule } from '@nestjs/typeorm';
import { ${PASCAL}Entity } from './infrastructure/persistences/repositories/${NAME}.orm';"
fi

echo "$IMPORTS

@Module({
  imports: [CqrsModule${ENTITY_IMPORT:+, $ENTITY_IMPORT}],
  controllers: [${PASCAL}Controller],
  providers: [
    Create${PASCAL}Handler,
    $REPO_PROVIDER,
  ],
})
export class ${PASCAL}Module {}
" > "$MODULE_DIR/${NAME}.module.ts"

bash "$(dirname "$0")/inject_module_to_app.sh" "$NAME" "$ORM"

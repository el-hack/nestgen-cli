#!/bin/bash

RAW_NAME=$1
ORM=$2

if [ -z "$RAW_NAME" ]; then
  echo "❌ Tu dois passer un nom de module."
  exit 1
fi

if [ -z "$ORM" ]; then
  echo "❌ ORM manquant (typeorm ou prisma)."
  exit 1
fi

# Formatage
NAME=$(echo "$RAW_NAME" | tr '[:upper:]' '[:lower:]')
PASCAL=$(echo "$NAME" | sed -E 's/(^|-)([a-z])/\U\2/g')
CAMEL=$(echo "$PASCAL" | sed -E 's/^([A-Z])/\L\1/')

MODULE_DIR="src/app/$NAME"

mkdir -p "$MODULE_DIR"/{core/{application/{commands,events,queries},domain/{entities,ports}},infrastructure/{adapters,persistences/repositories},interfaces/{controllers,dtos}}

# --- Entity ---
cat > "$MODULE_DIR/core/domain/entities/${NAME}.entity.ts" <<EOF
export class $PASCAL {
  constructor(
    public readonly id: string,
    public name: string,
    public email: string,
  ) {}
}
EOF

# --- Port ---
cat > "$MODULE_DIR/core/domain/ports/${NAME}.repository.ts" <<EOF
import { $PASCAL } from '../entities/${NAME}.entity';

export interface ${PASCAL}RepositoryPort {
  save(${CAMEL}: $PASCAL): Promise<$PASCAL>;
  findById(id: string): Promise<$PASCAL | null>;
}
EOF

# --- Command ---
cat > "$MODULE_DIR/core/application/commands/create-${NAME}.command.ts" <<EOF
export class Create${PASCAL}Command {
  constructor(public readonly name: string, public readonly email: string) {}
}
EOF

# --- Command Handler ---
cat > "$MODULE_DIR/core/application/commands/create-${NAME}.handler.ts" <<EOF
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Create${PASCAL}Command } from './create-${NAME}.command';
import { $PASCAL } from '../../domain/entities/${NAME}.entity';
import { ${PASCAL}RepositoryPort } from '../../domain/ports/${NAME}.repository';

@CommandHandler(Create${PASCAL}Command)
export class Create${PASCAL}Handler implements ICommandHandler<Create${PASCAL}Command> {
  constructor(private readonly repo: ${PASCAL}RepositoryPort) {}

  async execute(command: Create${PASCAL}Command): Promise<string> {
    const $CAMEL = new $PASCAL(Date.now().toString(), command.name, command.email);
    const saved = await this.repo.save($CAMEL);
    return saved.id;
  }
}
EOF

# --- DTO ---
cat > "$MODULE_DIR/interfaces/dtos/create-${NAME}.dto.ts" <<EOF
import { IsEmail, IsString } from 'class-validator';

export class Create${PASCAL}Dto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;
}
EOF

# --- Controller ---
cat > "$MODULE_DIR/interfaces/controllers/${NAME}.controller.ts" <<EOF
import { Controller, Post, Body } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Create${PASCAL}Command } from '../../core/application/commands/create-${NAME}.command';
import { Create${PASCAL}Dto } from '../dtos/create-${NAME}.dto';

@Controller('${NAME}s')
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

# --- Repositories en fonction de l’ORM ---
REPO_CLASS=""
ENTITY_IMPORT=""
REPO_PROVIDER=""

if [ "$ORM" == "typeorm" ]; then
  # TypeORM entity
  cat > "$MODULE_DIR/infrastructure/persistences/repositories/${NAME}.orm.ts" <<EOF
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('${NAME}s')
export class ${PASCAL}Entity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;
}
EOF

  # TypeORM Repository
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
      provide: '${PASCAL}RepositoryPort',
      useClass: ${PASCAL}TypeOrmRepository,
    }"

elif [ "$ORM" == "prisma" ]; then
  # Prisma Repository
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
  ENTITY_IMPORT="" # pas d'import pour Prisma
  REPO_PROVIDER="{
      provide: '${PASCAL}RepositoryPort',
      useClass: ${PASCAL}PrismaRepository,
    }"
fi

# --- Module.ts ---
cat > "$MODULE_DIR/${NAME}.module.ts" <<EOF
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ${PASCAL}Controller } from './interfaces/controllers/${NAME}.controller';
import { Create${PASCAL}Handler } from './core/application/commands/create-${NAME}.handler';
${ORM == "typeorm" && "import { TypeOrmModule } from '@nestjs/typeorm';"}
${ORM == "typeorm" && "import { ${PASCAL}Entity } from './infrastructure/persistences/repositories/${NAME}.orm';"}
import { $REPO_CLASS } from './infrastructure/persistences/repositories/${NAME}.${ORM}.repository';

@Module({
  imports: [CqrsModule${ENTITY_IMPORT:+, $ENTITY_IMPORT}],
  controllers: [${PASCAL}Controller],
  providers: [
    Create${PASCAL}Handler,
    $REPO_CLASS,
    $REPO_PROVIDER,
  ],
})
export class ${PASCAL}Module {}
EOF

# --- Injection dans app.module.ts ---
APP_MODULE="src/app.module.ts"
IMPORT_STATEMENT="import { ${PASCAL}Module } from './app/$NAME/${NAME}.module';"

if ! grep -q "$IMPORT_STATEMENT" "$APP_MODULE"; then
  sed -i '' "1i\\
$IMPORT_STATEMENT
" "$APP_MODULE"

  sed -i '' "s/\(imports: \[\)/\1${PASCAL}Module, /" "$APP_MODULE"

  echo "✅ ${PASCAL}Module ajouté à app.module.ts"
else
  echo "ℹ️  ${PASCAL}Module déjà présent dans app.module.ts"
fi

echo "🎯 Module \"$NAME\" généré avec ORM=$ORM, CQRS, repository & injection 💥"

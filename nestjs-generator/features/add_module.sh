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

mkdir -p $MODULE_DIR/{core/{application/{commands,events,queries},domain/{entities,ports}},infrastructure/{adapters,persistences/repositories},interfaces/{controllers,dtos}}

# --- ENTITIES & PORTS ---
cat > "$MODULE_DIR/core/domain/entities/${NAME}.entity.ts" <<EOF
export class $PASCAL {
  constructor(
    public readonly id: string,
    public name: string,
    public email: string,
  ) {}
}
EOF

cat > "$MODULE_DIR/core/domain/ports/${NAME}.repository.ts" <<EOF
import { $PASCAL } from '../entities/${NAME}.entity';

export interface ${PASCAL}RepositoryPort {
  save(${CAMEL}: $PASCAL): Promise<$PASCAL>;
  findById(id: string): Promise<$PASCAL | null>;
}
EOF

# --- COMMAND + HANDLER ---
cat > "$MODULE_DIR/core/application/commands/create-${NAME}.command.ts" <<EOF
export class Create${PASCAL}Command {
  constructor(public readonly name: string, public readonly email: string) {}
}
EOF

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

# --- DTO & CONTROLLER ---
cat > "$MODULE_DIR/interfaces/dtos/create-${NAME}.dto.ts" <<EOF
import { IsEmail, IsString } from 'class-validator';

export class Create${PASCAL}Dto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;
}
EOF

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

# --- REPOSITORY (TYPEORM) ---
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

# --- MODULE.TS ---
cat > "$MODULE_DIR/${NAME}.module.ts" <<EOF
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ${PASCAL}Entity } from './infrastructure/persistences/repositories/${NAME}.orm';
import { ${PASCAL}TypeOrmRepository } from './infrastructure/persistences/repositories/${NAME}.typeorm.repository';
import { Create${PASCAL}Handler } from './core/application/commands/create-${NAME}.handler';
import { ${PASCAL}Controller } from './interfaces/controllers/${NAME}.controller';

@Module({
  imports: [CqrsModule, TypeOrmModule.forFeature([${PASCAL}Entity])],
  controllers: [${PASCAL}Controller],
  providers: [
    Create${PASCAL}Handler,
    ${PASCAL}TypeOrmRepository,
    {
      provide: '${PASCAL}RepositoryPort',
      useClass: ${PASCAL}TypeOrmRepository,
    },
  ],
})
export class ${PASCAL}Module {}
EOF

# --- INJECTION DANS app.module.ts ---
APP_MODULE_PATH="src/app.module.ts"
MODULE_IMPORT_PATH="./app/$NAME/${NAME}.module"
MODULE_CLASS="${PASCAL}Module"

if grep -q "$MODULE_CLASS" "$APP_MODULE_PATH"; then
  echo "ℹ️  $MODULE_CLASS est déjà importé dans app.module.ts"
else
  sed -i '' "1i\\
import { $MODULE_CLASS } from '$MODULE_IMPORT_PATH';
" "$APP_MODULE_PATH"

  sed -i '' "s/\(imports: \[\)/\1$MODULE_CLASS, /" "$APP_MODULE_PATH"

  echo "✅ $MODULE_CLASS ajouté à app.module.ts"
fi

echo "🎯 Module \"$NAME\" généré avec TypeORM, repository & injection automatique 🧙"

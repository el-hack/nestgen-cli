import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { applyFileChanges } from './file-transaction.js';
import { inspectProject } from './project-preflight.js';
import { availableFeatureDirectory } from './project-path.js';
function describe(rawName) {
    const name = rawName.trim().toLowerCase().replace(/_/g, '-');
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name))
        throw new Error('Nom de module invalide.');
    const pascal = name
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('');
    return {
        name,
        pascal,
        camel: pascal[0].toLowerCase() + pascal.slice(1),
        route: `${name}s`,
        table: `${name.replaceAll('-', '_')}s`,
    };
}
function updateAppModule(source, moduleClass, moduleImport, moduleReference = moduleClass) {
    const file = ts.createSourceFile('app.module.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const appModule = file.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === 'AppModule');
    const decorator = appModule &&
        ts
            .getDecorators(appModule)
            ?.find((candidate) => ts.isCallExpression(candidate.expression) &&
            ts.isIdentifier(candidate.expression.expression) &&
            candidate.expression.expression.text === 'Module');
    if (!decorator ||
        !ts.isCallExpression(decorator.expression) ||
        !ts.isObjectLiteralExpression(decorator.expression.arguments[0]))
        throw new Error('AppModule doit utiliser @Module({ ... }).');
    const metadata = decorator.expression.arguments[0];
    if (metadata.properties.some((property) => ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name))))
        throw new Error('AppModule : les métadonnées avec spread ou clés calculées ne sont pas supportées.');
    const importProperties = metadata.properties.filter((property) => property.name &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === 'imports');
    if (importProperties.length > 1)
        throw new Error('AppModule : propriété imports dupliquée.');
    const imports = importProperties[0] && ts.isPropertyAssignment(importProperties[0]) ? importProperties[0] : undefined;
    if (!imports || !ts.isArrayLiteralExpression(imports.initializer))
        throw new Error('AppModule doit définir imports: [] pour enregistrer un module.');
    if (imports.initializer.elements.some((element) => element.getText(file) === moduleReference))
        return source;
    const importLine = `import { ${moduleClass} } from '${moduleImport}';\n`;
    const prefix = source.includes(`from '${moduleImport}'`) ? '' : importLine;
    const index = imports.initializer.getEnd() - 1 + prefix.length;
    const lastElement = imports.initializer.elements.at(-1);
    const tail = lastElement ? source.slice(lastElement.end, imports.initializer.getEnd() - 1) : '';
    const separator = lastElement && !tail.includes(',') ? ', ' : '';
    const updated = `${prefix}${source}`;
    return `${updated.slice(0, index)}${separator}${moduleReference}${updated.slice(index)}`;
}
/** Registers a generated feature in the project's root Nest module. */
export function registerModuleInAppModule(source, moduleClass, moduleImport, moduleReference = moduleClass) {
    return updateAppModule(source, moduleClass, moduleImport, moduleReference);
}
function updatePrismaSchema(source, resource) {
    const modelPattern = new RegExp(`\\bmodel\\s+${resource.pascal}\\b`);
    if (modelPattern.test(source))
        throw new Error(`Le modèle Prisma ${resource.pascal} existe déjà.`);
    return `${source.trimEnd()}\n\nmodel ${resource.pascal} {\n  id    String @id @default(uuid())\n  name  String\n  email String @unique\n\n  @@map("${resource.table}")\n}\n`;
}
function prismaRuntimeChanges(projectRoot) {
    const prismaDirectory = path.join(projectRoot, 'src', 'prisma');
    const servicePath = path.join(prismaDirectory, 'prisma.service.ts');
    const modulePath = path.join(prismaDirectory, 'prisma.module.ts');
    if (fs.existsSync(servicePath) && fs.existsSync(modulePath))
        return [];
    if (fs.existsSync(servicePath) || fs.existsSync(modulePath))
        throw new Error('Runtime Prisma incomplet.');
    return [
        {
            path: 'src/prisma/prisma.service.ts',
            operation: 'create',
            content: "import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';\nimport { PrismaClient } from '@prisma/client';\n\n@Injectable()\nexport class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {\n    async onModuleInit(): Promise<void> { await this.$connect(); }\n    async onModuleDestroy(): Promise<void> { await this.$disconnect(); }\n}\n",
        },
        {
            path: 'src/prisma/prisma.module.ts',
            operation: 'create',
            content: "import { Global, Module } from '@nestjs/common';\nimport { PrismaService } from './prisma.service';\n\n@Global()\n@Module({ providers: [PrismaService], exports: [PrismaService] })\nexport class PrismaModule {}\n",
        },
    ];
}
function files(resource, orm) {
    const token = `${resource.pascal}RepositoryToken`;
    const result = new Map();
    result.set(`core/domain/entities/${resource.name}.entity.ts`, `export class ${resource.pascal} {\n    constructor(public readonly id: string | undefined, public name: string, public email: string) {}\n}\n`);
    result.set(`core/domain/ports/${resource.name}.repository.ts`, `import { ${resource.pascal} } from '../entities/${resource.name}.entity';\n\nexport const ${token} = Symbol('${resource.pascal}RepositoryPort');\nexport interface ${resource.pascal}RepositoryPort { save(value: ${resource.pascal}): Promise<${resource.pascal}>; findById(id: string): Promise<${resource.pascal} | null>; }\n`);
    result.set(`core/application/commands/create-${resource.name}.command.ts`, `export class Create${resource.pascal}Command { constructor(public readonly name: string, public readonly email: string) {} }\n`);
    result.set(`core/application/commands/create-${resource.name}.handler.ts`, `import { Inject } from '@nestjs/common';\nimport { CommandHandler, ICommandHandler } from '@nestjs/cqrs';\nimport { Create${resource.pascal}Command } from './create-${resource.name}.command';\nimport { ${resource.pascal} } from '../../domain/entities/${resource.name}.entity';\nimport { ${resource.pascal}RepositoryPort, ${token} } from '../../domain/ports/${resource.name}.repository';\n@CommandHandler(Create${resource.pascal}Command)\nexport class Create${resource.pascal}Handler implements ICommandHandler<Create${resource.pascal}Command> { constructor(@Inject(${token}) private readonly repository: ${resource.pascal}RepositoryPort) {} async execute(command: Create${resource.pascal}Command): Promise<string> { return (await this.repository.save(new ${resource.pascal}(undefined, command.name, command.email))).id!; } }\n`);
    result.set(`interfaces/dtos/create-${resource.name}.dto.ts`, `import { IsEmail, IsString } from 'class-validator';\nexport class Create${resource.pascal}Dto { @IsString() name!: string; @IsEmail() email!: string; }\n`);
    result.set(`interfaces/controllers/${resource.name}.controller.ts`, `import { Body, Controller, Post } from '@nestjs/common';\nimport { CommandBus } from '@nestjs/cqrs';\nimport { Create${resource.pascal}Command } from '../../core/application/commands/create-${resource.name}.command';\nimport { Create${resource.pascal}Dto } from '../dtos/create-${resource.name}.dto';\n@Controller('${resource.route}') export class ${resource.pascal}Controller { constructor(private readonly commandBus: CommandBus) {} @Post() async create(@Body() dto: Create${resource.pascal}Dto) { return { id: await this.commandBus.execute(new Create${resource.pascal}Command(dto.name, dto.email)) }; } }\n`);
    if (orm === 'typeorm') {
        result.set(`infrastructure/persistences/repositories/${resource.name}.orm.ts`, `import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';\n@Entity('${resource.table}') export class ${resource.pascal}Entity { @PrimaryGeneratedColumn('uuid') id!: string; @Column() name!: string; @Column({ unique: true }) email!: string; }\n`);
        result.set(`infrastructure/persistences/repositories/${resource.name}.typeorm.repository.ts`, `import { Injectable } from '@nestjs/common';\nimport { InjectRepository } from '@nestjs/typeorm';\nimport { Repository } from 'typeorm';\nimport { ${resource.pascal} } from '../../../core/domain/entities/${resource.name}.entity';\nimport { ${resource.pascal}RepositoryPort } from '../../../core/domain/ports/${resource.name}.repository';\nimport { ${resource.pascal}Entity } from './${resource.name}.orm';\n@Injectable() export class ${resource.pascal}TypeOrmRepository implements ${resource.pascal}RepositoryPort { constructor(@InjectRepository(${resource.pascal}Entity) private readonly repository: Repository<${resource.pascal}Entity>) {} async save(value: ${resource.pascal}) { const saved = await this.repository.save(this.repository.create({ name: value.name, email: value.email })); return new ${resource.pascal}(saved.id, saved.name, saved.email); } async findById(id: string) { const found = await this.repository.findOneBy({ id }); return found ? new ${resource.pascal}(found.id, found.name, found.email) : null; } }\n`);
        result.set(`${resource.name}.module.ts`, `import { Module } from '@nestjs/common';\nimport { CqrsModule } from '@nestjs/cqrs';\nimport { TypeOrmModule } from '@nestjs/typeorm';\nimport { Create${resource.pascal}Handler } from './core/application/commands/create-${resource.name}.handler';\nimport { ${token} } from './core/domain/ports/${resource.name}.repository';\nimport { ${resource.pascal}Entity } from './infrastructure/persistences/repositories/${resource.name}.orm';\nimport { ${resource.pascal}TypeOrmRepository } from './infrastructure/persistences/repositories/${resource.name}.typeorm.repository';\nimport { ${resource.pascal}Controller } from './interfaces/controllers/${resource.name}.controller';\n@Module({ imports: [CqrsModule, TypeOrmModule.forFeature([${resource.pascal}Entity])], controllers: [${resource.pascal}Controller], providers: [Create${resource.pascal}Handler, { provide: ${token}, useClass: ${resource.pascal}TypeOrmRepository }] }) export class ${resource.pascal}Module {}\n`);
    }
    else {
        result.set(`infrastructure/persistences/repositories/${resource.name}.prisma.repository.ts`, `import { Injectable } from '@nestjs/common';\nimport { PrismaService } from '../../../../../prisma/prisma.service';\nimport { ${resource.pascal} } from '../../../core/domain/entities/${resource.name}.entity';\nimport { ${resource.pascal}RepositoryPort } from '../../../core/domain/ports/${resource.name}.repository';\n@Injectable() export class ${resource.pascal}PrismaRepository implements ${resource.pascal}RepositoryPort { constructor(private readonly prisma: PrismaService) {} async save(value: ${resource.pascal}) { const saved = await this.prisma.${resource.camel}.create({ data: { name: value.name, email: value.email } }); return new ${resource.pascal}(saved.id, saved.name, saved.email); } async findById(id: string) { const found = await this.prisma.${resource.camel}.findUnique({ where: { id } }); return found ? new ${resource.pascal}(found.id, found.name, found.email) : null; } }\n`);
        result.set(`${resource.name}.module.ts`, `import { Module } from '@nestjs/common';\nimport { CqrsModule } from '@nestjs/cqrs';\nimport { PrismaModule } from '../../prisma/prisma.module';\nimport { Create${resource.pascal}Handler } from './core/application/commands/create-${resource.name}.handler';\nimport { ${token} } from './core/domain/ports/${resource.name}.repository';\nimport { ${resource.pascal}PrismaRepository } from './infrastructure/persistences/repositories/${resource.name}.prisma.repository';\nimport { ${resource.pascal}Controller } from './interfaces/controllers/${resource.name}.controller';\n@Module({ imports: [CqrsModule, PrismaModule], controllers: [${resource.pascal}Controller], providers: [Create${resource.pascal}Handler, { provide: ${token}, useClass: ${resource.pascal}PrismaRepository }] }) export class ${resource.pascal}Module {}\n`);
    }
    return result;
}
export function generateModule(projectRoot, rawName, orm) {
    if (orm !== 'typeorm' && orm !== 'prisma')
        throw new Error(`ORM non supporté : ${orm}.`);
    const resource = describe(rawName);
    projectRoot = inspectProject(projectRoot, orm).root;
    availableFeatureDirectory(projectRoot, resource.name);
    const appModule = fs.readFileSync(path.join(projectRoot, 'src/app.module.ts'), 'utf8');
    const changes = [...files(resource, orm)].map(([relative, content]) => ({
        path: `src/app/${resource.name}/${relative}`,
        content,
        operation: 'create',
    }));
    changes.push({
        path: 'src/app.module.ts',
        operation: 'replace',
        content: updateAppModule(appModule, `${resource.pascal}Module`, `./app/${resource.name}/${resource.name}.module`),
    });
    if (orm === 'prisma') {
        const schema = fs.readFileSync(path.join(projectRoot, 'prisma/schema.prisma'), 'utf8');
        changes.push({
            path: 'prisma/schema.prisma',
            operation: 'replace',
            content: updatePrismaSchema(schema, resource),
        });
        changes.push(...prismaRuntimeChanges(projectRoot));
    }
    applyFileChanges(projectRoot, changes);
}

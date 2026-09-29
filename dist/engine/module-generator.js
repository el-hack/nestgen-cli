import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
// The legacy preflight is JavaScript while the migration is incremental.
// @ts-expect-error declaration added when preflight moves into this engine.
import { inspectProject } from '../../nestjs-generator/features/preflight.mjs';
const stateFile = '.nestgen-transaction.json';
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
function updateAppModule(source, moduleClass, moduleImport) {
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
    const imports = decorator.expression.arguments[0].properties.find((property) => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'imports');
    if (!imports || !ts.isArrayLiteralExpression(imports.initializer))
        throw new Error('AppModule doit définir imports: [] pour enregistrer un module.');
    if (imports.initializer.elements.some((element) => element.getText(file) === moduleClass))
        return source;
    const importLine = `import { ${moduleClass} } from '${moduleImport}';\n`;
    const prefix = source.includes(`from '${moduleImport}'`) ? '' : importLine;
    const index = imports.initializer.getEnd() - 1 + prefix.length;
    const separator = imports.initializer.elements.length ? ', ' : '';
    const updated = `${prefix}${source}`;
    return `${updated.slice(0, index)}${separator}${moduleClass}${updated.slice(index)}`;
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
        result.set(`infrastructure/persistences/repositories/${resource.name}.prisma.repository.ts`, `import { Injectable } from '@nestjs/common';\nimport { PrismaService } from '@/prisma.service';\nimport { ${resource.pascal} } from '../../../core/domain/entities/${resource.name}.entity';\nimport { ${resource.pascal}RepositoryPort } from '../../../core/domain/ports/${resource.name}.repository';\n@Injectable() export class ${resource.pascal}PrismaRepository implements ${resource.pascal}RepositoryPort { constructor(private readonly prisma: PrismaService) {} async save(value: ${resource.pascal}) { const saved = await this.prisma.${resource.camel}.create({ data: { id: value.id, name: value.name, email: value.email } }); return new ${resource.pascal}(saved.id, saved.name, saved.email); } async findById(id: string) { const found = await this.prisma.${resource.camel}.findUnique({ where: { id } }); return found ? new ${resource.pascal}(found.id, found.name, found.email) : null; } }\n`);
        result.set(`${resource.name}.module.ts`, `import { Module } from '@nestjs/common';\nimport { CqrsModule } from '@nestjs/cqrs';\nimport { Create${resource.pascal}Handler } from './core/application/commands/create-${resource.name}.handler';\nimport { ${token} } from './core/domain/ports/${resource.name}.repository';\nimport { ${resource.pascal}PrismaRepository } from './infrastructure/persistences/repositories/${resource.name}.prisma.repository';\nimport { ${resource.pascal}Controller } from './interfaces/controllers/${resource.name}.controller';\n@Module({ imports: [CqrsModule], controllers: [${resource.pascal}Controller], providers: [Create${resource.pascal}Handler, { provide: ${token}, useClass: ${resource.pascal}PrismaRepository }] }) export class ${resource.pascal}Module {}\n`);
    }
    return result;
}
export function generateModule(projectRoot, rawName, orm) {
    if (orm !== 'typeorm' && orm !== 'prisma')
        throw new Error(`ORM non supporté : ${orm}.`);
    inspectProject(projectRoot, orm);
    const resource = describe(rawName);
    const pending = path.join(projectRoot, stateFile);
    const moduleDirectory = path.join(projectRoot, 'src/app', resource.name);
    const stage = path.join(projectRoot, `.nestgen-stage-${crypto.randomUUID()}`);
    const appModule = path.join(projectRoot, 'src/app.module.ts');
    if (fs.existsSync(pending))
        throw new Error(`Transaction interrompue détectée : ${stateFile}.`);
    if (fs.existsSync(moduleDirectory))
        throw new Error(`Le module ${resource.name} existe déjà.`);
    const state = { status: 'prepared', stage, moduleDirectory, appModule };
    try {
        for (const [relative, content] of files(resource, orm)) {
            const target = path.join(stage, relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
        }
        const updated = updateAppModule(fs.readFileSync(appModule, 'utf8'), `${resource.pascal}Module`, `./app/${resource.name}/${resource.name}.module`);
        fs.writeFileSync(pending, JSON.stringify(state, null, 2));
        fs.mkdirSync(path.dirname(moduleDirectory), { recursive: true });
        fs.renameSync(stage, moduleDirectory);
        state.status = 'module-applied';
        fs.writeFileSync(pending, JSON.stringify(state, null, 2));
        const temporary = `${appModule}.nestgen-${process.pid}`;
        fs.writeFileSync(temporary, updated);
        fs.renameSync(temporary, appModule);
        fs.rmSync(pending);
    }
    catch (error) {
        if (state.status === 'module-applied')
            fs.rmSync(moduleDirectory, { recursive: true, force: true });
        throw error;
    }
    finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }
}

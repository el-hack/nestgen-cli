import fs from 'node:fs';
import { formatGeneratedCode } from './generated-code.js';
import { inspectProject } from './project-preflight.js';
import { availableFeatureDirectory, projectPath } from './project-path.js';
import { applyFileChanges } from './file-transaction.js';
import { parseArchitectureProfile } from './architecture-profile.js';
import { registerModuleInAppModule } from './module-generator.js';
import { typescriptType } from './resource-spec.js';
function pascal(value) {
    return value
        .split('-')
        .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
        .join('');
}
function entityColumn(field) {
    const type = field.type === 'number'
        ? "'double precision'"
        : field.type === 'boolean'
            ? "'boolean'"
            : field.type === 'date'
                ? "'timestamptz'"
                : field.type === 'uuid'
                    ? "'uuid'"
                    : "'varchar'";
    const options = [`type: ${type}`, `nullable: ${field.nullable}`];
    if (field.unique)
        options.push('unique: true');
    return `    @Column({ ${options.join(', ')} })\n    ${field.name}${field.nullable ? '?' : '!'}: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`;
}
function validationDecorators(field, optional) {
    const decorators = field.nullable
        ? ['@IsOptional()']
        : optional
            ? ['@ValidateIf((_object: unknown, value: unknown) => value !== undefined)']
            : ['@IsDefined()'];
    decorators.push(field.type === 'number'
        ? '@IsNumber()'
        : field.type === 'boolean'
            ? '@IsBoolean()'
            : field.type === 'date'
                ? '@IsDateString()'
                : field.type === 'uuid'
                    ? '@IsUUID()'
                    : '@IsString()');
    return decorators;
}
function dtoFields(fields, optional) {
    return fields
        .map((field) => {
        const isOptional = optional || field.nullable;
        const type = field.type === 'date' ? 'string' : typescriptType(field);
        return `${validationDecorators(field, isOptional)
            .map((decorator) => `    ${decorator}`)
            .join('\n')}\n    ${field.name}${isOptional ? '?' : '!'}: ${type}${field.nullable ? ' | null' : ''};`;
    })
        .join('\n\n');
}
function validationImports(fields, optional) {
    const names = fields.flatMap((field) => validationDecorators(field, optional).map((decorator) => decorator.slice(1, decorator.indexOf('('))));
    return [...new Set(names)].sort().join(', ');
}
function propertyMap(fields) {
    return fields
        .map((field) => {
        const value = `input.${field.name}`;
        const converted = field.type === 'date' ? `${value} === null ? null : new Date(${value})` : value;
        return `...(${value} === undefined ? {} : { ${field.name}: ${converted} })`;
    })
        .join(', ');
}
function applicationInputMap(fields, optional) {
    return fields
        .map((field) => {
        const value = `dto.${field.name}`;
        const converted = field.type === 'date' ? `${value} === null ? null : new Date(${value})` : value;
        return optional || field.nullable
            ? `...(${value} === undefined ? {} : { ${field.name}: ${converted} })`
            : `${field.name}: ${converted}`;
    })
        .join(', ');
}
function applicationContractFields(fields, optional) {
    return fields
        .map((field) => `    ${field.name}${optional || field.nullable ? '?' : ''}: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`)
        .join('\n');
}
function applicationContract(name, className, fields) {
    const create = applicationContractFields(fields, false);
    const update = applicationContractFields(fields, true);
    const output = applicationContractFields(fields, false);
    return {
        path: `application/${name}.contract.ts`,
        content: `export interface Create${className}Input {\n${create}\n}\n\n` +
            `export interface Update${className}Input {\n${update}\n}\n\n` +
            `export interface ${className}Output {\n    id: string;\n${output}\n}\n`,
    };
}
function sampleValue(field, transport) {
    if (field.type === 'number')
        return '42';
    if (field.type === 'boolean')
        return 'true';
    if (field.type === 'date')
        return transport ? "'2026-01-02T03:04:05.000Z'" : "new Date('2026-01-02T03:04:05.000Z')";
    if (field.type === 'uuid')
        return "'00000000-0000-4000-8000-000000000123'";
    return `'${field.name}-value'`;
}
function testInput(fields, transport) {
    return fields.map((field) => `${field.name}: ${sampleValue(field, transport)}`).join(', ');
}
function generatedUnitTest(name, className, fields, advanced) {
    const transportInput = testInput(fields, true);
    const applicationInput = testInput(fields, false);
    if (advanced) {
        return {
            path: `${name}.service.spec.ts`,
            content: `import { ConflictException, NotFoundException } from '@nestjs/common';\nimport { ${className}ConflictError, ${className}NotFoundError } from './application/${name}.errors.js';\nimport { ${className}Service } from './application/${name}.service.js';\nimport { ${className}Controller } from './${name}.controller.js';\nimport { ${className} } from './domain/${name}.js';\n\ndescribe('${className} advanced resource', () => {\n    const entity = Object.assign(new ${className}(), { id: '00000000-0000-4000-8000-000000000001', ${applicationInput} });\n    const repository = {\n        create: jest.fn(),\n        findOne: jest.fn(),\n        findMany: jest.fn(),\n        update: jest.fn(),\n        remove: jest.fn(),\n    };\n    const service = new ${className}Service(repository);\n    const controller = new ${className}Controller(service);\n\n    beforeEach(() => jest.resetAllMocks());\n\n    it('returns an application output from a persisted domain entity', async () => {\n        repository.create.mockResolvedValue(entity);\n\n        await expect(service.create({ ${applicationInput} })).resolves.toEqual({ id: entity.id, ${fields.map((field) => `${field.name}: entity.${field.name}`).join(', ')} });\n        expect(repository.create).toHaveBeenCalledWith({ ${applicationInput} });\n    });\n\n    it('maps an application not-found error to HTTP 404', async () => {\n        repository.findOne.mockRejectedValue(new ${className}NotFoundError());\n\n        await expect(controller.get(entity.id)).rejects.toBeInstanceOf(NotFoundException);\n    });\n\n    it('maps an application conflict error to HTTP 409', async () => {\n        repository.create.mockRejectedValue(new ${className}ConflictError());\n\n        await expect(controller.create({ ${transportInput} })).rejects.toBeInstanceOf(ConflictException);\n    });\n});\n`,
        };
    }
    return {
        path: `persistence/${name}.repository.spec.ts`,
        content: `import { ConflictException, NotFoundException } from '@nestjs/common';\nimport { QueryFailedError } from 'typeorm';\nimport { ${className}Repository } from './${name}.repository.js';\n\ndescribe('${className} repository', () => {\n    const input = { ${transportInput} };\n    const entity = { id: '00000000-0000-4000-8000-000000000001', ${applicationInput} };\n    const persistence = {\n        create: jest.fn((value) => value),\n        save: jest.fn(),\n        findOneBy: jest.fn(),\n        find: jest.fn(),\n        preload: jest.fn(),\n        delete: jest.fn(),\n    };\n    const repository = new ${className}Repository(persistence as never);\n\n    beforeEach(() => jest.resetAllMocks());\n\n    it('persists valid input and returns the domain value', async () => {\n        persistence.save.mockResolvedValue(entity);\n\n        await expect(repository.create(input)).resolves.toMatchObject(entity);\n        expect(persistence.create).toHaveBeenCalledWith(expect.objectContaining({ ${applicationInput} }));\n    });\n\n    it('reports an absent resource', async () => {\n        persistence.findOneBy.mockResolvedValue(null);\n\n        await expect(repository.findOne(entity.id)).rejects.toBeInstanceOf(NotFoundException);\n    });\n\n    it('reports a uniqueness conflict from persistence', async () => {\n        const driverError = Object.assign(new Error('duplicate'), { code: '23505' });\n        persistence.save.mockRejectedValue(new QueryFailedError('INSERT', [], driverError));\n\n        await expect(repository.create(input)).rejects.toBeInstanceOf(ConflictException);\n    });\n});\n`,
    };
}
function updatedTestValue(field) {
    if (field.type === 'number')
        return '84';
    if (field.type === 'boolean')
        return 'false';
    if (field.type === 'date')
        return "'2026-02-03T04:05:06.000Z'";
    if (field.type === 'uuid')
        return "'00000000-0000-4000-8000-000000000456'";
    return `'${field.name}-updated'`;
}
function invalidTestValue(field) {
    if (field.type === 'number')
        return "'invalid-number'";
    if (field.type === 'boolean')
        return "'invalid-boolean'";
    if (field.type === 'date')
        return "'invalid-date'";
    if (field.type === 'uuid')
        return "'invalid-uuid'";
    return '42';
}
function generatedRestTest(name, className, fields, route) {
    const input = testInput(fields, true);
    const firstField = fields[0];
    const uniqueField = fields.find((field) => field.unique);
    const update = `${firstField.name}: ${updatedTestValue(firstField)}`;
    const invalid = `${firstField.name}: ${invalidTestValue(firstField)}`;
    const duplicateTest = uniqueField
        ? `\n    it('returns 409 when a unique value already exists', async () => {\n        await api.post('/${route}').send(input).expect(201);\n        await api.post('/${route}').send(input).expect(409);\n    });\n`
        : '';
    return {
        path: `test/${name}.e2e-spec.ts`,
        content: `import 'reflect-metadata';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from '@jest/globals';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';

config({ path: resolve(process.cwd(), 'test/.env.e2e') });

const testDatabase = process.env.DATABASE_TEST_NAME;
if (!testDatabase) throw new Error('DATABASE_TEST_NAME est requis pour les tests E2E.');
if (testDatabase === process.env.DATABASE_NAME)
    throw new Error('DATABASE_TEST_NAME doit être différent de DATABASE_NAME.');
process.env.DATABASE_NAME = testDatabase;

describe('${className} REST', () => {
    let app: INestApplication;
    let database: DataSource;
    let api: ReturnType<typeof request>;
    const input = { ${input} };

    beforeAll(async () => {
        const { AppModule } = await import('../src/app.module.js');
        const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
        await app.init();
        database = app.get(DataSource);
        api = request(app.getHttpServer());
    });

    beforeEach(async () => {
        await database.synchronize(true);
    });

    afterAll(async () => {
        try {
            await database?.dropDatabase();
        } finally {
            await app?.close();
        }
    });

    it('creates, reads, partially updates, paginates and deletes a resource', async () => {
        const created = await api.post('/${route}').send(input).expect(201);
        expect(created.body).toEqual(expect.objectContaining(input));

        const found = await api.get('/${route}/' + created.body.id).expect(200);
        expect(found.body).toEqual(expect.objectContaining(input));
        await api.patch('/${route}/' + created.body.id).send({ ${update} }).expect(200);
        const updated = await api.get('/${route}/' + created.body.id).expect(200);
        expect(updated.body).toEqual(expect.objectContaining({ ...input, ${update} }));
        const listed = await api.get('/${route}?page=1&limit=1').expect(200);
        expect(listed.body).toMatchObject({ page: 1, limit: 1 });
        expect(listed.body.data).toHaveLength(1);
        await api.delete('/${route}/' + created.body.id).expect(204);
        await api.get('/${route}/' + created.body.id).expect(404);
    });

    it('rejects invalid input, malformed UUIDs and missing resources', async () => {
        await api.post('/${route}').send({ ...input, ${invalid} }).expect(400);
        await api.get('/${route}/not-a-uuid').expect(400);
        await api.get('/${route}/00000000-0000-4000-8000-000000000001').expect(404);
    });${duplicateTest}});
`,
    };
}
function e2eSupportFiles(projectRoot) {
    const files = new Map();
    const support = new Map([
        [
            'test/.env.e2e',
            'DATABASE_HOST=127.0.0.1\nDATABASE_PORT=5433\nDATABASE_USER=nestgen\nDATABASE_PASSWORD=nestgen\nDATABASE_TEST_NAME=nestgen_e2e\n',
        ],
        [
            'test/compose.e2e.yaml',
            `services:\n    postgres-e2e:\n        image: postgres:16-alpine\n        environment:\n            POSTGRES_DB: nestgen_e2e\n            POSTGRES_USER: nestgen\n            POSTGRES_PASSWORD: nestgen\n        ports:\n            - '127.0.0.1:5433:5432'\n        healthcheck:\n            test: ['CMD-SHELL', 'pg_isready -U nestgen -d nestgen_e2e']\n            interval: 2s\n            timeout: 3s\n            retries: 30\n`,
        ],
    ]);
    for (const [file, content] of support) {
        if (!fs.existsSync(projectPath(projectRoot, file)))
            files.set(file, content);
    }
    return files;
}
function featureFiles(name, className, fields, route, table, profile) {
    const advanced = profile === 'advanced';
    const entityProperties = fields.map(entityColumn).join('\n\n');
    const fieldAssignments = propertyMap(fields);
    const domainProperties = fields
        .map((field) => `    ${field.name}!: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`)
        .join('\n');
    const files = new Map();
    files.set('domain/' + name + '.ts', `export class ${className} {\n    id!: string;\n${domainProperties}\n}\n`);
    files.set('dto/create-' + name + '.dto.ts', `import { ${validationImports(fields, false)} } from 'class-validator';\n\nexport class Create${className}Dto {\n${dtoFields(fields, false)}\n}\n`);
    files.set('dto/update-' + name + '.dto.ts', `import { ${validationImports(fields, true)} } from 'class-validator';\n\nexport class Update${className}Dto {\n${dtoFields(fields, true)}\n}\n`);
    files.set('dto/list-' + name + '.query.ts', `import { Type } from 'class-transformer';\nimport { IsInt, IsOptional, Max, Min } from 'class-validator';\n\nexport const MAX_PAGE_SIZE = 100;\n\nexport class List${className}Query {\n    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    page = 1;\n\n    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    @Max(MAX_PAGE_SIZE)\n    limit = 20;\n}\n`);
    files.set('persistence/' + name + '.entity.ts', `import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';\n\n@Entity({ name: '${table}' })\nexport class ${className}Entity {\n    @PrimaryGeneratedColumn('uuid')\n    id!: string;\n\n${entityProperties}\n}\n`);
    const persistenceImports = advanced
        ? `import { Injectable } from '@nestjs/common';\nimport { InjectRepository } from '@nestjs/typeorm';\nimport { QueryFailedError, Repository } from 'typeorm';\nimport { Create${className}Input, Update${className}Input } from '../application/${name}.contract.js';\nimport { ${className}ConflictError, ${className}NotFoundError } from '../application/${name}.errors.js';\nimport { ${className}RepositoryPort } from '../application/ports/${name}.repository.port.js';\nimport { ${className} } from '../domain/${name}.js';\n`
        : `import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';\nimport { InjectRepository } from '@nestjs/typeorm';\nimport { QueryFailedError, Repository } from 'typeorm';\nimport { Create${className}Dto } from '../dto/create-${name}.dto.js';\nimport { Update${className}Dto } from '../dto/update-${name}.dto.js';\nimport { ${className} } from '../domain/${name}.js';\n`;
    const persistenceInputTypes = advanced ? `Create${className}Input` : `Create${className}Dto`;
    const persistenceUpdateTypes = advanced ? `Update${className}Input` : `Update${className}Dto`;
    const missingError = advanced
        ? `new ${className}NotFoundError('${className} introuvable')`
        : `new NotFoundException('${className} introuvable')`;
    const conflictError = advanced
        ? `new ${className}ConflictError('Une ressource avec cette valeur unique existe déjà.')`
        : `new ConflictException('Une ressource avec cette valeur unique existe déjà.')`;
    files.set('persistence/' + name + '.repository.ts', `${persistenceImports}import { ${className}Entity } from './${name}.entity.js';\n\n@Injectable()\nexport class ${className}Repository${advanced ? ` implements ${className}RepositoryPort` : ''} {\n    constructor(@InjectRepository(${className}Entity) private readonly repository: Repository<${className}Entity>) {}\n\n    async create(input: ${persistenceInputTypes}): Promise<${className}> {\n        try {\n            return this.toDomain(await this.repository.save(this.repository.create({ ${fieldAssignments} })));\n        } catch (error) {\n            this.rethrowPersistenceError(error);\n        }\n    }\n\n    async findOne(id: string): Promise<${className}> {\n        const value = await this.repository.findOneBy({ id });\n        if (!value) throw ${missingError};\n        return this.toDomain(value);\n    }\n\n    async findMany(skip: number, take: number): Promise<${className}[]> {\n        return (await this.repository.find({ skip, take, order: { id: 'ASC' } })).map((value) => this.toDomain(value));\n    }\n\n    async update(id: string, input: ${persistenceUpdateTypes}): Promise<${className}> {\n        const existing = await this.repository.preload({ id, ${fieldAssignments} });\n        if (!existing) throw ${missingError};\n        try {\n            return this.toDomain(await this.repository.save(existing));\n        } catch (error) {\n            this.rethrowPersistenceError(error);\n        }\n    }\n\n    async remove(id: string): Promise<void> {\n        const result = await this.repository.delete(id);\n        if (!result.affected) throw ${missingError};\n    }\n\n    private toDomain(value: ${className}Entity): ${className} {\n        return Object.assign(new ${className}(), value);\n    }\n\n    private rethrowPersistenceError(error: unknown): never {\n        if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505')\n            throw ${conflictError};\n        throw error;\n    }\n}\n`);
    if (advanced) {
        const contract = applicationContract(name, className, fields);
        files.set(contract.path, contract.content);
        files.set(`application/${name}.errors.ts`, `export class ${className}NotFoundError extends Error {\n    constructor(message = '${className} introuvable') {\n        super(message);\n        this.name = '${className}NotFoundError';\n    }\n}\n\nexport class ${className}ConflictError extends Error {\n    constructor(message = 'Une ressource avec cette valeur unique existe déjà.') {\n        super(message);\n        this.name = '${className}ConflictError';\n    }\n}\n`);
        files.set(`application/ports/${name}.repository.port.ts`, `import { Create${className}Input, Update${className}Input } from '../${name}.contract.js';\nimport { ${className} } from '../../domain/${name}.js';\n\nexport const ${className}RepositoryToken = Symbol('${className}RepositoryPort');\n\nexport interface ${className}RepositoryPort {\n    create(input: Create${className}Input): Promise<${className}>;\n    findOne(id: string): Promise<${className}>;\n    findMany(skip: number, take: number): Promise<${className}[]>;\n    update(id: string, input: Update${className}Input): Promise<${className}>;\n    remove(id: string): Promise<void>;\n}\n`);
        files.set(`application/${name}.service.ts`, `import { Create${className}Input, ${className}Output, Update${className}Input } from './${name}.contract.js';\nimport { ${className}RepositoryPort } from './ports/${name}.repository.port.js';\nimport { ${className} } from '../domain/${name}.js';\n\nexport class ${className}Service {\n    constructor(private readonly repository: ${className}RepositoryPort) {}\n\n    async create(input: Create${className}Input): Promise<${className}Output> {\n        return this.toOutput(await this.repository.create(input));\n    }\n\n    async findOne(id: string): Promise<${className}Output> {\n        return this.toOutput(await this.repository.findOne(id));\n    }\n\n    async findMany(skip: number, take: number): Promise<${className}Output[]> {\n        return (await this.repository.findMany(skip, take)).map((value) => this.toOutput(value));\n    }\n\n    async update(id: string, input: Update${className}Input): Promise<${className}Output> {\n        return this.toOutput(await this.repository.update(id, input));\n    }\n\n    remove(id: string): Promise<void> {\n        return this.repository.remove(id);\n    }\n\n    private toOutput(value: ${className}): ${className}Output {\n        return { id: value.id, ${fields.map((field) => `${field.name}: value.${field.name}`).join(', ')} };\n    }\n}\n`);
    }
    const controllerImports = advanced
        ? `import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';\nimport { ${className}ConflictError, ${className}NotFoundError } from './application/${name}.errors.js';\nimport { ${className}Service } from './application/${name}.service.js';\n`
        : `import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';\nimport { ${className}Repository } from './persistence/${name}.repository.js';\n`;
    const controllerTarget = advanced ? 'service' : 'repository';
    const controllerType = advanced ? `${className}Service` : `${className}Repository`;
    const createArgument = advanced ? `{ ${applicationInputMap(fields, false)} }` : 'dto';
    const updateArgument = advanced ? `{ ${applicationInputMap(fields, true)} }` : 'dto';
    const errorBoundary = advanced
        ? `\n    private async respond<T>(operation: Promise<T>): Promise<T> {\n        try {\n            return await operation;\n        } catch (error) {\n            if (error instanceof ${className}NotFoundError) throw new NotFoundException(error.message);\n            if (error instanceof ${className}ConflictError) throw new ConflictException(error.message);\n            throw error;\n        }\n    }\n`
        : '';
    files.set(name + '.controller.ts', `${controllerImports}import { Create${className}Dto } from './dto/create-${name}.dto.js';\nimport { List${className}Query } from './dto/list-${name}.query.js';\nimport { Update${className}Dto } from './dto/update-${name}.dto.js';\n\n@Controller('${route}')\nexport class ${className}Controller {\n    constructor(private readonly ${controllerTarget}: ${controllerType}) {}\n\n    @Post()\n    create(@Body() dto: Create${className}Dto) { return ${advanced ? 'this.respond(' : ''}this.${controllerTarget}.create(${createArgument})${advanced ? ')' : ''}; }\n\n    @Get()\n    async list(@Query() query: List${className}Query) {\n        const skip = (query.page - 1) * query.limit;\n        return { page: query.page, limit: query.limit, data: await ${advanced ? 'this.respond(' : ''}this.${controllerTarget}.findMany(skip, query.limit)${advanced ? ')' : ''} };\n    }\n\n    @Get(':id')\n    get(@Param('id', new ParseUUIDPipe()) id: string) { return ${advanced ? 'this.respond(' : ''}this.${controllerTarget}.findOne(id)${advanced ? ')' : ''}; }\n\n    @Patch(':id')\n    update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: Update${className}Dto) { return ${advanced ? 'this.respond(' : ''}this.${controllerTarget}.update(id, ${updateArgument})${advanced ? ')' : ''}; }\n\n    @Delete(':id')\n    @HttpCode(204)\n    async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> { await ${advanced ? 'this.respond(' : ''}this.${controllerTarget}.remove(id)${advanced ? ')' : ''}; }${errorBoundary}}\n`);
    files.set(name + '.module.ts', `import { Module } from '@nestjs/common';\nimport { TypeOrmModule } from '@nestjs/typeorm';\nimport { ${className}Controller } from './${name}.controller.js';\n${advanced ? `import { ${className}Service } from './application/${name}.service.js';\nimport { ${className}RepositoryToken } from './application/ports/${name}.repository.port.js';\n` : ''}import { ${className}Entity } from './persistence/${name}.entity.js';\nimport { ${className}Repository } from './persistence/${name}.repository.js';\n\n@Module({\n    imports: [TypeOrmModule.forFeature([${className}Entity])],\n    controllers: [${className}Controller],\n    providers: [${className}Repository${advanced ? `, { provide: ${className}RepositoryToken, useExisting: ${className}Repository }, { provide: ${className}Service, useFactory: (repository: ${className}Repository) => new ${className}Service(repository), inject: [${className}RepositoryToken] }` : ''}],\n})\nexport class ${className}Module {}\n`);
    const unitTest = generatedUnitTest(name, className, fields, advanced);
    const unitTestContent = unitTest.content
        .replaceAll('jest.fn(),', 'jest.fn<() => Promise<unknown>>(),')
        .replaceAll('jest.fn((value) => value)', 'jest.fn((value: unknown) => value)')
        .replace(`new ${className}Service(repository)`, `new ${className}Service(repository as never)`)
        .replaceAll('beforeEach(() => jest.resetAllMocks());', 'beforeEach(() => { jest.resetAllMocks(); });');
    files.set(unitTest.path, "import { beforeEach, describe, expect, it, jest } from '@jest/globals';\n" + unitTestContent);
    return files;
}
export async function generateResource(projectRoot, options) {
    const profile = parseArchitectureProfile(options.profile);
    const orm = options.orm ?? 'typeorm';
    if (orm !== 'typeorm')
        throw new Error('La commande resource prend actuellement en charge TypeORM uniquement.');
    const name = options.name.trim().toLowerCase().replaceAll('_', '-');
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name))
        throw new Error('Nom de ressource invalide.');
    const className = pascal(name);
    const project = inspectProject(projectRoot, orm, { cqrs: false });
    projectRoot = project.root;
    availableFeatureDirectory(projectRoot, name);
    const appModulePath = project.appModulePath;
    const files = featureFiles(name, className, options.fields, options.route, options.table, profile);
    const restTest = generatedRestTest(name, className, options.fields, options.route);
    const e2eSupport = e2eSupportFiles(projectRoot);
    const appModule = registerModuleInAppModule(fs.readFileSync(appModulePath, 'utf8'), `${className}Module`, `./app/${name}/${name}.module.js`, `${className}Module`);
    const changes = [...files].map(([relative, content]) => ({
        path: `src/app/${name}/${relative}`,
        content,
        operation: 'create',
    }));
    changes.push({ path: restTest.path, content: restTest.content, operation: 'create' });
    changes.push(...[...e2eSupport].map(([file, content]) => ({ path: file, content, operation: 'create' })));
    changes.push({
        path: `src/app/${name}/resource.json`,
        content: `${JSON.stringify({ name, route: options.route, table: options.table, orm, profile, fields: options.fields }, null, 2)}\n`,
        operation: 'create',
    });
    changes.push({ path: 'src/app.module.ts', content: appModule, operation: 'replace' });
    applyFileChanges(projectRoot, await formatGeneratedCode(projectRoot, changes));
}

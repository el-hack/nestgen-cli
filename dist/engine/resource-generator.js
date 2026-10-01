import fs from 'node:fs';
import { formatGeneratedCode } from './generated-code.js';
import { inspectProject } from './project-preflight.js';
import { projectPath } from './project-path.js';
import { resourceGenerationDefinition, withGenerationManifest } from './generation-manifest.js';
import { applyFileChanges, previewFileChanges } from './file-transaction.js';
import { parseArchitectureProfile } from './architecture-profile.js';
import { registerModuleInAppModule } from './module-generator.js';
import { prismaType, typescriptType, } from './resource-spec.js';
function pascal(value) {
    return value
        .split('-')
        .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
        .join('');
}
function camel(value) {
    const parts = value.split('-');
    return (parts[0] +
        parts
            .slice(1)
            .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
            .join(''));
}
function plural(value) {
    if (/[^aeiou]y$/i.test(value))
        return `${value.slice(0, -1)}ies`;
    if (/(s|x|z|ch|sh)$/i.test(value))
        return `${value}es`;
    return `${value}s`;
}
function relationField(relation) {
    return relation.field ?? (relation.type === 'manyToMany' ? plural(camel(relation.target)) : camel(relation.target));
}
function relationIdField(relation) {
    return `${relationField(relation)}Id`;
}
function relationName(relation, className) {
    return `${relation.targetClassName}${className}${pascal(relation.field)}`;
}
function joinTableName(table, relation) {
    const value = `join_${table}_${relation.targetTable}_${relation.field}`;
    return value.length <= 63 ? value : `${value.slice(0, 54)}_${stableSuffix(value)}`;
}
function resolveRelations(projectRoot, sourceRoot, name, orm, fields, relations) {
    const knownFields = new Set(fields.map((field) => field.name));
    const resolved = (relations ?? []).map((relation) => {
        if (relation.target === name)
            throw new Error('Une ressource ne peut pas se référencer elle-même avec une relation générée.');
        const field = relationField(relation);
        if (relation.type === 'belongsTo') {
            const idField = relationIdField(relation);
            if (knownFields.has(idField))
                throw new Error(`Le champ ${idField} est réservé à la relation vers ${relation.target}.`);
            knownFields.add(idField);
        }
        const resourcePath = projectPath(projectRoot, `${sourceRoot}/app/${relation.target}/resource.json`);
        if (!fs.existsSync(resourcePath))
            throw new Error(`La ressource cible ${relation.target} est introuvable. Générez-la avant la relation.`);
        let target;
        try {
            target = JSON.parse(fs.readFileSync(resourcePath, 'utf8'));
        }
        catch {
            throw new Error(`Le manifeste de la ressource cible ${relation.target} est invalide.`);
        }
        if (!target || typeof target !== 'object' || target.orm !== orm)
            throw new Error(`La ressource cible ${relation.target} doit utiliser l'ORM ${orm}.`);
        const manifest = target;
        if (!Array.isArray(manifest.fields) || typeof manifest.route !== 'string' || typeof manifest.table !== 'string')
            throw new Error(`Le manifeste de la ressource cible ${relation.target} est incomplet.`);
        return {
            ...relation,
            field,
            inverse: relation.inverse ?? plural(camel(name)),
            nullable: relation.nullable,
            onDelete: relation.onDelete,
            targetClassName: pascal(relation.target),
            targetFields: manifest.fields,
            targetRoute: manifest.route,
            targetTable: manifest.table,
        };
    });
    if (new Set(resolved.map((relation) => relationField(relation))).size !== resolved.length)
        throw new Error('Chaque relation doit utiliser un champ distinct.');
    if (new Set(resolved.map((relation) => `${relation.target}:${relation.inverse}`)).size !== resolved.length)
        throw new Error('Chaque relation vers une même ressource cible doit utiliser une propriété inverse distincte.');
    return resolved;
}
function relationFields(relations) {
    return relations
        .filter((relation) => relation.type === 'belongsTo')
        .map((relation) => ({
        name: relationIdField(relation),
        type: 'uuid',
        nullable: relation.nullable,
        unique: false,
        indexed: true,
    }));
}
function relationManifest(relations) {
    return relations.map(({ type, target, field, inverse, nullable, onDelete }) => ({
        type,
        target,
        field,
        inverse,
        nullable,
        onDelete,
    }));
}
function enumName(className, field) {
    return `${className}${pascal(field.name)}`;
}
function enumValues(field) {
    return field.enumValues.map((value) => `'${value}'`).join(', ');
}
function stableSuffix(value) {
    let hash = 2166136261;
    for (const character of value)
        hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
}
function indexName(table, fields) {
    const value = `idx_${table}_${fields.join('_')}`;
    return value.length <= 63 ? value : `${value.slice(0, 54)}_${stableSuffix(value)}`;
}
function uniqueIndexName(table, fields) {
    const value = `uq_${table}_${fields.join('_')}`;
    return value.length <= 63 ? value : `${value.slice(0, 54)}_${stableSuffix(value)}`;
}
function resolvedIndexes(fields, indexes) {
    const resolved = [
        ...fields.filter((field) => field.indexed).map((field) => ({ fields: [field.name] })),
        ...(indexes ?? []),
    ];
    const seen = new Set();
    return resolved.filter((index) => {
        const key = index.fields.join('+');
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function defaultLiteral(field) {
    if (typeof field.defaultValue === 'string')
        return `'${field.defaultValue.replaceAll("'", "''")}'`;
    return String(field.defaultValue);
}
function prismaDefault(field) {
    if (field.defaultValue === undefined)
        return '';
    if (field.type === 'string')
        return ` @default(${JSON.stringify(field.defaultValue)})`;
    if (field.type === 'enum')
        return ` @default(${field.defaultValue})`;
    return ` @default(${field.defaultValue})`;
}
function entityColumn(field, className) {
    const type = field.type === 'number'
        ? "'double precision'"
        : field.type === 'integer'
            ? "'integer'"
            : field.type === 'decimal'
                ? "'numeric'"
                : field.type === 'enum'
                    ? "'enum'"
                    : field.type === 'boolean'
                        ? "'boolean'"
                        : field.type === 'date'
                            ? "'timestamptz'"
                            : field.type === 'uuid'
                                ? "'uuid'"
                                : "'varchar'";
    const options = [`type: ${type}`, `nullable: ${field.nullable}`];
    if (field.type === 'decimal')
        options.push(`precision: ${field.precision}`, `scale: ${field.scale}`);
    if (field.type === 'enum')
        options.push(`enum: [${enumValues(field)}]`, `enumName: '${enumName(className, field)}'`);
    if (field.length !== undefined)
        options.push(`length: ${field.length}`);
    if (field.defaultValue !== undefined)
        options.push(`default: ${defaultLiteral(field)}`);
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
        : field.type === 'integer'
            ? '@IsInt()'
            : field.type === 'decimal'
                ? `@IsDecimal({ decimal_digits: '1,${field.scale}', force_decimal: false })`
                : field.type === 'enum'
                    ? `@IsIn([${enumValues(field)}])`
                    : field.type === 'boolean'
                        ? '@IsBoolean()'
                        : field.type === 'date'
                            ? '@IsDateString()'
                            : field.type === 'uuid'
                                ? '@IsUUID()'
                                : '@IsString()');
    if (field.length !== undefined)
        decorators.push(`@MaxLength(${field.length})`);
    if (field.min !== undefined)
        decorators.push(`@Min(${field.min})`);
    if (field.max !== undefined)
        decorators.push(`@Max(${field.max})`);
    return decorators;
}
function swaggerType(field) {
    return field.type === 'number' || field.type === 'integer'
        ? 'Number'
        : field.type === 'boolean'
            ? 'Boolean'
            : 'String';
}
function swaggerProperty(field, optional) {
    const required = !optional && !field.nullable;
    const options = [`type: ${swaggerType(field)}`, `required: ${required}`, `example: ${sampleValue(field, true)}`];
    if (field.nullable)
        options.push('nullable: true');
    if (field.type === 'date')
        options.push("format: 'date-time'");
    if (field.type === 'uuid')
        options.push("format: 'uuid'");
    if (field.type === 'integer')
        options.push("format: 'int32'");
    if (field.type === 'decimal')
        options.push("format: 'decimal'", "description: 'Nombre décimal transmis sous forme de chaîne pour préserver sa précision.'");
    if (field.type === 'enum')
        options.push(`enum: [${enumValues(field)}]`);
    if (field.length !== undefined)
        options.push(`maxLength: ${field.length}`);
    if (field.min !== undefined)
        options.push(`minimum: ${field.min}`);
    if (field.max !== undefined)
        options.push(`maximum: ${field.max}`);
    if (field.defaultValue !== undefined)
        options.push(`default: ${defaultLiteral(field)}`);
    if (field.unique)
        options.push("description: 'Valeur unique.'");
    return `@${required ? 'ApiProperty' : 'ApiPropertyOptional'}({ ${options.join(', ')} })`;
}
function swaggerImports(fields, optional) {
    const decorators = new Set(fields.map((field) => (!optional && !field.nullable ? 'ApiProperty' : 'ApiPropertyOptional')));
    return [...decorators].sort().join(', ');
}
function dtoFields(fields, optional, swagger = false) {
    return fields
        .map((field) => {
        const isOptional = optional || field.nullable || field.defaultValue !== undefined;
        const type = field.type === 'date' ? 'string' : typescriptType(field);
        return `${swagger ? `    ${swaggerProperty(field, isOptional)}\n` : ''}${validationDecorators(field, isOptional)
            .map((decorator) => `    ${decorator}`)
            .join('\n')}\n    ${field.name}${isOptional ? '?' : '!'}: ${type}${field.nullable ? ' | null' : ''};`;
    })
        .join('\n\n');
}
function validationImports(fields, optional) {
    const names = fields.flatMap((field) => validationDecorators(field, optional || field.defaultValue !== undefined).map((decorator) => decorator.slice(1, decorator.indexOf('('))));
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
        .map((field) => `    ${field.name}${optional || field.nullable || field.defaultValue !== undefined ? '?' : ''}: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`)
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
    if (field.type === 'integer')
        return '42';
    if (field.type === 'decimal')
        return `'123${field.scale ? `.${'4'.repeat(field.scale)}` : ''}'`;
    if (field.type === 'enum')
        return `'${field.enumValues[0]}'`;
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
    if (field.type === 'integer')
        return '84';
    if (field.type === 'decimal')
        return `'456${field.scale ? `.${'5'.repeat(field.scale)}` : ''}'`;
    if (field.type === 'enum')
        return `'${field.enumValues[1] ?? field.enumValues[0]}'`;
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
    if (field.type === 'integer')
        return "'invalid-integer'";
    if (field.type === 'decimal')
        return "'invalid-decimal'";
    if (field.type === 'enum')
        return "'INVALID_ENUM_VALUE'";
    if (field.type === 'boolean')
        return "'invalid-boolean'";
    if (field.type === 'date')
        return "'invalid-date'";
    if (field.type === 'uuid')
        return "'invalid-uuid'";
    return '42';
}
function generatedRestTest(name, className, fields, route, relations, sourceRoot) {
    const input = testInput(fields, true);
    const firstField = fields[0];
    const uniqueField = fields.find((field) => field.unique);
    const update = `${firstField.name}: ${updatedTestValue(firstField)}`;
    const invalid = `${firstField.name}: ${invalidTestValue(firstField)}`;
    const relationSetup = [...new Map(relations.map((relation) => [relation.target, relation])).values()]
        .map((relation) => `        const ${relation.field}Target = await api.post('/${relation.targetRoute}').send({ ${testInput(relation.targetFields, true)} }).expect(201);\n${relations
        .filter((candidate) => candidate.target === relation.target)
        .map((candidate) => `        input.${relationIdField(candidate)} = ${relation.field}Target.body.id;`)
        .join('\n')}`)
        .join('\n');
    const duplicateTest = uniqueField
        ? `\n    it('returns 409 when a unique value already exists', async () => {\n${relationSetup ? `${relationSetup}\n` : ''}        await api.post('/${route}').send(input).expect(201);\n        await api.post('/${route}').send(input).expect(409);\n    });\n`
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
    const input: Record<string, unknown> = { ${input} };

    beforeAll(async () => {
        const { AppModule } = await import('../${sourceRoot}/app.module.js');
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
${relationSetup ? `${relationSetup}\n` : ''}        const created = await api.post('/${route}').send(input).expect(201);
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
function prismaModelFields(className, fields) {
    return fields
        .map((field) => {
        if (field.type === 'enum')
            return `  ${field.name} ${enumName(className, field)}${field.nullable ? '?' : ''}${field.unique ? ' @unique' : ''}${prismaDefault(field)}`;
        if (field.type === 'decimal')
            return `  ${field.name} ${prismaType({ ...field, nullable: false, unique: false })}${field.nullable ? '?' : ''} @db.Decimal(${field.precision}, ${field.scale})${field.unique ? ' @unique' : ''}${prismaDefault(field)}`;
        return `  ${field.name} ${prismaType(field)}${prismaDefault(field)}`;
    })
        .join('\n');
}
function updatePrismaModel(source, className, property, propertyName) {
    const model = new RegExp(`(model\\s+${className}\\s*\\{)([\\s\\S]*?)(\\n\\})`);
    const match = model.exec(source);
    if (!match)
        throw new Error(`Le modèle Prisma cible ${className} est introuvable.`);
    if (new RegExp(`\\b${propertyName}\\b`).test(match[2]))
        throw new Error(`La propriété Prisma ${propertyName} existe déjà sur ${className}.`);
    const insertion = match[2].includes('\n  @@')
        ? match[2].replace(/\n(  @@)/, `\n  ${property}\n\n$1`)
        : `${match[2]}\n  ${property}`;
    return `${source.slice(0, match.index)}${match[1]}${insertion}${match[3]}${source.slice(match.index + match[0].length)}`;
}
function addPrismaInverseRelations(source, className, relations) {
    return relations.reduce((current, relation) => updatePrismaModel(current, relation.targetClassName, `${relation.inverse} ${className}[] @relation("${relationName(relation, className)}")`, relation.inverse), source);
}
function prismaSchema(source, className, table, fields, indexes, relations) {
    if (new RegExp(`\\bmodel\\s+${className}\\b`).test(source))
        throw new Error(`Le modèle Prisma ${className} existe déjà.`);
    const definitions = fields
        .filter((field) => field.type === 'enum')
        .map((field) => {
        const name = enumName(className, field);
        if (new RegExp(`\\benum\\s+${name}\\b`).test(source))
            throw new Error(`L'enum Prisma ${name} existe déjà.`);
        return `enum ${name} {\n${field.enumValues.map((value) => `  ${value}`).join('\n')}\n}`;
    });
    const indexDefinitions = indexes
        .map((index) => index.unique
        ? `  @@unique([${index.fields.join(', ')}], map: "${uniqueIndexName(table, index.fields)}")`
        : `  @@index([${index.fields.join(', ')}], map: "${indexName(table, index.fields)}")`)
        .join('\n');
    const withInverses = addPrismaInverseRelations(source, className, relations);
    const relationProperties = relations
        .map((relation) => relation.type === 'manyToMany'
        ? `  ${relation.field} ${relation.targetClassName}[] @relation("${relationName(relation, className)}")`
        : `  ${relation.field} ${relation.targetClassName}${relation.nullable ? '?' : ''} @relation("${relationName(relation, className)}", fields: [${relationIdField(relation)}], references: [id], onDelete: ${relation.onDelete === 'SET NULL' ? 'SetNull' : 'Restrict'})`)
        .join('\n');
    return `${withInverses.trimEnd()}${definitions.length ? `\n\n${definitions.join('\n\n')}` : ''}\n\nmodel ${className} {\n  id String @id @default(uuid())\n${prismaModelFields(className, fields)}${relationProperties ? `\n${relationProperties}` : ''}${indexDefinitions ? `\n\n${indexDefinitions}` : ''}\n\n  @@map("${table}")\n}\n`;
}
function prismaRuntime(projectRoot, sourceRoot) {
    const service = projectPath(projectRoot, `${sourceRoot}/prisma/prisma.service.ts`);
    const module = projectPath(projectRoot, `${sourceRoot}/prisma/prisma.module.ts`);
    if (fs.existsSync(service) && fs.existsSync(module))
        return [];
    if (fs.existsSync(service) || fs.existsSync(module))
        throw new Error('Runtime Prisma incomplet.');
    return [
        {
            path: `${sourceRoot}/prisma/prisma.service.ts`,
            operation: 'create',
            content: "import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';\nimport { PrismaClient } from '@prisma/client';\n\n@Injectable()\nexport class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {\n    async onModuleInit(): Promise<void> { await this.$connect(); }\n    async onModuleDestroy(): Promise<void> { await this.$disconnect(); }\n}\n",
        },
        {
            path: `${sourceRoot}/prisma/prisma.module.ts`,
            operation: 'create',
            content: "import { Global, Module } from '@nestjs/common';\nimport { PrismaService } from './prisma.service.js';\n\n@Global()\n@Module({ providers: [PrismaService], exports: [PrismaService] })\nexport class PrismaModule {}\n",
        },
    ];
}
function queryProperty(field, operator) {
    return operator === 'eq' ? field : `${field}${pascal(operator)}`;
}
function listFilterDecorators(field) {
    if (field.type === 'number')
        return '    @Type(() => Number)\n    @IsNumber()';
    if (field.type === 'integer')
        return '    @Type(() => Number)\n    @IsInt()';
    if (field.type === 'boolean')
        return "    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))\n    @IsBoolean()";
    if (field.type === 'date')
        return '    @Type(() => Date)\n    @IsDate()';
    return '    @IsString()';
}
function listQueryDto(className, list, fields) {
    const fieldsByName = new Map(fields.map((field) => [field.name, field]));
    const filterFields = Object.keys(list.filters).map((name) => fieldsByName.get(name));
    const filters = Object.entries(list.filters)
        .flatMap(([name, operators]) => operators.map((operator) => ({ field: fieldsByName.get(name), property: queryProperty(name, operator) })))
        .map(({ field, property }) => `    @IsOptional()\n${listFilterDecorators(field)}\n    ${property}?: ${typescriptType(field)};`)
        .join('\n\n');
    const validators = new Set(['IsInt', 'IsOptional', 'Max', 'Min']);
    if (filterFields.some((field) => !['number', 'integer', 'boolean', 'date'].includes(field.type)) ||
        list.search.length ||
        list.sort.length)
        validators.add('IsString');
    if (filterFields.some((field) => field.type === 'number'))
        validators.add('IsNumber');
    if (filterFields.some((field) => field.type === 'boolean'))
        validators.add('IsBoolean');
    if (filterFields.some((field) => field.type === 'date'))
        validators.add('IsDate');
    const usesTransform = filterFields.some((field) => field.type === 'boolean');
    return `import { ${usesTransform ? 'Transform, ' : ''}Type } from 'class-transformer';\nimport { ${[...validators].sort().join(', ')} } from 'class-validator';\n\nexport const MAX_PAGE_SIZE = 100;\n\nexport class List${className}Query {\n    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    page = 1;\n\n    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    @Max(MAX_PAGE_SIZE)\n    limit = 20;${filters ? `\n\n${filters}` : ''}${list.search.length ? `\n\n    @IsOptional()\n    @IsString()\n    q?: string;` : ''}${list.sort.length ? `\n\n    @IsOptional()\n    @IsString()\n    sort?: string;` : ''}${list.cursor ? `\n\n    @IsOptional()\n    @IsString()\n    after?: string;` : ''}\n}\n`;
}
function cursorHelpers() {
    return `    private decodeCursor(value: string): string {\n        try {\n            const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { id?: unknown };\n            if (typeof cursor.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id)) throw new Error();\n            return cursor.id;\n        } catch {\n            throw new BadRequestException('Curseur invalide.');\n        }\n    }\n\n    private encodeCursor(id: string): string {\n        return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');\n    }`;
}
function typeOrmListMethod(className, name, list) {
    const filters = Object.entries(list.filters)
        .flatMap(([field, operators]) => operators.map((operator) => {
        const property = queryProperty(field, operator);
        const comparison = operator === 'eq'
            ? '='
            : operator === 'neq'
                ? '!='
                : operator === 'gt'
                    ? '>'
                    : operator === 'gte'
                        ? '>='
                        : operator === 'lt'
                            ? '<'
                            : '<=';
        if (operator === 'contains')
            return `        if (query.${property} !== undefined) builder.andWhere('${name}.${field} ILIKE :${property}', { ${property}: \`%\${query.${property}}%\` });`;
        return `        if (query.${property} !== undefined) builder.andWhere('${name}.${field} ${comparison} :${property}', { ${property}: query.${property} });`;
    }))
        .join('\n');
    const search = list.search.length
        ? `        if (query.q !== undefined) builder.andWhere('(${list.search.map((field) => `${name}.${field} ILIKE :q`).join(' OR ')})', { q: \`%\${query.q}%\` });\n`
        : '';
    const sort = list.sort.length
        ? `        const sortParts = (query.sort ?? 'id:asc').split(':');\n        const [field, direction = 'asc'] = sortParts;\n        if (sortParts.length > 2 || !${JSON.stringify(['id', ...list.sort])}.includes(field) || !['asc', 'desc'].includes(direction.toLowerCase())) throw new BadRequestException('Tri invalide.');\n        builder.orderBy('${name}.' + field, direction.toUpperCase() as 'ASC' | 'DESC');\n`
        : `        builder.orderBy('${name}.id', 'ASC');\n`;
    const body = `${filters ? `${filters}\n` : ''}${search}${sort}`.replaceAll('query.', 'listQuery.');
    if (list.cursor)
        return `    async findMany(skip: number, take: number, query: object): Promise<{ data: ${className}[]; nextCursor?: string }> {\n        const listQuery = query as List${className}Query;\n        if (listQuery.after !== undefined && listQuery.sort !== undefined && listQuery.sort !== 'id:asc') throw new BadRequestException('Le curseur requiert le tri id:asc.');\n        const afterId = listQuery.after === undefined ? undefined : this.decodeCursor(listQuery.after);\n        const builder = this.repository.createQueryBuilder('${name}');\n${body}        if (afterId !== undefined) builder.andWhere('${name}.id > :afterId', { afterId });\n        const values = await builder.addOrderBy('${name}.id', 'ASC').skip(afterId === undefined ? skip : 0).take(take + 1).getMany();\n        const data = values.slice(0, take).map((value) => this.toDomain(value));\n        const last = data.at(-1);\n        return { data, nextCursor: values.length > take && last && (listQuery.sort ?? 'id:asc') === 'id:asc' ? this.encodeCursor(last.id) : undefined };\n    }`;
    return `    async findMany(skip: number, take: number, query: object): Promise<${className}[]> {\n        const listQuery = query as List${className}Query;\n        const builder = this.repository.createQueryBuilder('${name}');\n${body}        builder.addOrderBy('${name}.id', 'ASC').skip(skip).take(take);\n        return (await builder.getMany()).map((value) => this.toDomain(value));\n    }`;
}
function prismaListMethod(className, list) {
    const filters = Object.entries(list.filters)
        .flatMap(([field, operators]) => operators.map((operator) => {
        const property = queryProperty(field, operator);
        const condition = operator === 'eq'
            ? `{ equals: query.${property} }`
            : operator === 'neq'
                ? `{ not: query.${property} }`
                : operator === 'contains'
                    ? `{ contains: query.${property}, mode: 'insensitive' }`
                    : `{ ${operator}: query.${property} }`;
        return `        if (query.${property} !== undefined) Object.assign(where, { ${field}: ${condition} });`;
    }))
        .join('\n');
    const search = list.search.length
        ? `        if (query.q !== undefined) where.OR = [${list.search.map((field) => `{ ${field}: { contains: query.q, mode: 'insensitive' } }`).join(', ')}];\n`
        : '';
    const sort = list.sort.length
        ? `        const sortParts = (query.sort ?? 'id:asc').split(':');\n        const [field, direction = 'asc'] = sortParts;\n        if (sortParts.length > 2 || !${JSON.stringify(['id', ...list.sort])}.includes(field) || !['asc', 'desc'].includes(direction.toLowerCase())) throw new BadRequestException('Tri invalide.');\n        const orderBy = [{ [field]: direction.toLowerCase() }, { id: 'asc' }];\n`
        : `        const orderBy = [{ id: 'asc' }];\n`;
    if (list.cursor)
        return `    async findMany(skip: number, take: number, query: List${className}Query): Promise<{ data: ${className}[]; nextCursor?: string }> {\n        if (query.after !== undefined && query.sort !== undefined && query.sort !== 'id:asc') throw new BadRequestException('Le curseur requiert le tri id:asc.');\n        const afterId = query.after === undefined ? undefined : this.decodeCursor(query.after);\n        const where: Record<string, unknown> = {};\n${filters ? `${filters}\n` : ''}${search}${sort}        const values = await this.model.findMany({ skip: afterId === undefined ? skip : 1, take: take + 1, cursor: afterId === undefined ? undefined : { id: afterId }, where, orderBy } as never);\n        const data = values.slice(0, take).map((value) => this.toDomain(value));\n        const last = data.at(-1);\n        return { data, nextCursor: values.length > take && last && (query.sort ?? 'id:asc') === 'id:asc' ? this.encodeCursor(last.id) : undefined };\n    }`;
    return `    async findMany(skip: number, take: number, query: List${className}Query): Promise<${className}[]> {\n        const where: Record<string, unknown> = {};\n${filters ? `${filters}\n` : ''}${search}${sort}        return (await this.model.findMany({ skip, take, where, orderBy } as never)).map((value) => this.toDomain(value));\n    }`;
}
function manyToManyRelations(relations) {
    return relations.filter((relation) => relation.type === 'manyToMany');
}
function relationMethodName(prefix, relation) {
    return `${prefix}${pascal(relation.field)}`;
}
function relationControllerMethods(relations, target) {
    return manyToManyRelations(relations)
        .map((relation) => `

    @Post(':id/${relation.field}/:targetId')
    @HttpCode(204)
    async ${relationMethodName('attach', relation)}(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Param('targetId', new ParseUUIDPipe()) targetId: string,
    ): Promise<void> {
        await this.${target}.${relationMethodName('attach', relation)}(id, targetId);
    }

    @Delete(':id/${relation.field}/:targetId')
    @HttpCode(204)
    async ${relationMethodName('detach', relation)}(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Param('targetId', new ParseUUIDPipe()) targetId: string,
    ): Promise<void> {
        await this.${target}.${relationMethodName('detach', relation)}(id, targetId);
    }`)
        .join('');
}
function typeOrmRelationMethods(className, relations) {
    return manyToManyRelations(relations)
        .map((relation) => `

    async ${relationMethodName('attach', relation)}(id: string, targetId: string): Promise<void> {
        await this.findOne(id);
        try {
            await this.repository
                .createQueryBuilder()
                .relation(${className}Entity, '${relation.field}')
                .of(id)
                .add(targetId);
        } catch (error) {
            this.rethrowPersistenceError(error);
        }
    }

    async ${relationMethodName('detach', relation)}(id: string, targetId: string): Promise<void> {
        await this.findOne(id);
        try {
            await this.repository
                .createQueryBuilder()
                .relation(${className}Entity, '${relation.field}')
                .of(id)
                .remove(targetId);
        } catch (error) {
            this.rethrowPersistenceError(error);
        }
    }`)
        .join('');
}
function prismaRelationMethods(relations) {
    return manyToManyRelations(relations)
        .map((relation) => `

    async ${relationMethodName('attach', relation)}(id: string, targetId: string): Promise<void> {
        try {
            await this.model.update({ where: { id }, data: { ${relation.field}: { connect: { id: targetId } } } } as never);
        } catch (error) {
            this.handle(error);
        }
    }

    async ${relationMethodName('detach', relation)}(id: string, targetId: string): Promise<void> {
        try {
            await this.model.update({ where: { id }, data: { ${relation.field}: { disconnect: { id: targetId } } } } as never);
        } catch (error) {
            this.handle(error);
        }
    }`)
        .join('');
}
function addTypeOrmInverseRelations(projectRoot, sourceRoot, name, className, relations) {
    const byTarget = new Map();
    for (const relation of relations) {
        const group = byTarget.get(relation.target) ?? [];
        group.push(relation);
        byTarget.set(relation.target, group);
    }
    return [...byTarget.entries()].map(([target, targetRelations]) => {
        const relative = `${sourceRoot}/app/${target}/persistence/${target}.entity.ts`;
        const source = fs.readFileSync(projectPath(projectRoot, relative), 'utf8');
        const decoratorImport = /import\s*\{\s*([\s\S]*?)\s*\}\s*from 'typeorm';/;
        const importMatch = decoratorImport.exec(source);
        if (!importMatch)
            throw new Error(`L'entité cible ${targetRelations[0].targetClassName}Entity utilise un import TypeORM non supporté.`);
        const decorators = new Set(importMatch[1]
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean));
        if (targetRelations.some((relation) => relation.type === 'belongsTo'))
            decorators.add('OneToMany');
        if (targetRelations.some((relation) => relation.type === 'manyToMany')) {
            decorators.add('ManyToMany');
            decorators.add('type Relation');
        }
        const decoratorNames = [...decorators].sort();
        const decoratorStatement = `import { ${decoratorNames.join(', ')} } from 'typeorm';`;
        const decoratorReplacement = decoratorStatement.length <= 80
            ? decoratorStatement
            : `import {\n${decoratorNames.map((decorator) => `  ${decorator},`).join('\n')}\n} from 'typeorm';`;
        const withDecorator = source.replace(decoratorImport, decoratorReplacement);
        const childImport = `import { ${className}Entity } from '../../${name}/persistence/${name}.entity.js';\n`;
        if (withDecorator.includes(childImport))
            throw new Error(`L'entité cible ${targetRelations[0].targetClassName}Entity référence déjà ${className}Entity.`);
        const withImport = withDecorator.replace(/\n\n/, `\n${childImport}\n`);
        const indentation = /\n(\s+)@PrimaryGeneratedColumn/.exec(withImport)?.[1] ?? '    ';
        const property = `\n\n${targetRelations
            .map((relation) => {
            if (new RegExp(`\\b${relation.inverse}\\b`).test(source))
                throw new Error(`La propriété ${relation.inverse} existe déjà sur ${relation.targetClassName}Entity.`);
            return relation.type === 'manyToMany'
                ? `${indentation}@ManyToMany(() => ${className}Entity, (${camel(name)}) => ${camel(name)}.${relation.field})\n${indentation}${relation.inverse}!: Relation<${className}Entity>[];`
                : `${indentation}@OneToMany(() => ${className}Entity, (${camel(name)}) => ${camel(name)}.${relation.field})\n${indentation}${relation.inverse}!: ${className}Entity[];`;
        })
            .join('\n\n')}`;
        const end = withImport.lastIndexOf('\n}');
        if (end === -1)
            throw new Error(`L'entité cible ${targetRelations[0].targetClassName}Entity est invalide.`);
        return {
            path: relative,
            content: `${withImport.slice(0, end)}${property}${withImport.slice(end)}`,
            operation: 'replace',
        };
    });
}
function prismaResourceFiles(name, className, fields, route, relations, list) {
    const files = new Map();
    const properties = fields
        .map((field) => `    ${field.name}${field.nullable ? '?' : '!'}: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`)
        .join('\n');
    const input = fields
        .map((field) => `...((input as Record<string, unknown>).${field.name} === undefined ? {} : { ${field.name}${field.type === 'date' ? `: (input as Record<string, unknown>).${field.name} === null ? null : new Date((input as Record<string, unknown>).${field.name} as string)` : `: (input as Record<string, unknown>).${field.name}`} })`)
        .join(', ');
    const decimalMapping = fields
        .filter((field) => field.type === 'decimal')
        .map((field) => `${field.name}: value.${field.name} === null ? null : String(value.${field.name})`)
        .join(', ');
    files.set(`domain/${name}.ts`, `export class ${className} {\n    id!: string;\n${properties}\n}\n`);
    files.set(`dto/create-${name}.dto.ts`, `import { ${validationImports(fields, false)} } from 'class-validator';\n\nexport class Create${className}Dto {\n${dtoFields(fields, false)}\n}\n`);
    files.set(`dto/update-${name}.dto.ts`, `import { ${validationImports(fields, true)} } from 'class-validator';\n\nexport class Update${className}Dto {\n${dtoFields(fields, true)}\n}\n`);
    files.set(`dto/list-${name}.query.ts`, listQueryDto(className, list, fields));
    files.set(`persistence/${name}.repository.ts`, `import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';\nimport { ${className} as ${className}Record, Prisma } from '@prisma/client';\nimport { PrismaService } from '../../../prisma/prisma.service.js';\nimport { ${className} } from '../domain/${name}.js';\n\n@Injectable()\nexport class ${className}Repository {\n    constructor(private readonly prisma: PrismaService) {}\n    private readonly model = this.prisma.${className[0].toLowerCase() + className.slice(1)};\n    async create(input: Record<string, unknown>): Promise<${className}> { try { return this.toDomain(await this.model.create({ data: { ${input} } } as never)); } catch (error) { this.handle(error); } }\n    async findOne(id: string): Promise<${className}> { const value = await this.model.findUnique({ where: { id } }); if (!value) throw new NotFoundException('${className} introuvable'); return this.toDomain(value); }\n    async findMany(skip: number, take: number): Promise<${className}[]> { return (await this.model.findMany({ skip, take, orderBy: { id: 'asc' } })).map((value) => this.toDomain(value)); }\n    async update(id: string, input: Record<string, unknown>): Promise<${className}> { try { return this.toDomain(await this.model.update({ where: { id }, data: { ${input} } } as never)); } catch (error) { this.handle(error); } }\n    async remove(id: string): Promise<void> { try { await this.model.delete({ where: { id } }); } catch (error) { this.handle(error); } }${prismaRelationMethods(relations)}\n    private toDomain(value: ${className}Record): ${className} { return Object.assign(new ${className}(), value${decimalMapping ? `, { ${decimalMapping} }` : ''}); }\n    private handle(error: unknown): never { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Une ressource avec cette valeur unique existe déjà.'); if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new ConflictException('Cette ressource est référencée par une autre ressource.'); if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException('${className} introuvable'); throw error; }\n}\n`);
    files.set(`${name}.controller.ts`, `import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';\nimport { Create${className}Dto } from './dto/create-${name}.dto.js';\nimport { List${className}Query } from './dto/list-${name}.query.js';\nimport { Update${className}Dto } from './dto/update-${name}.dto.js';\nimport { ${className}Repository } from './persistence/${name}.repository.js';\n\n@Controller('${route}')\nexport class ${className}Controller {\n    constructor(private readonly repository: ${className}Repository) {}\n    @Post() create(@Body() dto: Create${className}Dto) { return this.repository.create(dto); }\n    @Get() async list(@Query() query: List${className}Query) { return { page: query.page, limit: query.limit, data: await this.repository.findMany((query.page - 1) * query.limit, query.limit) }; }\n    @Get(':id') get(@Param('id', new ParseUUIDPipe()) id: string) { return this.repository.findOne(id); }\n    @Patch(':id') update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: Update${className}Dto) { return this.repository.update(id, dto); }\n    @Delete(':id') @HttpCode(204) remove(@Param('id', new ParseUUIDPipe()) id: string) { return this.repository.remove(id); }${relationControllerMethods(relations, 'repository')}\n}\n`);
    files.set(`${name}.module.ts`, `import { Module } from '@nestjs/common';\nimport { PrismaModule } from '../../prisma/prisma.module.js';\nimport { ${className}Controller } from './${name}.controller.js';\nimport { ${className}Repository } from './persistence/${name}.repository.js';\n\n@Module({ imports: [PrismaModule], controllers: [${className}Controller], providers: [${className}Repository] })\nexport class ${className}Module {}\n`);
    const repositoryPath = `persistence/${name}.repository.ts`;
    files.set(repositoryPath, files
        .get(repositoryPath)
        .replace(`private readonly model = this.prisma.${className[0].toLowerCase() + className.slice(1)};`, `private get model() { return this.prisma.${className[0].toLowerCase() + className.slice(1)}; }`)
        .replaceAll('input: Record<string, unknown>', 'input: object'));
    const hasListFeatures = list.cursor || Object.keys(list.filters).length > 0 || list.search.length > 0 || list.sort.length > 0;
    if (hasListFeatures) {
        files.set(repositoryPath, files
            .get(repositoryPath)
            .replace(`import { ${className} } from '../domain/${name}.js';`, `${list.cursor ? "import { Buffer } from 'node:buffer';\n" : ''}import { ${className} } from '../domain/${name}.js';\nimport { List${className}Query } from '../dto/list-${name}.query.js';`)
            .replace(`import { ${className}Entity } from './${name}.entity.js';`, `import { BadRequestException } from '@nestjs/common';\nimport { ${className}Entity } from './${name}.entity.js';`)
            .replace(`import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';`, `import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';`)
            .replace(/    async findMany[\s\S]*?\n    async update/, `${prismaListMethod(className, list)}\n\n    async update`)
            .replace('    private toDomain', list.cursor ? `${cursorHelpers()}\n\n    private toDomain` : '    private toDomain'));
    }
    const controllerPath = `${name}.controller.ts`;
    files.set(controllerPath, files
        .get(controllerPath)
        .replace('ConflictException, ', '')
        .replace('this.repository.create(dto)', 'this.repository.create(dto as object)')
        .replace('this.repository.update(id, dto)', 'this.repository.update(id, dto as object)'));
    if (hasListFeatures) {
        files.set(controllerPath, files
            .get(controllerPath)
            .replace('this.repository.findMany((query.page - 1) * query.limit, query.limit)', 'this.repository.findMany((query.page - 1) * query.limit, query.limit, query)'));
    }
    if (list.cursor) {
        files.set(controllerPath, files
            .get(controllerPath)
            .replace('return { page: query.page, limit: query.limit, data: await this.repository.findMany((query.page - 1) * query.limit, query.limit, query) };', 'const result = await this.repository.findMany((query.page - 1) * query.limit, query.limit, query);\n    return { page: query.page, limit: query.limit, data: result.data, nextCursor: result.nextCursor };'));
    }
    return files;
}
function featureFiles(name, className, fields, route, table, profile, swagger, indexes, relations, list) {
    const advanced = profile === 'advanced';
    const entityProperties = fields.map((field) => entityColumn(field, className)).join('\n\n');
    const belongsToRelations = relations.filter((relation) => relation.type === 'belongsTo');
    const manyRelations = manyToManyRelations(relations);
    const relationImports = relations
        .map((relation) => `import { ${relation.targetClassName}Entity } from '../../${relation.target}/persistence/${relation.target}.entity.js';`)
        .join('\n');
    const relationProperties = relations
        .map((relation) => relation.type === 'manyToMany'
        ? `    @ManyToMany(() => ${relation.targetClassName}Entity, (${camel(relation.target)}) => ${camel(relation.target)}.${relation.inverse})\n    @JoinTable({ name: '${joinTableName(table, relation)}', joinColumn: { name: '${camel(name)}Id', referencedColumnName: 'id' }, inverseJoinColumn: { name: '${camel(relation.target)}Id', referencedColumnName: 'id' } })\n    ${relation.field}!: Relation<${relation.targetClassName}Entity>[];`
        : `    @ManyToOne(() => ${relation.targetClassName}Entity, (${relation.field}) => ${relation.field}.${relation.inverse}, { nullable: ${relation.nullable}, onDelete: '${relation.onDelete}' })\n    @JoinColumn({ name: '${relationIdField(relation)}' })\n    ${relation.field}${relation.nullable ? '?' : '!'}: Relation<${relation.targetClassName}Entity>${relation.nullable ? ' | null' : ''};`)
        .join('\n\n');
    const entityIndexes = indexes
        .map((index) => `@Index('${index.unique ? uniqueIndexName(table, index.fields) : indexName(table, index.fields)}', [${index.fields.map((field) => `'${field}'`).join(', ')}]${index.unique ? ', { unique: true }' : ''})`)
        .join('\n');
    const fieldAssignments = propertyMap(fields);
    const domainProperties = fields
        .map((field) => `    ${field.name}!: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`)
        .join('\n');
    const files = new Map();
    files.set('domain/' + name + '.ts', `export class ${className} {\n    id!: string;\n${domainProperties}\n}\n`);
    files.set('dto/create-' + name + '.dto.ts', `import { ${validationImports(fields, false)} } from 'class-validator';\n${swagger ? `import { ${swaggerImports(fields, false)} } from '@nestjs/swagger';\n` : ''}\nexport class Create${className}Dto {\n${dtoFields(fields, false, swagger)}\n}\n`);
    files.set('dto/update-' + name + '.dto.ts', `import { ${validationImports(fields, true)} } from 'class-validator';\n${swagger ? `import { ${swaggerImports(fields, true)} } from '@nestjs/swagger';\n` : ''}\nexport class Update${className}Dto {\n${dtoFields(fields, true, swagger)}\n}\n`);
    files.set('dto/list-' + name + '.query.ts', listQueryDto(className, list, fields));
    files.set('persistence/' + name + '.entity.ts', `import { Column, Entity${indexes.length ? ', Index' : ''}${belongsToRelations.length ? ', JoinColumn, ManyToOne' : ''}${manyRelations.length ? ', JoinTable, ManyToMany' : ''}${relations.length ? ', type Relation' : ''}, PrimaryGeneratedColumn } from 'typeorm';\n${relationImports ? `${relationImports}\n` : ''}\n${entityIndexes ? `${entityIndexes}\n` : ''}@Entity({ name: '${table}' })\nexport class ${className}Entity {\n    @PrimaryGeneratedColumn('uuid')\n    id!: string;\n\n${entityProperties}${relationProperties ? `\n\n${relationProperties}` : ''}\n}\n`);
    if (swagger) {
        const queryPath = 'dto/list-' + name + '.query.ts';
        const query = files.get(queryPath);
        files.set(queryPath, `import { ApiPropertyOptional } from '@nestjs/swagger';\n` +
            query
                .replace('    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    page = 1;', '    @ApiPropertyOptional({ minimum: 1, default: 1, example: 1 })\n    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    page = 1;')
                .replace('    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    @Max(MAX_PAGE_SIZE)\n    limit = 20;', '    @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 20, example: 20 })\n    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    @Max(MAX_PAGE_SIZE)\n    limit = 20;'));
    }
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
    const foreignKeyConflictError = advanced
        ? `new ${className}ConflictError('Cette ressource est référencée par une autre ressource.')`
        : `new ConflictException('Cette ressource est référencée par une autre ressource.')`;
    files.set('persistence/' + name + '.repository.ts', `${persistenceImports}import { ${className}Entity } from './${name}.entity.js';\n\n@Injectable()\nexport class ${className}Repository${advanced ? ` implements ${className}RepositoryPort` : ''} {\n    constructor(@InjectRepository(${className}Entity) private readonly repository: Repository<${className}Entity>) {}\n\n    async create(input: ${persistenceInputTypes}): Promise<${className}> {\n        try {\n            return this.toDomain(await this.repository.save(this.repository.create({ ${fieldAssignments} })));\n        } catch (error) {\n            this.rethrowPersistenceError(error);\n        }\n    }\n\n    async findOne(id: string): Promise<${className}> {\n        const value = await this.repository.findOneBy({ id });\n        if (!value) throw ${missingError};\n        return this.toDomain(value);\n    }\n\n    async findMany(skip: number, take: number): Promise<${className}[]> {\n        return (await this.repository.find({ skip, take, order: { id: 'ASC' } })).map((value) => this.toDomain(value));\n    }\n\n    async update(id: string, input: ${persistenceUpdateTypes}): Promise<${className}> {\n        const existing = await this.repository.preload({ id, ${fieldAssignments} });\n        if (!existing) throw ${missingError};\n        try {\n            return this.toDomain(await this.repository.save(existing));\n        } catch (error) {\n            this.rethrowPersistenceError(error);\n        }\n    }\n\n    async remove(id: string): Promise<void> {\n        try {\n            const result = await this.repository.delete(id);\n            if (!result.affected) throw ${missingError};\n        } catch (error) {\n            this.rethrowPersistenceError(error);\n        }\n    }\n\n    private toDomain(value: ${className}Entity): ${className} {\n        return Object.assign(new ${className}(), value);\n    }\n\n    private rethrowPersistenceError(error: unknown): never {\n        if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505')\n            throw ${conflictError};\n        if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23503')\n            throw ${foreignKeyConflictError};\n        throw error;\n    }\n}\n`);
    const hasListFeatures = list.cursor || Object.keys(list.filters).length > 0 || list.search.length > 0 || list.sort.length > 0;
    if (hasListFeatures) {
        const repositoryPath = 'persistence/' + name + '.repository.ts';
        files.set(repositoryPath, files
            .get(repositoryPath)
            .replace(`import { ${className} } from '../domain/${name}.js';`, `${list.cursor ? "import { Buffer } from 'node:buffer';\n" : ''}import { ${className} } from '../domain/${name}.js';\nimport { List${className}Query } from '../dto/list-${name}.query.js';`)
            .replace("import { Injectable } from '@nestjs/common';", "import { BadRequestException, Injectable } from '@nestjs/common';")
            .replace("import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';", "import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';")
            .replace(/    async findMany[\s\S]*?\n    async update/, `${typeOrmListMethod(className, name, list)}\n\n    async update`)
            .replace('    private toDomain', list.cursor ? `${cursorHelpers()}\n\n    private toDomain` : '    private toDomain'));
    }
    if (manyRelations.length) {
        const persistencePath = 'persistence/' + name + '.repository.ts';
        files.set(persistencePath, files
            .get(persistencePath)
            .replace('    private toDomain', `${typeOrmRelationMethods(className, relations)}\n\n    private toDomain`));
    }
    if (advanced) {
        const contract = applicationContract(name, className, fields);
        files.set(contract.path, contract.content);
        files.set(`application/${name}.errors.ts`, `export class ${className}NotFoundError extends Error {\n    constructor(message = '${className} introuvable') {\n        super(message);\n        this.name = '${className}NotFoundError';\n    }\n}\n\nexport class ${className}ConflictError extends Error {\n    constructor(message = 'Une ressource avec cette valeur unique existe déjà.') {\n        super(message);\n        this.name = '${className}ConflictError';\n    }\n}\n`);
        files.set(`application/ports/${name}.repository.port.ts`, `import { Create${className}Input, Update${className}Input } from '../${name}.contract.js';\nimport { ${className} } from '../../domain/${name}.js';\n\nexport const ${className}RepositoryToken = Symbol('${className}RepositoryPort');\n\nexport interface ${className}RepositoryPort {\n    create(input: Create${className}Input): Promise<${className}>;\n    findOne(id: string): Promise<${className}>;\n    findMany(skip: number, take: number): Promise<${className}[]>;\n    update(id: string, input: Update${className}Input): Promise<${className}>;\n    remove(id: string): Promise<void>;\n}\n`);
        files.set(`application/${name}.service.ts`, `import { Create${className}Input, ${className}Output, Update${className}Input } from './${name}.contract.js';\nimport { ${className}RepositoryPort } from './ports/${name}.repository.port.js';\nimport { ${className} } from '../domain/${name}.js';\n\nexport class ${className}Service {\n    constructor(private readonly repository: ${className}RepositoryPort) {}\n\n    async create(input: Create${className}Input): Promise<${className}Output> {\n        return this.toOutput(await this.repository.create(input));\n    }\n\n    async findOne(id: string): Promise<${className}Output> {\n        return this.toOutput(await this.repository.findOne(id));\n    }\n\n    async findMany(skip: number, take: number): Promise<${className}Output[]> {\n        return (await this.repository.findMany(skip, take)).map((value) => this.toOutput(value));\n    }\n\n    async update(id: string, input: Update${className}Input): Promise<${className}Output> {\n        return this.toOutput(await this.repository.update(id, input));\n    }\n\n    remove(id: string): Promise<void> {\n        return this.repository.remove(id);\n    }\n\n    private toOutput(value: ${className}): ${className}Output {\n        return { id: value.id, ${fields.map((field) => `${field.name}: value.${field.name}`).join(', ')} };\n    }\n}\n`);
        if (hasListFeatures) {
            const portPath = `application/ports/${name}.repository.port.ts`;
            const servicePath = `application/${name}.service.ts`;
            files.set(portPath, files
                .get(portPath)
                .replace('findMany(skip: number, take: number):', 'findMany(skip: number, take: number, query: object):'));
            files.set(servicePath, files
                .get(servicePath)
                .replace('findMany(skip: number, take: number):', 'findMany(skip: number, take: number, query: object):')
                .replace('this.repository.findMany(skip, take)', 'this.repository.findMany(skip, take, query)'));
            if (list.cursor) {
                files.set(portPath, files
                    .get(portPath)
                    .replace(`findMany(skip: number, take: number, query: object): Promise<${className}[]>;`, `findMany(skip: number, take: number, query: object): Promise<{ data: ${className}[]; nextCursor?: string }>;`));
                files.set(servicePath, files
                    .get(servicePath)
                    .replace(`async findMany(skip: number, take: number, query: object): Promise<${className}Output[]> {\n        return (await this.repository.findMany(skip, take, query)).map((value) => this.toOutput(value));\n    }`, `async findMany(skip: number, take: number, query: object): Promise<{ data: ${className}Output[]; nextCursor?: string }> {\n        const result = await this.repository.findMany(skip, take, query);\n        return { data: result.data.map((value) => this.toOutput(value)), nextCursor: result.nextCursor };\n    }`));
            }
        }
        if (manyRelations.length) {
            const portPath = `application/ports/${name}.repository.port.ts`;
            const servicePath = `application/${name}.service.ts`;
            const portMethods = manyRelations
                .flatMap((relation) => [
                `    ${relationMethodName('attach', relation)}(id: string, targetId: string): Promise<void>;`,
                `    ${relationMethodName('detach', relation)}(id: string, targetId: string): Promise<void>;`,
            ])
                .join('\n');
            const serviceMethods = manyRelations
                .flatMap((relation) => [
                `    ${relationMethodName('attach', relation)}(id: string, targetId: string): Promise<void> { return this.repository.${relationMethodName('attach', relation)}(id, targetId); }`,
                `    ${relationMethodName('detach', relation)}(id: string, targetId: string): Promise<void> { return this.repository.${relationMethodName('detach', relation)}(id, targetId); }`,
            ])
                .join('\n\n');
            files.set(portPath, files
                .get(portPath)
                .replace('    remove(id: string): Promise<void>;', `    remove(id: string): Promise<void>;\n${portMethods}`));
            files.set(servicePath, files.get(servicePath).replace('    private toOutput', `${serviceMethods}\n\n    private toOutput`));
        }
    }
    let controllerImports = advanced
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
    if (hasListFeatures) {
        const controllerPath = name + '.controller.ts';
        files.set(controllerPath, files
            .get(controllerPath)
            .replace(`.${controllerTarget}.findMany(skip, query.limit)`, `.${controllerTarget}.findMany(skip, query.limit, query)`));
    }
    if (list.cursor) {
        const controllerPath = name + '.controller.ts';
        const invocation = advanced
            ? `this.respond(this.${controllerTarget}.findMany(skip, query.limit, query))`
            : `this.${controllerTarget}.findMany(skip, query.limit, query)`;
        files.set(controllerPath, files
            .get(controllerPath)
            .replace(`return { page: query.page, limit: query.limit, data: await ${invocation} };`, `const result = await ${invocation};\n        return { page: query.page, limit: query.limit, data: result.data, nextCursor: result.nextCursor };`));
    }
    if (manyRelations.length) {
        const controllerPath = name + '.controller.ts';
        const controller = files.get(controllerPath);
        const insertion = advanced ? controller.indexOf(errorBoundary) : controller.lastIndexOf('}');
        if (insertion === -1)
            throw new Error(`Contrôleur généré invalide pour ${className}.`);
        files.set(controllerPath, `${controller.slice(0, insertion)}${relationControllerMethods(relations, controllerTarget)}${controller.slice(insertion)}`);
    }
    if (swagger) {
        const controllerPath = name + '.controller.ts';
        const controller = files.get(controllerPath);
        files.set(controllerPath, `import { ApiBadRequestResponse, ApiConflictResponse, ApiCreatedResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';\n` +
            controller
                .replace(`@Controller('${route}')`, `@ApiTags('${route}')\n@Controller('${route}')`)
                .replace('    @Post()\n', `    @ApiOperation({ summary: 'Créer ${name}' })\n    @ApiCreatedResponse({ description: '${className} créé.' })\n    @ApiBadRequestResponse({ description: 'Requête invalide.' })\n    @ApiConflictResponse({ description: 'Valeur unique déjà utilisée.' })\n    @Post()\n`)
                .replace('    @Get()\n', `    @ApiOperation({ summary: 'Lister ${name}' })\n    @ApiOkResponse({ description: 'Page de résultats.' })\n    @Get()\n`)
                .replaceAll("    @Get(':id')\n", `    @ApiParam({ name: 'id', format: 'uuid' })\n    @ApiOkResponse({ description: '${className} trouvé.' })\n    @ApiNotFoundResponse({ description: '${className} introuvable.' })\n    @Get(':id')\n`)
                .replaceAll("    @Patch(':id')\n", `    @ApiParam({ name: 'id', format: 'uuid' })\n    @ApiOkResponse({ description: '${className} mis à jour.' })\n    @ApiBadRequestResponse({ description: 'Requête invalide.' })\n    @ApiNotFoundResponse({ description: '${className} introuvable.' })\n    @Patch(':id')\n`)
                .replace("    @Delete(':id')\n", `    @ApiParam({ name: 'id', format: 'uuid' })\n    @ApiNoContentResponse({ description: '${className} supprimé.' })\n    @ApiNotFoundResponse({ description: '${className} introuvable.' })\n    @Delete(':id')\n`));
    }
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
export async function planResourceGeneration(projectRoot, options) {
    const profile = parseArchitectureProfile(options.profile);
    const orm = options.orm ?? 'typeorm';
    if (orm !== 'typeorm' && orm !== 'prisma')
        throw new Error('ORM non supporté.');
    const name = options.name.trim().toLowerCase().replaceAll('_', '-');
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name))
        throw new Error('Nom de ressource invalide.');
    const className = pascal(name);
    const project = inspectProject(projectRoot, orm, { cqrs: false, application: options.application });
    projectRoot = project.root;
    const featureDirectory = projectPath(projectRoot, `${project.sourceRoot}/app/${name}`);
    const appModulePath = project.appModulePath;
    const relations = resolveRelations(projectRoot, project.sourceRoot, name, orm, options.fields, options.relations);
    const fields = [...options.fields, ...relationFields(relations)];
    const indexes = resolvedIndexes(fields, options.indexes);
    const list = options.list ?? { cursor: false, filters: {}, sort: [], search: [] };
    if (orm === 'prisma') {
        const files = prismaResourceFiles(name, className, fields, options.route, relations, list);
        const appModule = registerModuleInAppModule(fs.readFileSync(appModulePath, 'utf8'), `${className}Module`, `./app/${name}/${name}.module.js`, `${className}Module`);
        const schemaPath = projectPath(projectRoot, 'prisma/schema.prisma');
        const changes = [...files].map(([relative, content]) => ({
            path: `${project.sourceRoot}/app/${name}/${relative}`,
            content,
            operation: 'create',
        }));
        changes.push({
            path: 'prisma/schema.prisma',
            content: prismaSchema(fs.readFileSync(schemaPath, 'utf8'), className, options.table, fields, indexes, relations),
            operation: 'replace',
        });
        changes.push(...prismaRuntime(projectRoot, project.sourceRoot));
        changes.push({
            path: `${project.sourceRoot}/app/${name}/resource.json`,
            content: `${JSON.stringify({ name, route: options.route, table: options.table, orm, profile, fields: options.fields, indexes, relations: relationManifest(relations), list }, null, 2)}\n`,
            operation: 'create',
        });
        changes.push({ path: `${project.sourceRoot}/app.module.ts`, content: appModule, operation: 'replace' });
        const formattedChanges = await formatGeneratedCode(projectRoot, changes);
        const changesWithManifest = withGenerationManifest(projectRoot, formattedChanges, resourceGenerationDefinition(name, orm, project.sourceRoot, options.route, options.table, profile, options.fields, indexes, relationManifest(relations), list));
        return {
            root: projectRoot,
            changes: changesWithManifest,
            preview: previewFileChanges(projectRoot, changesWithManifest),
            featureConflict: fs.existsSync(featureDirectory)
                ? `Le module ou la ressource ${name} existe déjà.`
                : undefined,
        };
    }
    const manifest = JSON.parse(fs.readFileSync(projectPath(projectRoot, 'package.json'), 'utf8'));
    const swagger = Boolean(manifest.dependencies?.['@nestjs/swagger'] ?? manifest.devDependencies?.['@nestjs/swagger']);
    const files = featureFiles(name, className, fields, options.route, options.table, profile, swagger, indexes, relations, list);
    const restTest = generatedRestTest(name, className, fields, options.route, relations, project.sourceRoot);
    const e2eSupport = e2eSupportFiles(projectRoot);
    const appModule = registerModuleInAppModule(fs.readFileSync(appModulePath, 'utf8'), `${className}Module`, `./app/${name}/${name}.module.js`, `${className}Module`);
    const changes = [...files].map(([relative, content]) => ({
        path: `${project.sourceRoot}/app/${name}/${relative}`,
        content,
        operation: 'create',
    }));
    changes.push({ path: restTest.path, content: restTest.content, operation: 'create' });
    changes.push(...[...e2eSupport].map(([file, content]) => ({ path: file, content, operation: 'create' })));
    changes.push(...addTypeOrmInverseRelations(projectRoot, project.sourceRoot, name, className, relations));
    changes.push({
        path: `${project.sourceRoot}/app/${name}/resource.json`,
        content: `${JSON.stringify({ name, route: options.route, table: options.table, orm, profile, fields: options.fields, indexes, relations: relationManifest(relations), list }, null, 2)}\n`,
        operation: 'create',
    });
    changes.push({ path: `${project.sourceRoot}/app.module.ts`, content: appModule, operation: 'replace' });
    const formattedChanges = await formatGeneratedCode(projectRoot, changes);
    const changesWithManifest = withGenerationManifest(projectRoot, formattedChanges, resourceGenerationDefinition(name, orm, project.sourceRoot, options.route, options.table, profile, options.fields, indexes, relationManifest(relations), list));
    return {
        root: projectRoot,
        changes: changesWithManifest,
        preview: previewFileChanges(projectRoot, changesWithManifest),
        featureConflict: fs.existsSync(featureDirectory) ? `Le module ou la ressource ${name} existe déjà.` : undefined,
    };
}
export async function generateResource(projectRoot, options) {
    const plan = await planResourceGeneration(projectRoot, options);
    if (plan.featureConflict)
        throw new Error(plan.featureConflict);
    const conflict = plan.preview.find((change) => change.status === 'conflict');
    if (conflict)
        throw new Error(conflict.reason);
    applyFileChanges(plan.root, plan.changes);
}

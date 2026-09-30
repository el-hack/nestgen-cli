import fs from 'node:fs';
import path from 'node:path';
import { applyFileChanges, FileChange } from './file-transaction.js';
import { ArchitectureProfile, parseArchitectureProfile } from './architecture-profile.js';
import { Orm, registerModuleInAppModule } from './module-generator.js';
import { ResourceField, prismaType, typescriptType } from './resource-spec.js';

type Options = {
    name: string;
    fields: ResourceField[];
    route: string;
    table: string;
    orm?: Orm;
    profile?: ArchitectureProfile;
};

function pascal(value: string): string {
    return value
        .split('-')
        .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
        .join('');
}

function entityColumn(field: ResourceField): string {
    const type =
        field.type === 'number'
            ? "'double precision'"
            : field.type === 'boolean'
              ? "'boolean'"
              : field.type === 'date'
                ? "'timestamptz'"
                : field.type === 'uuid'
                  ? "'uuid'"
                  : "'varchar'";
    const options = [`type: ${type}`, `nullable: ${field.nullable}`];
    if (field.unique) options.push('unique: true');
    return `    @Column({ ${options.join(', ')} })\n    ${field.name}${field.nullable ? '?' : '!'}: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`;
}

function validationDecorators(field: ResourceField, optional: boolean): string {
    const decorators = field.nullable
        ? ['@IsOptional()']
        : optional
          ? ['@ValidateIf((_object: unknown, value: unknown) => value !== undefined)']
          : ['@IsDefined()'];
    decorators.push(
        field.type === 'number'
            ? '@IsNumber()'
            : field.type === 'boolean'
              ? '@IsBoolean()'
              : field.type === 'date'
                ? '@IsDateString()'
                : field.type === 'uuid'
                  ? '@IsUUID()'
                  : '@IsString()',
    );
    return decorators.map((decorator) => `    ${decorator}`).join('\n');
}

function dtoFields(fields: ResourceField[], optional: boolean): string {
    return fields
        .map((field) => {
            const isOptional = optional || field.nullable;
            const type = field.type === 'date' ? 'string' : typescriptType(field);
            return `${validationDecorators(field, isOptional)}\n    ${field.name}${isOptional ? '?' : '!'}: ${type}${field.nullable ? ' | null' : ''};`;
        })
        .join('\n\n');
}

function propertyMap(fields: ResourceField[]): string {
    return fields
        .map((field) => {
            const value = `input.${field.name}`;
            const converted = field.type === 'date' ? `${value} === null ? null : new Date(${value})` : value;
            return `...(${value} === undefined ? {} : { ${field.name}: ${converted} })`;
        })
        .join(', ');
}

function featureFiles(
    name: string,
    className: string,
    fields: ResourceField[],
    route: string,
    table: string,
    profile: ArchitectureProfile,
): Map<string, string> {
    const advanced = profile === 'advanced';
    const entityProperties = fields.map(entityColumn).join('\n\n');
    const fieldAssignments = propertyMap(fields);
    const domainProperties = fields
        .map((field) => `    ${field.name}!: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`)
        .join('\n');
    const files = new Map<string, string>();
    files.set('domain/' + name + '.ts', `export class ${className} {\n    id!: string;\n${domainProperties}\n}\n`);
    files.set(
        'dto/create-' + name + '.dto.ts',
        `import { IsBoolean, IsDateString, IsNumber, IsOptional, IsDefined, IsString, IsUUID, ValidateIf } from 'class-validator';\n\nexport class Create${className}Dto {\n${dtoFields(fields, false)}\n}\n`,
    );
    files.set(
        'dto/update-' + name + '.dto.ts',
        `import { IsBoolean, IsDateString, IsNumber, IsOptional, IsDefined, IsString, IsUUID, ValidateIf } from 'class-validator';\n\nexport class Update${className}Dto {\n${dtoFields(fields, true)}\n}\n`,
    );
    files.set(
        'dto/list-' + name + '.query.ts',
        `import { Type } from 'class-transformer';\nimport { IsInt, IsOptional, Max, Min } from 'class-validator';\n\nexport const MAX_PAGE_SIZE = 100;\n\nexport class List${className}Query {\n    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    page = 1;\n\n    @IsOptional()\n    @Type(() => Number)\n    @IsInt()\n    @Min(1)\n    @Max(MAX_PAGE_SIZE)\n    limit = 20;\n}\n`,
    );
    files.set(
        'persistence/' + name + '.entity.ts',
        `import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';\n\n@Entity({ name: '${table}' })\nexport class ${className}Entity {\n    @PrimaryGeneratedColumn('uuid')\n    id!: string;\n\n${entityProperties}\n}\n`,
    );
    files.set(
        'persistence/' + name + '.repository.ts',
        `import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';\nimport { InjectRepository } from '@nestjs/typeorm';\nimport { QueryFailedError, Repository } from 'typeorm';\nimport { Create${className}Dto } from '../dto/create-${name}.dto.js';\nimport { Update${className}Dto } from '../dto/update-${name}.dto.js';\nimport { ${className} } from '../domain/${name}.js';\n${advanced ? `import { ${className}RepositoryPort } from '../domain/${name}.repository.port.js';\n` : ''}import { ${className}Entity } from './${name}.entity.js';\n\n@Injectable()\nexport class ${className}Repository${advanced ? ` implements ${className}RepositoryPort` : ''} {\n    constructor(@InjectRepository(${className}Entity) private readonly repository: Repository<${className}Entity>) {}\n\n    async create(input: Create${className}Dto): Promise<${className}> {\n        try {\n            return this.toDomain(await this.repository.save(this.repository.create({ ${fieldAssignments} })));\n        } catch (error) {\n            this.rethrowPersistenceError(error);\n        }\n    }\n\n    async findOne(id: string): Promise<${className}> {\n        const value = await this.repository.findOneBy({ id });\n        if (!value) throw new NotFoundException('${className} introuvable');\n        return this.toDomain(value);\n    }\n\n    async findMany(skip: number, take: number): Promise<${className}[]> {\n        return (await this.repository.find({ skip, take, order: { id: 'ASC' } })).map((value) => this.toDomain(value));\n    }\n\n    async update(id: string, input: Update${className}Dto): Promise<${className}> {\n        const existing = await this.repository.preload({ id, ${fieldAssignments} });\n        if (!existing) throw new NotFoundException('${className} introuvable');\n        try {\n            return this.toDomain(await this.repository.save(existing));\n        } catch (error) {\n            this.rethrowPersistenceError(error);\n        }\n    }\n\n    async remove(id: string): Promise<void> {\n        const result = await this.repository.delete(id);\n        if (!result.affected) throw new NotFoundException('${className} introuvable');\n    }\n\n    private toDomain(value: ${className}Entity): ${className} {\n        return Object.assign(new ${className}(), value);\n    }\n\n    private rethrowPersistenceError(error: unknown): never {\n        if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505')\n            throw new ConflictException('Une ressource avec cette valeur unique existe déjà.');\n        throw error;\n    }\n}\n`,
    );
    if (advanced) {
        files.set(
            'domain/' + name + '.repository.port.ts',
            `import { Create${className}Dto } from '../dto/create-${name}.dto.js';\nimport { Update${className}Dto } from '../dto/update-${name}.dto.js';\nimport { ${className} } from './${name}.js';\n\nexport const ${className}RepositoryToken = Symbol('${className}RepositoryPort');\nexport interface ${className}RepositoryPort { create(input: Create${className}Dto): Promise<${className}>; findOne(id: string): Promise<${className}>; findMany(skip: number, take: number): Promise<${className}[]>; update(id: string, input: Update${className}Dto): Promise<${className}>; remove(id: string): Promise<void>; }\n`,
        );
        files.set(
            'application/' + name + '.service.ts',
            `import { Inject, Injectable } from '@nestjs/common';\nimport { Create${className}Dto } from '../dto/create-${name}.dto.js';\nimport { Update${className}Dto } from '../dto/update-${name}.dto.js';\nimport { ${className}RepositoryPort, ${className}RepositoryToken } from '../domain/${name}.repository.port.js';\n\n@Injectable() export class ${className}Service { constructor(@Inject(${className}RepositoryToken) private readonly repository: ${className}RepositoryPort) {} create(input: Create${className}Dto) { return this.repository.create(input); } findOne(id: string) { return this.repository.findOne(id); } findMany(skip: number, take: number) { return this.repository.findMany(skip, take); } update(id: string, input: Update${className}Dto) { return this.repository.update(id, input); } remove(id: string) { return this.repository.remove(id); } }\n`,
        );
    }
    files.set(
        name + '.controller.ts',
        `import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';\nimport { Create${className}Dto } from './dto/create-${name}.dto.js';\nimport { List${className}Query } from './dto/list-${name}.query.js';\nimport { Update${className}Dto } from './dto/update-${name}.dto.js';\nimport { ${className}${advanced ? 'Service' : 'Repository'} } from './${advanced ? 'application/' + name + '.service' : 'persistence/' + name + '.repository'}.js';\n\n@Controller('${route}')\nexport class ${className}Controller {\n    constructor(private readonly repository: ${className}${advanced ? 'Service' : 'Repository'}) {}\n\n    @Post()\n    create(@Body() dto: Create${className}Dto) { return this.repository.create(dto); }\n\n    @Get()\n    async list(@Query() query: List${className}Query) {\n        const skip = (query.page - 1) * query.limit;\n        return { page: query.page, limit: query.limit, data: await this.repository.findMany(skip, query.limit) };\n    }\n\n    @Get(':id')\n    get(@Param('id', new ParseUUIDPipe()) id: string) { return this.repository.findOne(id); }\n\n    @Patch(':id')\n    update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: Update${className}Dto) { return this.repository.update(id, dto); }\n\n    @Delete(':id')\n    @HttpCode(204)\n    async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> { await this.repository.remove(id); }\n}\n`,
    );
    files.set(
        name + '.module.ts',
        `import { Module } from '@nestjs/common';\nimport { TypeOrmModule } from '@nestjs/typeorm';\nimport { ${className}Controller } from './${name}.controller.js';\n${advanced ? `import { ${className}Service } from './application/${name}.service.js';\nimport { ${className}RepositoryToken } from './domain/${name}.repository.port.js';\n` : ''}import { ${className}Entity } from './persistence/${name}.entity.js';\nimport { ${className}Repository } from './persistence/${name}.repository.js';\n\n@Module({\n    imports: [TypeOrmModule.forFeature([${className}Entity])],\n    controllers: [${className}Controller],\n    providers: [${className}Repository${advanced ? `, { provide: ${className}RepositoryToken, useExisting: ${className}Repository }, ${className}Service` : ''}],\n})\nexport class ${className}Module {}\n`,
    );
    files.set(
        'persistence/' + name + '.prisma',
        `model ${className} {\n  id String @id @default(uuid())\n${fields.map((field) => `  ${field.name} ${prismaType(field)}`).join('\n')}\n\n  @@map("${table}")\n}\n`,
    );
    return files;
}

export function generateResource(projectRoot: string, options: Options): void {
    const profile = parseArchitectureProfile(options.profile);
    const orm = options.orm ?? 'typeorm';
    if (orm !== 'typeorm') throw new Error('La commande resource prend actuellement en charge TypeORM uniquement.');
    const name = options.name.toLowerCase();
    const className = pascal(name);
    const directory = path.join(projectRoot, 'src', 'app', name);
    const appModulePath = path.join(projectRoot, 'src', 'app.module.ts');
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Nom de ressource invalide.');
    if (fs.existsSync(directory)) throw new Error(`La ressource ${name} existe déjà.`);
    if (!fs.existsSync(appModulePath)) throw new Error('src/app.module.ts introuvable.');

    const files = featureFiles(name, className, options.fields, options.route, options.table, profile);
    const appModule = registerModuleInAppModule(
        fs.readFileSync(appModulePath, 'utf8'),
        `${className}Module`,
        `./app/${name}/${name}.module.js`,
        `${className}Module`,
    );
    const changes: FileChange[] = [...files].map(([relative, content]) => ({
        path: `src/app/${name}/${relative}`,
        content,
        operation: 'create',
    }));
    changes.push({
        path: `src/app/${name}/resource.json`,
        content: `${JSON.stringify({ name, route: options.route, table: options.table, orm, profile, fields: options.fields }, null, 2)}\n`,
        operation: 'create',
    });
    changes.push({ path: 'src/app.module.ts', content: appModule, operation: 'replace' });
    applyFileChanges(projectRoot, changes);
}

import fs from 'node:fs';
import path from 'node:path';
import { ResourceField, prismaType, typescriptType } from './resource-spec.js';

type Options = { name: string; fields: ResourceField[]; route: string; table: string };

function pascal(value: string): string {
    return value
        .split('-')
        .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
        .join('');
}

function entityFields(fields: ResourceField[]): string {
    return fields
        .map((field) => `    public ${field.name}: ${typescriptType(field)}${field.nullable ? ' | null' : ''},`)
        .join('\n');
}

function dtoFields(fields: ResourceField[]): string {
    return fields
        .map(
            (field) =>
                `    ${field.name}${field.nullable ? '?' : ''}: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`,
        )
        .join('\n');
}

export function generateResource(projectRoot: string, options: Options): void {
    const name = options.name.toLowerCase();
    const className = pascal(name);
    const directory = path.join(projectRoot, 'src', 'app', name);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Nom de ressource invalide.');
    if (fs.existsSync(directory)) throw new Error(`La ressource ${name} existe déjà.`);
    fs.mkdirSync(path.join(directory, 'domain'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'dto'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'persistence'), { recursive: true });
    fs.writeFileSync(
        path.join(directory, 'domain', `${name}.ts`),
        `export class ${className} {\n  constructor(\n    public readonly id: string,\n${entityFields(options.fields)}\n  ) {}\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'dto', `create-${name}.dto.ts`),
        `export class Create${className}Dto {\n${dtoFields(options.fields)}\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'dto', `update-${name}.dto.ts`),
        `export class Update${className}Dto {\n${options.fields.map((field) => `    ${field.name}?: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`).join('\n')}\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'dto', `list-${name}.query.ts`),
        `export const MAX_PAGE_SIZE = 100;\nexport function pagination(page = 1, limit = 20) {\n  const safePage = Number.isInteger(page) && page > 0 ? page : 1;\n  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_PAGE_SIZE) : 20;\n  return { skip: (safePage - 1) * safeLimit, take: safeLimit, page: safePage, limit: safeLimit };\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'persistence', `${name}.repository.ts`),
        `import { NotFoundException } from '@nestjs/common';\nimport { randomUUID } from 'node:crypto';\nimport { ${className} } from '../domain/${name}';\n\nexport class ${className}Repository {\n  private readonly values = new Map<string, ${className}>();\n  create(input: Omit<${className}, 'id'>) { const value = new ${className}(randomUUID(), ...Object.values(input)); this.values.set(value.id, value); return value; }\n  findOne(id: string) { const value = this.values.get(id); if (!value) throw new NotFoundException('${className} introuvable'); return value; }\n  findMany(skip: number, take: number) { return [...this.values.values()].slice(skip, skip + take); }\n  update(id: string, input: Partial<Omit<${className}, 'id'>>) { const value = this.findOne(id); Object.assign(value, input); return value; }\n  remove(id: string) { this.findOne(id); this.values.delete(id); }\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, `${name}.controller.ts`),
        `import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';\nimport { ${className}Repository } from './persistence/${name}.repository';\nimport { Create${className}Dto } from './dto/create-${name}.dto';\nimport { Update${className}Dto } from './dto/update-${name}.dto';\nimport { pagination } from './dto/list-${name}.query';\n@Controller('${options.route}') export class ${className}Controller {\n  constructor(private readonly repository: ${className}Repository) {}\n  @Post() create(@Body() dto: Create${className}Dto) { return this.repository.create(dto as never); }\n  @Get() list(@Query('page') page?: string, @Query('limit') limit?: string) { const values = pagination(Number(page), Number(limit)); return { ...values, data: this.repository.findMany(values.skip, values.take) }; }\n  @Get(':id') get(@Param('id') id: string) { return this.repository.findOne(id); }\n  @Patch(':id') update(@Param('id') id: string, @Body() dto: Update${className}Dto) { return this.repository.update(id, dto); }\n  @Delete(':id') remove(@Param('id') id: string) { this.repository.remove(id); return undefined; }\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'persistence', `${name}.prisma`),
        `model ${className} {\n  id String @id @default(uuid())\n${options.fields.map((field) => `  ${field.name} ${prismaType(field)}`).join('\n')}\n\n  @@map("${options.table}")\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'resource.json'),
        `${JSON.stringify({ name, route: options.route, table: options.table, fields: options.fields }, null, 2)}\n`,
    );
}

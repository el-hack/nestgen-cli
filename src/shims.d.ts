declare module '../../nestjs-generator/features/preflight.mjs' {
    export function inspectProject(projectRoot: string, orm: 'typeorm' | 'prisma'): unknown;
}

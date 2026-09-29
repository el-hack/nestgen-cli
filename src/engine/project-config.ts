import fs from 'node:fs';
import path from 'node:path';
import { ArchitectureProfile, parseArchitectureProfile } from './architecture-profile.js';
import { Orm } from './module-generator.js';

export type NestGenConfig = {
    version: 1;
    orm: Orm;
    profile: ArchitectureProfile;
    sourceRoot: string;
    packageManager: 'npm' | 'pnpm' | 'yarn';
    templateVersion: 1;
};
export const configFileName = 'nestgen.config.json';

export const defaultConfig: NestGenConfig = {
    version: 1,
    orm: 'typeorm',
    profile: 'simple',
    sourceRoot: 'src',
    packageManager: 'npm',
    templateVersion: 1,
};

export function loadConfigIfPresent(projectRoot: string): NestGenConfig | undefined {
    return fs.existsSync(path.join(projectRoot, configFileName)) ? loadConfig(projectRoot) : undefined;
}

export function loadConfig(projectRoot: string): NestGenConfig {
    const filePath = path.join(projectRoot, configFileName);
    const config = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<NestGenConfig>;
    if (config.version !== 1 || config.templateVersion !== 1)
        throw new Error('Version de configuration ou de templates non supportée.');
    if (config.orm !== 'typeorm' && config.orm !== 'prisma') throw new Error('ORM de configuration invalide.');
    if (config.sourceRoot !== 'src') throw new Error('Seul sourceRoot "src" est supporté.');
    const packageManager = config.packageManager;
    if (!packageManager || !['npm', 'pnpm', 'yarn'].includes(packageManager))
        throw new Error('Package manager invalide.');
    return {
        version: 1,
        orm: config.orm,
        profile: parseArchitectureProfile(config.profile),
        sourceRoot: config.sourceRoot,
        packageManager,
        templateVersion: 1,
    };
}

export function writeConfig(projectRoot: string, config: NestGenConfig): void {
    fs.writeFileSync(path.join(projectRoot, configFileName), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
}

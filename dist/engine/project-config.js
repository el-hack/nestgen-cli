import fs from 'node:fs';
import path from 'node:path';
import { parseArchitectureProfile } from './architecture-profile.js';
export const configFileName = 'nestgen.config.json';
export const defaultConfig = {
    version: 1,
    orm: 'typeorm',
    profile: 'simple',
    sourceRoot: 'src',
    packageManager: 'npm',
    templateVersion: 1,
};
export function loadConfigIfPresent(projectRoot) {
    return fs.existsSync(path.join(projectRoot, configFileName)) ? loadConfig(projectRoot) : undefined;
}
export function loadConfig(projectRoot) {
    const filePath = path.join(projectRoot, configFileName);
    const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (config.version !== 1 || config.templateVersion !== 1)
        throw new Error('Version de configuration ou de templates non supportée.');
    if (config.orm !== 'typeorm' && config.orm !== 'prisma')
        throw new Error('ORM de configuration invalide.');
    if (typeof config.sourceRoot !== 'string' ||
        !config.sourceRoot ||
        path.isAbsolute(config.sourceRoot) ||
        config.sourceRoot.split(/[\\/]/).includes('..'))
        throw new Error('sourceRoot de configuration invalide.');
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
export function writeConfig(projectRoot, config) {
    fs.writeFileSync(path.join(projectRoot, configFileName), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
}

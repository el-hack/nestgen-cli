import { inspectProject } from '../../dist/engine/project-preflight.js';

export { inspectProject };

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        const [projectRoot, orm] = process.argv.slice(2);
        process.stdout.write(`${JSON.stringify(inspectProject(projectRoot, orm))}\n`);
    } catch (cause) {
        console.error(`❌ ${cause.message}`);
        process.exitCode = 1;
    }
}

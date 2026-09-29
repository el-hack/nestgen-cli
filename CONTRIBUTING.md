# Contribuer

Utiliser Node.js 24 LTS et npm 11. Installer les dépendances avec `npm ci`, puis exécuter `npm run check`, `npm run format:check`, `npm test` et `npm run test:package` avant toute pull request.

`npm run test:package` construit un tarball dans un répertoire temporaire, vérifie sa liste de fichiers, l'installe dans un projet Nest vierge puis exécute le parcours `nestgen module … --dry-run`. Le hook `prepack` applique les contrôles statiques et les tests avant toute publication. Le tarball final ne contient que le binaire, les générateurs, le README, la licence et son manifeste.

Chaque évolution du générateur doit inclure un scénario de contrat dans `test/`. Ne jamais versionner `node_modules`, les fichiers système ou les secrets. Les changements incompatibles, ajouts et corrections sont consignés dans `CHANGELOG.md`.

Les releases suivent SemVer : correction pour un bug rétrocompatible, mineure pour une fonctionnalité rétrocompatible, majeure pour une rupture de contrat CLI ou de template.

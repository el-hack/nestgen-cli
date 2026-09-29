# Contribuer

Utiliser Node.js 24 LTS et npm 11. Installer les dépendances avec `npm ci`, puis exécuter `npm test` avant toute pull request.

Chaque évolution du générateur doit inclure un scénario de contrat dans `test/`. Ne jamais versionner `node_modules`, les fichiers système ou les secrets. Les changements incompatibles, ajouts et corrections sont consignés dans `CHANGELOG.md`.

Les releases suivent SemVer : correction pour un bug rétrocompatible, mineure pour une fonctionnalité rétrocompatible, majeure pour une rupture de contrat CLI ou de template.

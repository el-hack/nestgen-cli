# Changelog

Ce projet suit [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.1.0 - 2026-09-30

### Added

- Génération de ressources REST TypeORM : entité, DTOs, repository, contrôleur, validation, pagination et erreurs `404`/`409`.
- Définition de champs typés, routes et noms de table personnalisables pour `nestgen resource`.
- Profils d’architecture `simple` et `advanced`, avec ports de repository et injection Nest explicite pour le profil avancé.
- Configuration versionnée `nestgen.config.json` via `nestgen config init|show`.
- Génération de projets Docker avec cibles de développement et production, PostgreSQL et variables d’environnement.

### Changed

- Contrat CLI renforcé : préflight Nest, validation des noms, `--dry-run`, `doctor` et erreurs exploitables.
- Compatibilité déclarée avec Node.js `>=24.15.0 <27` et npm 11, pnpm ou Yarn.
- Documentation et tests d’intégration étendus pour Prisma, TypeORM, Docker et l’archive npm.

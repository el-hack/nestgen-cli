# Changelog

Ce projet suit [Semantic Versioning](https://semver.org/).

## Unreleased

## 0.2.2 - 2026-10-03

### Fixed

- Sorties du terminal harmonisées : diagnostics regroupés, aide alignée, configuration lisible, aperçus de fichiers et confirmations de génération.
- Conseils de réparation affichés uniquement lorsqu’ils sont utiles ; détails techniques disponibles avec `--verbose`.
- Journaux Bash cohérents, erreurs sur stderr et couleurs désactivées avec `--no-color`, `NO_COLOR` ou une sortie redirigée.
- `doctor` accepte toute la plage Node.js déclarée : `>=24.15.0 <27`.

### Changed

- Les aperçus destinés au terminal utilisent une présentation lisible. Les scripts qui analysaient leur JSON implicite doivent ajouter `--json` ; le contrat JSON versionné reste inchangé.

## 0.2.1 - 2026-10-01

### Fixed

- La vérification de release écrit désormais `release-metadata.json` avec le formatage configuré du dépôt. Le second passage de `prepack` déclenché par `npm publish` peut donc valider le package avant publication.

## 0.2.0 - 2026-10-01

### Added

- Définitions de ressources versionnées, types entier/décimal/enum, contraintes, index, relations, filtres, recherche, tri et pagination par curseur.
- Mises à jour de ressources protégées par manifeste, aperçu transactionnel, plan de migration TypeORM/Prisma et sorties JSON versionnées.
- Socle d’exploitation optionnel, métadonnées d’autorisation pour guards existants, diagnostic enrichi et support des workspaces Nest.
- Documentation versionnée, exemple Store API reconstruit en CI et contrat de landing aligné sur le paquet npm publié.

### Changed

- La CI couvre Node 24–26, macOS/Linux, npm/pnpm/Yarn, Docker, Prisma, TypeORM, tarball npm et parcours de démonstration.
- Les releases vérifient le tag, le commit, le changelog, la documentation, l’intégrité de l’archive et l’installation isolée du binaire.

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

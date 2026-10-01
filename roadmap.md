# Roadmap / Feuille de route

This page describes areas under consideration after `nestgen-cli@0.1.0`. It is not a release plan, a compatibility promise or a delivery date. Cette page présente des sujets envisagés après `nestgen-cli@0.1.0` ; elle ne constitue ni un plan de livraison, ni une promesse de compatibilité, ni une date d’engagement.

## Published in 0.1.0 / Disponible dans 0.1.0

- Project initialization, module and resource generation for TypeORM and Prisma.
- Declarative fields, indexes, relations, controlled list queries, safe resource updates and migration plans.
- Project configuration, dry-run, machine-readable output, diagnostic command, operations foundation and authorization metadata.
- Release validation, versioned documentation and the maintained Store API example.

See the [versioned guide](docs/versions/0.1.0.md) for the exact contract and limits of this release.

## Under consideration / À l’étude

| Topic / Sujet                                                                                  | Current status / Statut actuel                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Additional ORM adapters / Adaptateurs ORM supplémentaires                                      | Not planned for a specific release. The public contract remains TypeORM and Prisma.                                  |
| More application scaffolding (events, queries, services) / Davantage de scaffolding applicatif | Candidate for discovery; the current advanced profile already provides ports and application services for resources. |
| Extended operational integrations / Intégrations opérationnelles étendues                      | Candidate for discovery. The current operations option is local-only and does not integrate external monitoring.     |
| Additional generated test fixtures / Cas de test générés supplémentaires                       | Candidate for discovery. Generated unit and REST tests, plus repository integration coverage, are already published. |

An item moves to “published” only with an npm version, a changelog entry, versioned documentation and automated validation. Un sujet passe en « disponible » seulement avec une version npm, une entrée de changelog, une documentation versionnée et une validation automatisée.

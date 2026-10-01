# NestGen CLI

[![npm](https://img.shields.io/npm/v/nestgen-cli?label=npm)](https://www.npmjs.com/package/nestgen-cli)
[![CI](https://github.com/el-hack/nestgen-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/el-hack/nestgen-cli/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/nestgen-cli)](LICENSE)

NestGen CLI generates NestJS project scaffolding and TypeORM or Prisma resources. The canonical package is [`nestgen-cli`](https://www.npmjs.com/package/nestgen-cli); the canonical repository is [`el-hack/nestgen-cli`](https://github.com/el-hack/nestgen-cli).

## Supported contract

- Node.js `>=24.15.0 <27` (24, 25 and 26), npm 11, pnpm 10 or Yarn Berry 4. Windows is supported through WSL2 because project generation requires Bash.
- `init` creates a NestJS project interactively with TypeORM or Prisma.
- `module <name>` adds the advanced module layout for TypeORM or Prisma.
- `resource <name>` generates a TypeORM or Prisma REST CRUD: entity or model, DTOs, repository, controller, validation, pagination, `404` and unique-constraint `409`.
- `doctor`, `--dry-run`, `--help`, `--version`, `--no-interactive` and `--quiet` are scriptable CLI features.
- Existing Nest projects are supported when `nest-cli.json` declares a custom `sourceRoot`. In a workspace with several applications, pass `--application <name>` to target one application explicitly.

The repository CI executes generator contracts on the declared Node lines and on Linux and macOS. Windows users are supported through WSL2, whose Linux environment is covered by the Ubuntu runner. On Ubuntu/Node 24.15 it additionally validates Prisma, a TypeORM HTTP/PostgreSQL integration, generated Docker configurations, package-manager lockfile creation and locked reinstallation for npm, pnpm and Yarn, and the npm tarball. It does not publish releases or deploy applications. See [COMPATIBILITY.md](COMPATIBILITY.md) for the exact coverage and exclusions.

## Outputs by ORM

| Command                         | ORM     | Persistence output                                                                                                                   |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `resource` (simple or advanced) | TypeORM | Entity and repository using TypeORM; `resource.json` records `orm: "typeorm"`. No Prisma file or import.                             |
| `resource`                      | Prisma  | Prisma model, Nest module, DTOs, repository and REST controller; `resource.json` records `orm: "prisma"`. No TypeORM file or import. |
| `module`                        | TypeORM | TypeORM entity and repository, registered with `TypeOrmModule.forFeature`. No Prisma runtime or schema change.                       |
| `module`                        | Prisma  | Prisma repository, model added to `prisma/schema.prisma`, shared Prisma runtime if absent. No TypeORM file or import.                |

For Prisma, run `npx prisma generate` and apply the schema with `npx prisma db push` or an explicit migration after generating a resource. Selecting an ORM does not convert an existing resource or remove files produced by older generator versions.

## Quickstart — TypeORM resource

The following flow is the supported end-to-end TypeORM path. Prerequisites: Node.js `>=24.15.0 <27`, npm 11 and Docker with Compose. It uses Docker for PostgreSQL and creates an explicit migration.

```bash
npm install --global nestgen-cli
nestgen --version
nestgen init
```

In the interactive prompts, choose `npm`, `typeorm`, Docker enabled, then name the project `store-api`. Continue in the generated project:

```bash
cd store-api
nestgen doctor
nestgen resource product \
  --orm typeorm \
  --fields sku:string!,price:number,published:boolean \
  --route catalog/products \
  --table catalog_products

cp .env.example .env
docker compose up --detach postgres
npx typeorm-ts-node-commonjs migration:generate \
  src/database/migrations/CreateProducts \
  --dataSource src/database/data-source.ts
npx typeorm-ts-node-commonjs migration:run \
  --dataSource src/database/data-source.ts
npm run start:dev
```

In another terminal, verify the generated endpoint:

```bash
curl --request POST http://localhost:3000/catalog/products \
  --header 'content-type: application/json' \
  --data '{"sku":"sku-001","price":19.9,"published":true}'

curl 'http://localhost:3000/catalog/products?page=1&limit=20'

# Swagger UI, when selected during init
open http://localhost:3000/api

# Generated unit and database-backed REST tests
npm test
docker compose -f test/compose.e2e.yaml up -d --wait
npm run test:e2e -- product.e2e-spec.ts
docker compose -f test/compose.e2e.yaml down -v

# Stop the development database when finished
docker compose down -v
```

A duplicate `sku` returns HTTP `409`; a malformed `price` returns HTTP `400`; an unknown identifier returns HTTP `404`. The REST test database runs separately on `127.0.0.1:5433`, is reset during the test suite and is removed by the cleanup command. On Windows, open `http://localhost:3000/api` in a browser instead of using `open`.

### English quickstart

Install `nestgen-cli`, run `nestgen init`, choose **npm**, **typeorm** and Docker, then run the same commands above. `resource product --fields sku:string!,price:number,published:boolean` creates the TypeORM CRUD. Start PostgreSQL with `docker compose up -d postgres`, generate and run the migration through `typeorm-ts-node-commonjs`, start NestJS, then use the two `curl` commands to verify create and list operations.

## Commands

```text
nestgen init
nestgen module <name> [--orm typeorm|prisma] [--application name] [--dry-run]
nestgen resource <name> --fields name:type[,name:type] [--route route] [--table table] [--profile simple|advanced] [--application name]
nestgen config init [--orm typeorm|prisma] [--profile simple|advanced] [--package-manager npm|pnpm|yarn]
nestgen config show
nestgen doctor
```

Pour la CI, `init` accepte toutes les réponses interactives sous forme d’options :

```bash
nestgen init store-api --no-interactive --project-path ./generated --package-manager npm --orm typeorm --docker --swagger --git --modules user,product
```

Utilisez `--no-docker`, `--no-swagger`, `--no-git` ou `--modules ''` pour les désactiver. En mode non interactif, une option manquante est signalée avant toute écriture ou installation.

Fields accepted by `resource` are `string`, `number`, `integer`, `decimal(precision;scale)`, `enum(VALUE|VALUE)`, `boolean`, `date` and `uuid`. Add `?` for a nullable field and `!` for a unique field. A decimal uses a semicolon between precision and scale so a field list can still be separated by commas. Decimals are exposed as JSON strings to preserve their database precision; enums use uppercase values separated by `|`.

`integer` maps to PostgreSQL `integer` / Prisma `Int` and is validated with `@IsInt()`. `decimal(precision;scale)` maps to PostgreSQL `numeric(precision, scale)` / Prisma `Decimal @db.Decimal(precision, scale)` and is validated as a decimal string. `enum(...)` maps to a PostgreSQL enum / a generated Prisma enum and is validated against its declared values.

## Contraintes et index métier

Ajoutez des contraintes après le type entre accolades, séparées par `;` : `length` pour une chaîne, `min` et `max` pour un nombre ou un entier, `default` pour une valeur par défaut compatible, et `index` pour un index simple. Les index composites sont déclarés avec `--indexes`, chaque colonne étant séparée par `+`.

```bash
nestgen resource product \
  --fields sku:string{length=64;index}!,title:string{length=120},quantity:integer{min=0;max=100;default=0},status:enum(DRAFT|ACTIVE){default=DRAFT} \
  --indexes sku+status
```

NestGen refuse les combinaisons incompatibles, les bornes inversées et les index qui ciblent un champ absent. Les contraintes sont reflétées dans les DTOs, OpenAPI lorsque Swagger est installé, et les schémas TypeORM ou Prisma. Les index reçoivent un nom déterministe fondé sur la table et leurs colonnes, y compris lorsque PostgreSQL impose une limite de longueur.

## Définition de ressource dans un fichier

`nestgen resource --file product.resource.json` lit un JSON versionné. La version actuelle est `1`. Les options de ligne de commande (`<name>`, `--fields`, `--route`, `--table`, `--orm`, `--profile`, `--indexes`) remplacent la valeur du fichier lorsqu’elles sont présentes. Ajoutez `uniqueIndexes` au fichier pour les contraintes d’unicité composites, par exemple `"uniqueIndexes": ["userId+roleId"]`.

```json
{
    "version": 1,
    "name": "product",
    "route": "catalog/products",
    "table": "catalog_products",
    "orm": "prisma",
    "profile": "advanced",
    "fields": ["sku:string!", "status:enum(DRAFT|ACTIVE)"],
    "indexes": ["sku+status"],
    "relations": [{ "type": "belongsTo", "target": "category", "onDelete": "RESTRICT" }]
}
```

Le fichier doit être situé dans le projet courant. Les diagnostics indiquent le fichier et le champ ou l’index concerné, et `--dry-run` produit le même plan que la définition équivalente en flags.

### Filtres, recherche et tri contrôlés

Ajoutez `list` à la définition pour autoriser explicitement les filtres et tris exposés par l’endpoint de liste. Les champs ou opérateurs absents de cette liste sont refusés avec `400`. Les paramètres de filtre sont convertis selon le type déclaré (`number`, `integer`, `boolean` et `date`) et les requêtes ORM restent paramétrées.

```json
{
    "version": 1,
    "name": "product",
    "fields": ["sku:string!", "price:number", "published:boolean"],
    "list": {
        "filters": {
            "sku": ["eq", "contains"],
            "price": ["gte", "lt"],
            "published": ["eq"]
        },
        "search": ["sku"],
        "sort": ["sku", "price"]
    }
}
```

Les opérateurs autorisés dépendent du type : `eq` et `neq` pour tous les champs, `contains` pour les chaînes, et `gt`, `gte`, `lt`, `lte` pour les nombres, entiers, décimaux et dates. Une requête telle que `GET /products?skuContains=pro&priceGte=10&sort=price:desc` combine les filtres, applique un ordre déterministe (avec `id` comme brise-égalité) et respecte `page` et `limit`. `q` recherche sur les champs déclarés dans `search`.

Ajoutez `"cursor": true` dans `list` pour inclure `nextCursor` dans les réponses. Reprenez la liste avec `?after=<nextCursor>` : le curseur opaque est validé et suit l’ordre stable `id:asc`, après application des mêmes filtres et de la même recherche. Un tri métier ne produit donc pas de curseur et ne peut pas être combiné avec `after`; ce choix évite les doublons ou omissions lors de la progression. Les changements concurrents peuvent toujours modifier les données restantes entre deux requêtes, comme avec toute pagination sans snapshot transactionnel.

## Relations entre ressources

Une relation est déclarée dans le fichier de définition de la ressource enfant. La ressource cible doit déjà avoir été générée avec le même ORM. `belongsTo` crée la clé étrangère, un index et la propriété inverse sur la cible pour former une relation un-à-plusieurs cohérente.

```json
{
    "version": 1,
    "name": "order",
    "fields": ["reference:string!"],
    "relations": [
        {
            "type": "belongsTo",
            "target": "customer",
            "field": "customer",
            "inverse": "orders",
            "nullable": false,
            "onDelete": "RESTRICT"
        }
    ]
}
```

`field` et `inverse` sont optionnels : NestGen utilise le nom de la ressource cible et un pluriel du nom de la ressource enfant. `nullable` vaut `false` par défaut et `onDelete` vaut `RESTRICT`; les suppressions liées ne déclenchent donc aucune cascade implicite. `SET NULL` est accepté seulement avec `nullable: true`.

`manyToMany` crée une table de liaison avec ses deux clés étrangères et une contrainte d’unicité sur la paire. La ressource qui déclare la relation en est propriétaire et reçoit les routes `POST /<ressource>/:id/<relation>/:targetId` et `DELETE /<ressource>/:id/<relation>/:targetId` pour associer et dissocier sans supprimer les deux entités.

```json
{
    "version": 1,
    "name": "user",
    "fields": ["email:string!"],
    "relations": [{ "type": "manyToMany", "target": "role", "field": "roles", "inverse": "users" }]
}
```

Lorsqu’une association porte ses propres données métier, générez-la comme ressource explicite avec deux relations `belongsTo`, puis protégez le couple de clés avec `uniqueIndexes`. Par exemple, une ressource `membership` peut définir `userId`, `roleId` et `grantedAt`, avec `"uniqueIndexes": ["userId+roleId"]`. Cette forme permet de versionner et valider les attributs de l’association, ce que la table de liaison implicite ne fait pas.

On creation, non-nullable fields are required. On PATCH, omitted fields are preserved;
`null` clears only nullable fields and is rejected for other fields. Values such as
`false`, `0` and an empty string are preserved when valid for the field type.

```bash
nestgen resource invoice \
  --fields number:string!,lineCount:integer,amount:decimal(12;2),status:enum(DRAFT|ISSUED),paid:boolean,dueAt:date? \
  --route billing/invoices \
  --table billing_invoices
```

Use `nestgen --help` for the complete accepted option set. Do not rely on undocumented options such as `--crud` or `--path`.

`--dry-run` emits a versioned JSON plan for `module` and `resource`. Each entry identifies the creation or replacement, and includes the exact unified diff that generation would apply. Conflicts are reported in `conflicts`; no file, dependency or installation is changed.

Use `--json` in automation to receive one versioned result on stdout. Failures produce a versioned JSON error on stderr with a stable `USAGE`, `PROJECT_INVALID`, `CONFLICT` or `INTERNAL` code; `--json` also enables non-interactive, quiet and no-color behavior.

`nestgen doctor` is read-only. It reports version support, generator availability, Nest dependencies, ORM coherence, NestGen configuration, lockfile consistency and Nest integration. Every diagnostic has an identifier, severity, cause and concrete corrective action; use `nestgen doctor --json` for the same contract in automation.

## Generation metadata

Every successful `module` or `resource` generation updates `.nestgen/generation-manifest.json` in the same atomic transaction as the generated files. The versioned manifest records the generator version, a safe structural definition and SHA-256 fingerprints for each generated file. Paths are always project-relative; field default values are deliberately excluded so the manifest can be committed without copying secrets. Later tooling can compare these fingerprints to detect manual edits before proposing an update. An unknown manifest version stops generation before any write.

Use `resource <name> --update` to regenerate a resource after changing its fields, route, table or definition file. NestGen previews the same transaction with `--dry-run`; a generated file edited since its recorded generation is reported as a conflict and blocks all writes. Files not tracked by the resource manifest are left untouched, and the manifest is refreshed only after the complete update commits successfully.

## Project configuration and profiles

`nestgen config init` writes a versioned `nestgen.config.json` in the current project. For `resource`, the resolution order is flags, then the resource definition file, then configuration, then defaults. For `module`, `--orm` overrides configuration, then the default. `profile` is consumed by `resource`; `packageManager` is consumed by `init` and recorded for tooling, but neither `resource` nor `module` installs packages, so it has no runtime effect there. The generator resolves the effective source root from `nest-cli.json`; use `--application <name>` when a Nest workspace contains more than one application.

```bash
nestgen config init --orm typeorm --profile advanced --package-manager npm
nestgen config show
nestgen resource order --fields reference:string!,total:number
```

The `simple` profile generates a direct CRUD. The `advanced` profile adds application contracts, a repository port and a framework-independent application service between HTTP and the TypeORM adapter.

## OpenAPI when Swagger is enabled

If the project contains `@nestjs/swagger` (selected during `nestgen init`), generated resources enrich the OpenAPI document with DTO property schemas, examples, required and nullable fields, UUID/date formats, endpoint summaries, pagination parameters, and documented `400`, `404`, `409` and success responses. Projects without Swagger keep the same generated REST code and do not receive Swagger imports.

## Tests generated with a resource

Each generated resource includes a Jest unit test next to its implementation. In a standard project created by Nest, run the complete suite with `npm test`, or one resource with:

```bash
npm test -- product.repository.spec.ts
npm test -- order.service.spec.ts
```

The simple profile test exercises persistence success, a missing record and a unique-constraint conflict. The advanced profile test exercises the application service output and the HTTP translation of application errors to `404` and `409`. The tests use in-memory doubles; each resource also has a generated REST test backed by PostgreSQL.

## Generated REST tests on an isolated database

The first generated resource adds `test/.env.e2e` and `test/compose.e2e.yaml`; every resource adds `test/<resource>.e2e-spec.ts`. The test assigns `DATABASE_NAME` from `DATABASE_TEST_NAME`, resets the schema before every scenario, and drops it when the suite ends. It therefore never targets the development or production database.

```bash
docker compose -f test/compose.e2e.yaml up -d --wait
npm run test:e2e -- product.e2e-spec.ts
docker compose -f test/compose.e2e.yaml down -v
```

The generated suite covers create, read, partial update, pagination and delete, plus invalid input, malformed UUIDs, missing resources, and duplicate values when the resource declares a unique field with `!`.

## Docker generated by `init`

When Docker is enabled, NestGen writes:

- `compose.yaml` for local development, with PostgreSQL 16, a healthcheck and a code mount;
- `Dockerfile` with a `development` target and a separate minimal `production` target;
- `.dockerignore` and `.env.example` without overwriting existing environment examples.

Use development with `docker compose up`. Build the deployable image independently:

```bash
docker build --target production --tag store-api:local .
docker run --rm --env-file .env --publish 3000:3000 store-api:local
```

## Development

```bash
npm ci
npm run check
npm run format:check
npm test
npm run test:docker
npm run test:prisma
npm run test:typeorm
npm run test:package
```

See [COMPATIBILITY.md](COMPATIBILITY.md) for supported versions and [ARCHITECTURE.md](ARCHITECTURE.md) for generator design decisions.

## Licence

MIT. See [LICENSE](LICENSE).

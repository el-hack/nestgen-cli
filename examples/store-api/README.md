# Exemple Store API — NestGen CLI 0.2.0

Cette application exemple décrit une API de vente avec des clients, produits, commandes et lignes de commande. Elle est validée avec `nestgen-cli@0.2.0` et TypeORM, avec le profil d’architecture `advanced`.

Les fichiers de `definitions/` sont la source de vérité. Ils restent volontairement déclaratifs : l’application est reconstruite par le CLI au lieu de conserver une copie de fichiers générés qui pourrait diverger du produit.

## Parcours reproductible

Créez un dossier de travail, installez la version exacte du CLI puis générez le projet Nest avec PostgreSQL et Swagger :

```bash
mkdir nestgen-store-api && cd nestgen-store-api
npm init --yes
npm install nestgen-cli@0.2.0

./node_modules/.bin/nestgen init store-api \
  --no-interactive \
  --project-path ./generated \
  --package-manager npm \
  --orm typeorm \
  --docker \
  --swagger \
  --no-operations \
  --no-git \
  --modules ''
```

Copiez les définitions fournies par le paquet dans le projet, puis générez-les dans l’ordre indiqué. Les relations ciblent une ressource déjà générée ; cet ordre est donc un contrat de l’exemple.

```bash
cd generated/store-api
cp -R ../../node_modules/nestgen-cli/examples/store-api/definitions .

../../node_modules/.bin/nestgen config init --orm typeorm --profile advanced --package-manager npm
../../node_modules/.bin/nestgen resource --file definitions/customers.resource.json
../../node_modules/.bin/nestgen resource --file definitions/products.resource.json
../../node_modules/.bin/nestgen resource --file definitions/orders.resource.json
../../node_modules/.bin/nestgen resource --file definitions/order-items.resource.json
```

La commande de copie doit conserver les fichiers JSON inchangés. Les chemins sont relatifs au dossier initial : adaptez-les si vous utilisez un autre emplacement de travail.

## Schéma métier et migrations

`customer.email` et `product.sku` sont uniques. Une commande référence obligatoirement un client. Une ligne de commande référence une commande et un produit, et la paire `orderId + productId` est unique : un même produit n’apparaît qu’une fois par commande. Les relations utilisent `RESTRICT`, afin d’empêcher la suppression d’un client, produit ou commande encore référencé.

Générez et appliquez une migration explicite avant de démarrer l’API :

```bash
cp .env.example .env
docker compose up --detach postgres
npx typeorm-ts-node-commonjs migration:generate \
  src/database/migrations/CreateStoreSchema \
  --dataSource src/database/data-source.ts
npx typeorm-ts-node-commonjs migration:run \
  --dataSource src/database/data-source.ts
npm run start:dev
```

Vous pouvez ensuite créer un client, un produit, une commande avec son `customerId`, puis une ligne de commande avec les identifiants de commande et de produit. Swagger est disponible sur `http://localhost:3000/api` lorsque l’option a été activée durant `init`.

Pour faire évoluer le modèle, modifiez une définition, inspectez le plan et la revue de risque, puis générez la migration vous-même :

```bash
../../node_modules/.bin/nestgen resource \
  --file definitions/customers.resource.json \
  --update \
  --migration-name add-customer-phone \
  --dry-run
```

Le CLI ne crée ni n’applique la migration : relisez le diff et exécutez la commande TypeORM affichée seulement après validation.

## Validation maintenue

Depuis le dépôt NestGen, `npm run test:example` reconstruit dans un répertoire temporaire les quatre ressources via le binaire CLI. Le test vérifie les contraintes métier, les relations TypeORM, l’unicité de ligne de commande et le plan de migration. La CI l’exécute avec les tests d’intégration ; le paquet npm vérifie aussi que l’exemple est distribué.

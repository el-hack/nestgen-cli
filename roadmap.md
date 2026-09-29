## 🗺️ Roadmap technique — NestGen CLI

Basée sur l’analyse du code source réel du projet.

---

### 🎛️ Interface CLI

| Fonction                                             | Statut | Détails                                                                     |
| ---------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Interface interactive `nestgen init` avec `inquirer` | ✅     | Saisie du nom, dossier, package manager, ORM, Docker, Swagger, Git, modules |
| Logo ASCII + instructions CLI stylisées              | ✅     | `chalk` utilisé pour un rendu pro                                           |
| Commande `nestgen module` interactive                | 📌     | Mentionnée, mais pas encore implémentée                                     |
| Commande `nestgen doctor` (diagnostic)               | 📌     | Affichée dans le help mais non implémentée                                  |

---

### 🧱 Génération de projet (`generate_project.sh`)

| Fonction                                      | Statut | Détails                                            |
| --------------------------------------------- | ------ | -------------------------------------------------- |
| Détection et installation Nest CLI si absente | ✅     | `npm install -g @nestjs/cli` automatique           |
| Création du projet NestJS                     | ✅     | Via `nest new .` dans le bon dossier               |
| Installation des packages communs             | ✅     | `@nestjs/cqrs`, `class-validator`, etc.            |
| Choix de l’ORM : `typeorm` ou `prisma`        | ✅     | Charge le bon script (`typeorm.sh` ou `prisma.sh`) |
| Initialisation Git (`git.sh`)                 | ✅     | `git init` + premier commit                        |
| Ajout Swagger (`swagger.sh`)                  | ✅     | Installation + instructions main.ts                |
| Ajout Docker (`docker.sh`)                    | ✅     | `Dockerfile`, `docker-compose.yml`, `.env`         |
| Génération de modules personnalisés           | ✅     | Créés à la volée + injectés dans `app.module.ts`   |
| Injection `CqrsModule` automatique            | ✅     | Vérifie et injecte si absent                       |
| Injection `TypeOrmModule` automatique         | ✅     | Pour PostgreSQL + autoLoadEntities                 |

---

### 🧩 Génération de modules (`add_module.sh`)

| Fonction                                                                          | Statut | Détails                                                                        |
| --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| Structure DDD + CQRS + Clean Architecture                                         | ✅     | Création automatique : `domain`, `application`, `interfaces`, `infrastructure` |
| Génération de : `entity`, `repository`, `command`, `handler`, `controller`, `dto` | ✅     | Basé sur le nom de module                                                      |
| Support TypeORM complet                                                           | ✅     | Entity + Repository implémentés                                                |
| Support Prisma partiel                                                            | ✅     | Repository Prisma implémenté mais sans `PrismaService` auto                    |
| Injection du module dans `app.module.ts`                                          | ✅     | Ajout dans `imports`, `CqrsModule`, `TypeOrmModule` selon besoin               |

---

### ⚙️ Scripts techniques

| Script                    | Statut | Rôle                                                 |
| ------------------------- | ------ | ---------------------------------------------------- |
| `utils.sh`                | ✅     | Helpers (PascalCase, vérif commande, install cmd...) |
| `logger.sh`               | ✅     | Log stylisé en couleurs                              |
| `inject_module_to_app.sh` | ✅     | Injection sécurisée dans `app.module.ts`             |
| `path.sh`                 | ✅     | Helpers de chemin                                    |
| `install-nestgen.sh`      | ✅     | Installation locale + `pnpm link` global             |

---

### 🧪 Tests & Qualité (à faire)

| Élément                                             | Statut | Détails                     |
| --------------------------------------------------- | ------ | --------------------------- |
| Tests unitaires des scripts (bash ou JS)            | 📌     | Aucun test existant         |
| Validation structure projet généré                  | 📌     | Aucun test post-génération  |
| Vérification automatique des dépendances manquantes | 📌     | À implémenter dans `doctor` |

---

### 📦 Écosystème et extensibilité

| Fonction                                               | Statut | Détails                                 |
| ------------------------------------------------------ | ------ | --------------------------------------- |
| Support de nouveaux ORMs (ex: Sequelize, MikroORM)     | 📌     | Actuellement limité à TypeORM et Prisma |
| Génération de services / events / queries              | 📌     | Seuls les commands sont gérés           |
| Configuration avancée de Swagger (tag, auth, etc.)     | 📌     | Basique, nécessite ajout manuel         |
| Support multi-environnement (`.env.development`, etc.) | 📌     | `.env` simple par défaut                |
| Génération de tests unitaires (spec.ts)                | 📌     | Non géré                                |

# NestGen

<div align="center">
  <img src="https://raw.githubusercontent.com/outis25/nestgen-js/main/assets/logo.png" alt="NestGen Logo" width="200" />
  <h3>Générateur modulaire autonome pour projets NestJS</h3>
  <p>Architecture DDD • CQRS • Hexagonal • Prisma/TypeORM • Docker/Swagger</p>

![npm](https://img.shields.io/npm/v/@outis25/nestgen?color=crimson&style=for-the-badge)
![nestjs](https://img.shields.io/badge/NestJS-Scaffolded-red?style=for-the-badge&logo=nestjs)
![standalone](https://img.shields.io/badge/100%25-Autonome-brightgreen?style=for-the-badge)
![license](https://img.shields.io/npm/l/@outis25/nestgen?color=blue&style=for-the-badge)
![downloads](https://img.shields.io/npm/dm/@outis25/nestgen?color=green&style=for-the-badge)
</div>

## 📋 Table des matières

- [Introduction](#-introduction)
- [Fonctionnalités](#-fonctionnalités)
- [Installation](#-installation)
- [Guide d'utilisation](#-guide-dutilisation)
- [Architecture générée](#-architecture-générée)
- [Roadmap](#-roadmap)
- [FAQ](#-faq)
- [Contribuer](#-contribuer)
- [Licence](#-licence)

## 🚀 Introduction

**NestGen** est un générateur de code 100% autonome pour NestJS qui vous permet de créer rapidement des projets et des modules respectant les principes d'architecture avancés. Ce package n'a aucune dépendance externe et embarque tous les templates nécessaires pour générer des applications NestJS suivant les modèles Domain-Driven Design (DDD), Command Query Responsibility Segregation (CQRS) et l'architecture hexagonale.

Idéal pour les développeurs qui souhaitent maintenir une architecture propre et évolutive, NestGen accélère la phase de setup et garantit la cohérence structurelle de votre application, le tout sans nécessiter d'installation ou de configuration supplémentaire.

## ✨ Fonctionnalités

- **100% autonome** - Aucune dépendance externe, tout est intégré
- **Zéro configuration** - Fonctionne immédiatement après installation
- **Génération complète** - Projets et modules prêts à l'emploi en quelques secondes
- **Architecture avancée** - Support intégré pour DDD, CQRS et architecture hexagonale
- **Templates embarqués** - Tous les templates sont inclus dans le package
- **Support multiple d'ORM** - TypeORM et Prisma intégrés nativement
- **DevOps ready** - Configurations Docker, Swagger et CI/CD incluses
- **Mode interactif** - Interface CLI intuitive avec prompts pour une configuration guidée

## 📦 Installation

```bash
npm install -g @outis25/nestgen
```

C'est tout! Aucune configuration supplémentaire n'est nécessaire. Tous les templates et dépendances sont embarqués dans le package.

## 🔧 Guide d'utilisation

### Initialiser un nouveau projet

```bash
nestgen init
```

Cette commande lance un assistant interactif qui vous guidera à travers les étapes de configuration :

- Nom du projet
- Répertoire d'installation
- Sélection de l'ORM (TypeORM ou Prisma)
- Modules à générer automatiquement
- Options additionnelles (Git, Swagger, Docker, etc.)

### Générer un nouveau module

```bash
nestgen module <nom-du-module> [options]
```

Options disponibles :

- `--orm=<typeorm|prisma>` - Spécifie l'ORM à utiliser pour ce module
- `--crud` - Génère les opérations CRUD de base
- `--path=<chemin>` - Définit un chemin personnalisé pour le module

Exemples :

```bash
nestgen module user --orm=typeorm
nestgen module transaction --orm=prisma --crud
```

### Vérifier l'installation

```bash
nestgen doctor
```

Cette commande vérifie que :

- Le package est correctement installé
- Tous les templates embarqués sont disponibles
- Aucune dépendance n'est manquante

## 📁 Architecture générée

NestGen génère une structure de projet suivant les meilleures pratiques d'architecture :

```
src/app/<module>/
├── core/                   # Cœur du domaine métier
│   ├── application/        # Cas d'utilisation
│   │   ├── commands/       # Commandes CQRS
│   │   ├── events/         # Événements domaine
│   │   └── queries/        # Requêtes CQRS
│   └── domain/             # Modèle du domaine
│       ├── entities/       # Entités métier
│       └── ports/          # Interfaces pour l'hexagonal
├── infrastructure/         # Implémentations techniques
│   ├── adapters/           # Adaptateurs pour l'hexagonal
│   └── persistences/       # Couche de persistance
│       └── repositories/   # Implémentations des repos
└── interfaces/             # Points d'entrée de l'app
    ├── controllers/        # Contrôleurs REST
    └── dtos/               # Objets de transfert
```

Cette structure facilite :

- La séparation des préoccupations
- Les tests unitaires et d'intégration
- L'évolutivité du code
- Le remplacement des composants techniques

## 🔮 Roadmap

- ✅ Génération de projet complet
- ✅ Génération de module modulaire (DDD, CQRS, Repo)
- ✅ Support Prisma et TypeORM
- ✅ Mode interactif
- ✅ Docker, Swagger, Git
- ✅ Templates intégrés
- ✅ Package 100% autonome
- ⬜ `nestgen resource <name>` (CRUD complet)
- ⬜ `nestgen destroy module <name>`
- ⬜ `nestgen preset ecommerce` (Templates d'applications)
- ⬜ `nestgen --interactive` (menu CLI avancé)
- ⬜ Support pour MongoDB et Mongoose
- ⬜ Génération de tests unitaires et d'intégration

## ❓ FAQ

**Q: NestGen nécessite-t-il des dépendances externes ?**  
R: Non, NestGen est 100% autonome. Tous les templates et outils nécessaires sont embarqués dans le package.

**Q: Puis-je utiliser NestGen avec un projet NestJS existant ?**  
R: Oui, vous pouvez ajouter des modules générés par NestGen à un projet existant. La structure générée s'intègre parfaitement aux projets NestJS standards.

**Q: Comment puis-je personnaliser les templates générés ?**  
R: Par défaut, NestGen utilise ses templates intégrés. Leurs structures sont optimisées pour les meilleures pratiques et ne nécessitent généralement pas de modifications.

**Q: NestGen supporte-t-il les microservices ?**  
R: Pas encore nativement, mais c'est prévu dans les prochaines versions. En attendant, vous pouvez adapter manuellement la structure générée.

## 👥 Contribuer

Les contributions sont les bienvenues ! Pour contribuer :

1. Forkez le dépôt
2. Créez une branche pour votre fonctionnalité (`git checkout -b feature/amazing-feature`)
3. Commitez vos changements (`git commit -m 'feat: add amazing feature'`)
4. Poussez vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrez une Pull Request

<!-- Veuillez consulter le fichier `CONTRIBUTING.md` pour plus de détails. -->

## 📄 Licence

NestGen est distribué sous licence MIT. Voir le fichier `LICENSE` pour plus d'informations.

---

<div align="center">
  <p>Développé avec ❤️ par <a href="https://github.com/el-hack">@el-hack</a></p>
  <p>Si vous trouvez ce projet utile, n'hésitez pas à lui donner une ⭐️ sur GitHub !</p>
</div>

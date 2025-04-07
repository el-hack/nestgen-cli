#!/bin/bash

# ────── Config globale ──────
FEATURES_PATH="$(dirname "$0")/features"

# ────── Infos de base ──────
read -p "📛 Nom du projet : " APP_NAME
read -p "📁 Chemin d’installation (vide = ici) : " PROJECT_PATH
PROJECT_PATH=${PROJECT_PATH:-$(pwd)}
FULL_PATH="$PROJECT_PATH/$APP_NAME"

read -p "📦 Package manager (npm/yarn/pnpm) : " PM
read -p "🧠 ORM ? (typeorm/prisma) : " ORM

# ────── Création du projet ──────
echo "🚀 Génération du projet NestJS..."

mkdir -p "$FULL_PATH"
cd "$FULL_PATH" || {
  echo "❌ Le dossier $FULL_PATH n'existe pas ou vous n'avez pas les droits."
  exit 1
}

nest new . --package-manager "$PM" --skip-git || {
  echo "❌ Échec de la génération du projet avec Nest CLI"
  exit 1
}
echo "⚙️ Installation de base..."
$PM install @nestjs/cqrs class-validator class-transformer @nestjs/config

# ────── ORM ──────
if [ "$ORM" == "typeorm" ]; then
  bash "$FEATURES_PATH/typeorm.sh" "$PM" "$APP_NAME"
elif [ "$ORM" == "prisma" ]; then
  bash "$FEATURES_PATH/prisma.sh" "$PM" "$APP_NAME"
else
  echo "❌ ORM non reconnu"
  exit 1
fi

# ────── Docker ──────
read -p "🐳 Activer Docker ? (y/n) : " WITH_DOCKER
if [ "$WITH_DOCKER" == "y" ]; then
  bash "$FEATURES_PATH/docker.sh" "$APP_NAME"
fi

# ────── Swagger ──────
read -p "📚 Activer Swagger ? (y/n) : " WITH_SWAGGER
if [ "$WITH_SWAGGER" == "y" ]; then
  bash "$FEATURES_PATH/swagger.sh" "$PM"
fi

# ────── Git ──────
read -p "🔃 Initialiser Git ? (y/n) : " WITH_GIT
if [ "$WITH_GIT" == "y" ]; then
  bash "$FEATURES_PATH/git.sh"
fi

# ────── Génération de modules dynamiques ──────
read -p "👤 Quel(s) module(s) veux-tu générer ? (séparés par espaces) : " MODULES
for MODULE in $MODULES; do
  bash "$FEATURES_PATH/add_module.sh" "$MODULE" "$ORM"
done

if [ "$ORM" == "typeorm" ]; then
  echo "💡 Insertion de TypeOrmModule.forRoot dans app.module.ts"

  cat > src/app.module.ts <<EOF
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'appdb',
      synchronize: true,
      autoLoadEntities: true,
    }),
  ],
})
export class AppModule {}
EOF
fi


# ────── Résumé final ──────
echo ""
echo "✅ Projet NestJS \"$APP_NAME\" généré avec succès 🎉"
echo "📁 Localisation : $FULL_PATH"
echo "🧠 ORM utilisé : $ORM"
echo "📦 Package manager : $PM"
[ "$WITH_DOCKER" == "y" ] && echo "🐳 Docker activé"
[ "$WITH_SWAGGER" == "y" ] && echo "📚 Swagger activé"
[ "$WITH_GIT" == "y" ] && echo "🔃 Git initialisé"
[ ! -z "$MODULES" ] && echo "📦 Modules générés : $MODULES"

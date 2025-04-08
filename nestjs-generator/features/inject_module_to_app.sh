#!/bin/bash

RAW_NAME=$1
ORM=$2
APP_MODULE="src/app.module.ts"
MODULE_FILE="src/app/${RAW_NAME}/${RAW_NAME}.module.ts"

if [ -z "$RAW_NAME" ]; then
  echo "❌ Tu dois fournir un nom de module."
  exit 1
fi

if [ ! -f "$MODULE_FILE" ]; then
  echo "❌ Le fichier $MODULE_FILE est introuvable."
  exit 1
fi

# 🧠 Extraire le vrai nom de la classe exportée
MODULE_CLASS=$(grep -oE 'export class [A-Za-z0-9_]+' "$MODULE_FILE" | awk '{print $3}')

if [ -z "$MODULE_CLASS" ]; then
  echo "❌ Impossible de détecter la classe du module dans $MODULE_FILE"
  exit 1
fi

MODULE_PATH="./app/${RAW_NAME}/${RAW_NAME}.module"

# 🔧 Créer app.module.ts s'il n'existe pas
if [ ! -f "$APP_MODULE" ]; then
  echo "📄 Création de $APP_MODULE"
  mkdir -p src
  cat > "$APP_MODULE" <<EOF
import { Module } from '@nestjs/common';

@Module({
  imports: [],
})
export class AppModule {}
EOF
fi

# 🔌 Ajouter l'import du module s'il est absent
IMPORT_LINE="import { $MODULE_CLASS } from '${MODULE_PATH}';"
if ! grep -q "$IMPORT_LINE" "$APP_MODULE"; then
  echo "🔧 Insertion de $MODULE_CLASS dans les imports du haut"
  sed -i '' "1s|^|$IMPORT_LINE\n|" "$APP_MODULE"
else
  echo "ℹ️ Import $MODULE_CLASS déjà présent"
fi

# ➕ Ajouter dans imports: []
if grep -q "imports: \[" "$APP_MODULE"; then
  if ! grep -q "$MODULE_CLASS" "$APP_MODULE"; then
    sed -i '' "s|imports: \[|imports: [$MODULE_CLASS, |" "$APP_MODULE"
    echo "✅ $MODULE_CLASS injecté dans imports"
  else
    echo "ℹ️ $MODULE_CLASS déjà dans imports"
  fi
else
  echo "❌ Aucun bloc imports: [] trouvé dans $APP_MODULE"
fi

# ➕ Ajouter CqrsModule si absent
if ! grep -q "CqrsModule" "$APP_MODULE"; then
  sed -i '' "1i\\
import { CqrsModule } from '@nestjs/cqrs';
" "$APP_MODULE"
  sed -i '' "s|imports: \[|imports: [CqrsModule, |" "$APP_MODULE"
  echo "✅ CqrsModule injecté"
fi

# ➕ Ajouter TypeOrmModule si ORM = typeorm
if [ "$ORM" = "typeorm" ]; then
  if ! grep -q "TypeOrmModule" "$APP_MODULE"; then
    sed -i '' "1i\\
import { TypeOrmModule } from '@nestjs/typeorm';
" "$APP_MODULE"
    echo "✅ Import de TypeOrmModule ajouté"
  fi

  if ! grep -q "TypeOrmModule.forRoot" "$APP_MODULE"; then
    sed -i '' -E "s|(imports: \[)|\1\
    TypeOrmModule.forRoot({\
      type: 'postgres',\
      host: 'localhost',\
      port: 5432,\
      username: 'postgres',\
      password: 'postgres',\
      database: 'appdb',\
      synchronize: true,\
      autoLoadEntities: true,\
    }), |" "$APP_MODULE"
    echo "✅ TypeOrmModule.forRoot injecté"
  else
    echo "ℹ️ TypeOrmModule.forRoot déjà présent"
  fi
fi

echo "🎯 Module $MODULE_CLASS injecté dans app.module.ts avec succès 🧩"

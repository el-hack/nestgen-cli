#!/usr/bin/env bash

set -euo pipefail

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"


PM=${1:?Package manager requis}

pm_add "$PM" @nestjs/swagger@12 swagger-ui-express@5

# Ajout dans main.ts (à faire manuellement ou via automatisation)
echo ""
echo "📘 Pour activer Swagger, ajoute ceci dans main.ts :"
echo ""
cat <<'DOC'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('API Docs')
  .setDescription('The API description')
  .setVersion('1.0')
  .build();
const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api', app, document);
DOC

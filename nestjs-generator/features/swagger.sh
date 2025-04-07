#!/bin/bash

# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")/features"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"


PM=$1

$PM install @nestjs/swagger swagger-ui-express

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

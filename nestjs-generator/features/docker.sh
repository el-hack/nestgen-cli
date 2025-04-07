#!/bin/bash


# ────── Charger les helpers ──────
FEATURES_PATH="$(dirname "$0")/features"
source "$FEATURES_PATH/utils.sh"
source "$FEATURES_PATH/logger.sh"


APP_NAME=$1

cat > Dockerfile <<EOF
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["node", "dist/main"]
EOF

cat > docker-compose.yml <<EOF
version: '3.9'

services:
  postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: appdb
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  app:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - postgres
    env_file:
      - .env
    volumes:
      - .:/usr/src/app
    command: npm run start:dev

volumes:
  pgdata:
EOF

cat > .env <<EOF
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/appdb
PORT=3000
EOF

echo "✅ Dockerfile, docker-compose et .env générés !"

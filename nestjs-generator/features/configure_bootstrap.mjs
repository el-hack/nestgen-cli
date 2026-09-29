import fs from 'node:fs';

const [mainPath, swaggerEnabled] = process.argv.slice(2);

if (!mainPath || !fs.existsSync(mainPath)) {
  console.error(`❌ Bootstrap Nest introuvable : ${mainPath ?? 'src/main.ts'}`);
  process.exitCode = 1;
} else {
  const swagger = swaggerEnabled === 'y';
  const source = `import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
${swagger ? "import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';\n" : ''}import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
${swagger ? `
  const config = new DocumentBuilder()
    .setTitle('API')
    .setDescription('Documentation de l’API')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));
` : ''}
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
`;
  fs.writeFileSync(mainPath, source);
}

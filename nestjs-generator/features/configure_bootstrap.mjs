import fs from 'node:fs';

const [mainPath, swaggerEnabled, operationsEnabled] = process.argv.slice(2);

if (!mainPath || !fs.existsSync(mainPath)) {
    console.error(`❌ Bootstrap Nest introuvable : ${mainPath ?? 'src/main.ts'}`);
    process.exitCode = 1;
} else {
    const swagger = swaggerEnabled === 'y';
    const operations = operationsEnabled === 'y';
    const source = `import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
${swagger ? "import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';\n" : ''}import { AppModule } from './app.module';
${operations ? "import { StructuredLogger } from './operations/structured-logger.service';\n" : ''}

async function bootstrap() {
  const app = await NestFactory.create(AppModule${operations ? ', { bufferLogs: true }' : ''});
${operations ? '  app.useLogger(app.get(StructuredLogger));\n  app.enableShutdownHooks();\n' : ''}
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
${
    swagger
        ? `
  const config = new DocumentBuilder()
    .setTitle('API')
    .setDescription('Documentation de l’API')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));
`
        : ''
}
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
`;
    fs.writeFileSync(mainPath, source);
}

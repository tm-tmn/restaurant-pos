import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DbErrorFilter } from './common/db-error.filter';
import { MoneyErrorFilter } from './common/money.filter';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // ชุดซิงค์ที่ DTO ยอมรับได้สูงสุด (50 บิล × 100 รายการ ข้อความไทยเต็มความยาว) ≈ 7MB — ค่าเริ่มต้น 100kb ไม่พอ
  // ฝั่งเครื่อง POS ยังแบ่งชุดเองเมื่อเจอ 413 อีกชั้น
  app.useBodyParser('json', { limit: '8mb' });
  app.use(helmet());
  // อยู่หลัง reverse proxy (nginx / load balancer) ให้ตั้ง TRUST_PROXY=1 เพื่อให้กันเดารหัสผ่านเห็น IP จริง
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DbErrorFilter(), new MoneyErrorFilter());

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim());
  app.enableCors({ origin: origins });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api`);
}
bootstrap();

import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { corsOrigins } from './common/cors';
import { DbErrorFilter } from './common/db-error.filter';
import { MoneyErrorFilter } from './common/money.filter';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true }); // rawBody: ใช้ตรวจลายเซ็น webhook
  // ชุดซิงค์ที่ DTO ยอมรับได้สูงสุด (50 บิล × 100 รายการ ข้อความไทยเต็มความยาว) ≈ 7MB — ค่าเริ่มต้น 100kb ไม่พอ
  // ฝั่งเครื่อง POS ยังแบ่งชุดเองเมื่อเจอ 413 อีกชั้น
  app.useBodyParser('json', { limit: '8mb' });
  // ไม่บังคับอัปเกรดเป็น https: เครื่องในร้านอาจเปิดผ่าน http ภายใน LAN (บน Railway เป็น https อยู่แล้ว)
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  // อยู่หลัง reverse proxy (nginx / load balancer) ให้ตั้ง TRUST_PROXY=1 เพื่อให้กันเดารหัสผ่านเห็น IP จริง
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DbErrorFilter(), new MoneyErrorFilter());

  app.enableCors({ origin: corsOrigins() });
  serveWeb(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api`);
}
/**
 * เสิร์ฟหน้าเว็บ (apps/web/dist) จาก API ตัวเดียวกัน — deploy เป็นบริการเดียวบน Railway ได้
 * หน้าเว็บกับ API อยู่โดเมนเดียวกัน จึงไม่ต้องตั้ง CORS/VITE_API_URL
 * ไม่มีโฟลเดอร์ build ของเว็บ (เช่นตอนพัฒนาที่ใช้ vite dev) ก็ข้ามไป
 */
function serveWeb(app: NestExpressApplication) {
  const dir = process.env.WEB_DIST ?? join(__dirname, '..', '..', 'web', 'dist');
  const index = join(dir, 'index.html');
  if (!existsSync(index)) return;
  app.useStaticAssets(dir, {
    index: false,
    setHeaders: (res, path) => {
      // ไฟล์ใน assets/ มี hash ในชื่อ → แคชได้ยาว; index.html / sw.js ต้องเช็กใหม่ทุกครั้งเพื่อให้อัปเดตเวอร์ชันได้
      if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  });
  // เส้นทางของหน้าเว็บ (React Router) → index.html
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/') || req.path === '/api' || req.path.startsWith('/socket.io')) return next();
    // ไฟล์ที่ไม่มีจริง (เช่น chunk เวอร์ชันเก่า) → 404 ไม่ใช่ index.html
    if (/\.[a-z0-9]+$/i.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  console.log(`เสิร์ฟหน้าเว็บจาก ${dir}`);
}

bootstrap();

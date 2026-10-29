# บริการเดียว: API (NestJS) + หน้าเว็บ (build แล้ว) — ใช้ deploy บน Railway หรือที่ไหนก็ได้ที่รัน Docker
# ตัวแปรที่ต้องตั้งตอนรัน: DATABASE_URL, JWT_SECRET (ดู apps/api/.env.example)

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY apps ./apps
# หน้าเว็บกับ API อยู่โดเมนเดียวกัน → เรียก /api ได้เลย ไม่ต้องตั้ง VITE_API_URL
RUN npm run build -w apps/api && npm run build -w apps/web
RUN npm prune --omit=dev && mkdir -p apps/api/node_modules

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/
# แพ็กเกจที่ไม่ถูกยกขึ้น root (เวอร์ชันชนกับ workspace อื่น) อยู่ที่นี่
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 3000
# รัน migration ที่ค้างอัตโนมัติตอนเริ่ม แล้วเปิดรับคำขอ
CMD ["node", "apps/api/dist/main.js"]

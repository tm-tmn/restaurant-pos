# Restaurant POS

ระบบ POS สำหรับร้านอาหาร — **Phase 1: Core POS**
React PWA (ใช้งานต่อได้เมื่ออินเทอร์เน็ตขัดข้อง) + NestJS API + PostgreSQL

> ขอบเขตปัจจุบันยังไม่รวมการเชื่อมต่อ GrabFood / Delivery (ตัดออกตามแผน)

## ฟีเจอร์ใน Phase 1

| ส่วน | รายละเอียด |
|---|---|
| ขายหน้าร้าน | Quick Scan ด้วยเครื่องสแกนบาร์โค้ด (USB/Bluetooth), ค้นหาเมนู/SKU, หมวดหมู่, ตะกร้าคงอยู่แม้รีเฟรช |
| โต๊ะ | ผังโต๊ะ, เปิดบิล, เพิ่มรายการเข้าบิล (ส่งครัว), 1 โต๊ะ 1 บิลเปิด (กันชนกันที่ระดับฐานข้อมูล) |
| ชำระเงิน | เงินสด (ปุ่มธนบัตรด่วน + เงินทอน), QR PromptPay พร้อมยอด (สร้างในเครื่อง ใช้ได้แม้ออฟไลน์), บัตร (อ้างอิงสลิป EDC), ส่วนลด (ผู้จัดการขึ้นไป) |
| ใบเสร็จ | พิมพ์ใบเสร็จอย่างย่อขนาด 80mm ผ่าน `window.print()` |
| ออฟไลน์ | บิลขายหน้าร้าน "บันทึกลงเครื่องก่อน แล้วค่อยซิงค์" (IndexedDB) — ส่งซ้ำได้ไม่เกิดบิลซ้ำ, บิลที่เซิร์ฟเวอร์ปฏิเสธถูกเก็บให้ตรวจ ไม่หาย |
| กะ | เปิดกะพร้อมเงินทอนตั้งต้น, ปิดกะเทียบเงินสดที่ควรมีกับที่นับได้ |
| ผู้ใช้/สิทธิ์ | owner / manager / cashier, JWT, ยกเลิกบิล/รายการ/ส่วนลดเฉพาะผู้จัดการ |
| ประวัติ | audit log ทุกการยกเลิกบิล ยกเลิกรายการ ส่วนลด และราคาไม่ตรงตอนซิงค์ออฟไลน์ |
| รายงาน | ยอดขายรายวัน, จำนวนบิล, เฉลี่ยต่อบิล, รายชั่วโมง, เมนูขายดี, แยกตามวิธีชำระ |
| จัดการ | เมนู/หมวดหมู่/บาร์โค้ด, โต๊ะ, พนักงาน, ชื่อร้าน + PromptPay ID |

## โครงสร้าง

```
restaurant-pos/
├─ apps/
│  ├─ api/            NestJS + TypeORM + PostgreSQL
│  │  ├─ src/entities/      schema ทั้งหมด (เงินเก็บเป็น "สตางค์" จำนวนเต็ม)
│  │  ├─ src/common/money.ts   ตรรกะคำนวณยอด/ชำระเงิน (+ unit test)
│  │  ├─ src/orders/        เปิดบิล, เพิ่มรายการ, ชำระ, ยกเลิก, sync ออฟไลน์
│  │  ├─ src/reports/       รายงานรายวัน
│  │  └─ scripts/smoke.mjs  ทดสอบ API ทั้งเส้นทางหลัก
│  └─ web/            React + TypeScript + Vite + Tailwind (PWA)
│     ├─ src/lib/offline.ts    คิวออฟไลน์ + แคชเมนู
│     ├─ src/lib/promptpay.ts  สร้าง payload Thai QR PromptPay (+ unit test)
│     └─ src/pages/            หน้าขาย, โต๊ะ, บิล, กะ, รายงาน, จัดการ, ซิงค์
├─ docs/ARCHITECTURE.md
└─ docker-compose.yml   PostgreSQL 16 + Redis (Redis เตรียมไว้สำหรับ Phase 3)
```

## เริ่มใช้งาน (เครื่องพัฒนา)

ต้องมี Node.js 20+ และ Docker

```bash
npm install
npm run db:up                         # PostgreSQL + Redis
cp apps/api/.env.example apps/api/.env
# แก้ JWT_SECRET ใน apps/api/.env เป็นสตริงสุ่มยาว ≥ 24 ตัว เช่น: openssl rand -hex 32
npm run seed                          # สาขา MAIN, ผู้ใช้ owner, โต๊ะ T1–T8, เมนูตัวอย่าง
npm run dev:api                       # http://localhost:3000/api
npm run dev:web                       # http://localhost:5173
```

เข้าสู่ระบบด้วย `owner` / `ChangeMe!2026` (หรือค่าที่ตั้งใน `SEED_OWNER_PASSWORD`) แล้ว **เปลี่ยนรหัสผ่านทันที** ที่ จัดการ → พนักงาน
จากนั้นตั้ง PromptPay ID ที่ จัดการ → ตั้งค่าร้าน และเปิดกะที่เมนู "กะ" ก่อนเริ่มขาย

## ทดสอบ

```bash
npm test                              # unit test: ตรรกะเงิน (api) + PromptPay (web)
# smoke test API (ต้องรัน API + seed แล้ว; สร้างข้อมูลทดสอบลง DB — ห้ามใช้กับ production)
API_URL=http://localhost:3000/api node apps/api/scripts/smoke.mjs
```

## ก่อนขึ้น Production

- ปิด `DB_SYNC` และเปลี่ยนไปใช้ TypeORM migrations
- ตั้ง `JWT_SECRET` ใหม่, เปิด HTTPS (PWA/Service Worker และ `crypto.randomUUID` ต้องการ secure context)
- ตั้ง `CORS_ORIGINS` ให้ตรงโดเมนจริง และสำรองฐานข้อมูลอัตโนมัติ
- QR PromptPay ใน Phase 1 ให้พนักงานตรวจยอดเงินเข้าก่อนยืนยัน — การยืนยันอัตโนมัติผ่าน Payment Gateway อยู่ใน Phase 3

## แผนถัดไป

| Phase | เนื้อหา |
|---|---|
| 2 — Inventory & BOM | สูตรอาหาร, ต้นทุนวัตถุดิบ, รับเข้า/เบิกใช้, ของเสีย, ตรวจนับสต็อก, หักวัตถุดิบเมื่อขาย |
| 3 — QR & Integrations | ลูกค้าสแกน QR สั่งที่โต๊ะ, ระบบคิว/จอครัว, ยืนยัน PromptPay ผ่าน Payment Gateway (Delivery ยังพักไว้) |
| 4 — Multi-branch & CRM | สำนักงานใหญ่, ราคา/เมนูกลาง, สมาชิก แต้ม ระดับ กระเป๋าเงินเติมเงิน |
| 5 — Magic AI | Dashboard ขั้นสูง, คาดการณ์ยอดขาย/วัตถุดิบ, สรุปสาเหตุจากข้อมูลจริง |

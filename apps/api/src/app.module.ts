import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { Public } from './auth/auth.types';
import { BranchesController } from './branches/branches.controller';
import { CatalogController } from './catalog/catalog.controller';
import { dataSourceOptions } from './data-source';
import { ALL_ENTITIES } from './entities';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { OrdersController, SyncController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { ReportsController } from './reports/reports.controller';
import { ShiftsController } from './shifts/shifts.controller';
import { ShiftsService } from './shifts/shifts.service';
import { TablesController } from './tables/tables.controller';
import { UsersController } from './users/users.controller';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true, time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      // อ่าน DATABASE_URL / DB_SYNC จาก env — ถ้าไม่ได้เปิด DB_SYNC จะรัน migration ที่ค้างอัตโนมัติตอนเริ่ม
      useFactory: () => dataSourceOptions(),
    }),
    TypeOrmModule.forFeature(ALL_ENTITIES),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const secret = cfg.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 24 || secret.startsWith('change-me')) {
          throw new Error('JWT_SECRET สั้นเกินไปหรือยังเป็นค่าตัวอย่าง — ตั้งค่าใหม่เป็นสตริงสุ่มยาวอย่างน้อย 24 ตัวอักษร');
        }
        return { secret, signOptions: { expiresIn: cfg.get('JWT_EXPIRES_IN') ?? '12h' } as never };
      },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    BranchesController,
    CatalogController,
    TablesController,
    UsersController,
    ShiftsController,
    OrdersController,
    SyncController,
    ReportsController,
    InventoryController,
  ],
  providers: [AuthService, ShiftsService, InventoryService, OrdersService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}

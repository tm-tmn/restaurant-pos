import { CallHandler, ExecutionContext, Injectable, NestInterceptor, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Observable } from 'rxjs';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/auth.types';
import { runWithContext } from './tenant-context';
import { installTenantGuard } from './tenant-db';

/**
 * ให้ handler ของแต่ละคำขอรันในบริบทร้านของผู้ใช้ที่ล็อกอิน (ตั้งโดย AuthGuard)
 * คำขอสาธารณะ (ไม่ล็อกอิน) เริ่มแบบไม่มีร้าน — service ต้องแปลงโทเค็นเป็นร้านเองด้วย runAsTenant
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    return new Observable((sub) => {
      // เรียก handler ภายใน AsyncLocalStorage.run เพื่อให้ทุก await ต่อจากนี้เห็นร้านเดียวกัน
      const s = runWithContext({ tenantId: user?.tenantId }, () => next.handle().subscribe(sub));
      return () => s.unsubscribe();
    });
  }
}

/** ติดตั้งตัวตั้งค่า role/ร้าน บน connection pool หลังฐานข้อมูลพร้อม (migration รันเสร็จแล้ว) */
@Injectable()
export class TenantDbSetup implements OnModuleInit {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}
  onModuleInit() {
    installTenantGuard(this.ds);
  }
}

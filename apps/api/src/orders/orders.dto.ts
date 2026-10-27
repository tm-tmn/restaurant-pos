import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_BILL_SATANG, MAX_UNIT_PRICE_SATANG } from '../common/money';
import type { OrderType, PaymentMethod } from '../entities';

export class ItemInputDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(99) qty: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class CreateOrderDto {
  /** UUID ที่เครื่องสร้าง — ส่งซ้ำได้ ไม่เกิดบิลซ้ำ */
  @IsUUID() clientId: string;
  @IsIn(['dine_in', 'takeaway']) type: OrderType;
  @IsOptional() @IsUUID() tableId?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ItemInputDto)
  items: ItemInputDto[];
}

export class AddItemsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ItemInputDto)
  items: ItemInputDto[];
}

export class PaymentDto {
  @IsIn(['cash', 'promptpay', 'card']) method: PaymentMethod;
  @IsInt() @Min(1) @Max(MAX_BILL_SATANG) amountSatang: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_BILL_SATANG) receivedSatang?: number;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class PayOrderDto {
  @IsOptional() @IsInt() @Min(0) @Max(MAX_BILL_SATANG) discountSatang?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => PaymentDto)
  payments: PaymentDto[];
}

export class VoidDto {
  @IsString() @MinLength(3, { message: 'ต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร' }) @MaxLength(200) reason: string;
}

/** รายการสินค้าในออเดอร์ที่ขายตอน offline: ใช้ราคา snapshot จากเครื่อง ณ ตอนขาย */
export class SyncItemDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsInt() @Min(0) @Max(MAX_UNIT_PRICE_SATANG) unitPriceSatang: number;
  @IsInt() @Min(1) @Max(99) qty: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class SyncOrderDto {
  @IsUUID() clientId: string;
  @IsIn(['dine_in', 'takeaway']) type: OrderType;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  /** เวลาที่ขายจริงบนเครื่อง POS */
  @IsDateString() occurredAt: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_BILL_SATANG) discountSatang?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SyncItemDto)
  items: SyncItemDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => PaymentDto)
  payments: PaymentDto[];
}

export class SyncBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => SyncOrderDto)
  orders: SyncOrderDto[];
}

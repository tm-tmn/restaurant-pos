import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class CustomerItemDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(20) qty: number;
  @IsOptional() @IsString() @MaxLength(100) note?: string;
}

export class CustomerOrderDto {
  /** UUID ที่เบราว์เซอร์สร้างต่อการกดสั่งหนึ่งครั้ง — ส่งซ้ำได้ ไม่เกิดรายการซ้ำ */
  @IsUUID() submissionId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CustomerItemDto)
  items: CustomerItemDto[];
}

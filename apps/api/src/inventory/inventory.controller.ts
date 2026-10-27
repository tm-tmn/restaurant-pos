import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
import { Repository } from 'typeorm';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Roles } from '../auth/auth.types';
import { BaseUnit, Ingredient, MovementType } from '../entities';
import { InventoryService } from './inventory.service';

const MAX_QTY = 10_000_000; // 10 ตัน/10,000 ลิตร ต่อรายการ — กันพิมพ์เกิน

class IngredientDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsIn(['g', 'ml', 'pcs']) unit: BaseUnit;
  @IsOptional() @IsString() @MaxLength(50) sku?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_QTY) reorderLevel?: number;
}
class UpdateIngredientDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(50) sku?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_QTY) reorderLevel?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class QtyItem {
  @IsUUID() ingredientId: string;
  @IsInt() @Min(1) @Max(MAX_QTY) qty: number;
}
class ReceiveItem extends QtyItem {
  /** ราคาที่จ่ายจริงทั้งรายการ (สตางค์) */
  @IsInt() @Min(0) @Max(100_000_000_00) totalCostSatang: number;
  @IsOptional() @IsDateString() expiryDate?: string;
}
class ReceiveDto {
  @IsOptional() @IsString() @MaxLength(100) supplier?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReceiveItem) items: ReceiveItem[];
}
class ConsumeDto {
  @IsString() @MinLength(2, { message: 'ต้องระบุเหตุผล' }) @MaxLength(200) reason: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => QtyItem) items: QtyItem[];
}
class TransferDto {
  @IsUUID() toBranchId: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => QtyItem) items: QtyItem[];
}
class CountLine {
  @IsUUID() ingredientId: string;
  @IsInt() @Min(0) @Max(MAX_QTY) countedQty: number;
}
class CountDto {
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CountLine) lines: CountLine[];
}
class RecipeLine {
  @IsUUID() ingredientId: string;
  @IsInt() @Min(1) @Max(100_000) qty: number;
}
class RecipeDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RecipeLine) items: RecipeLine[];
}
class MovementQuery {
  @IsOptional() @IsUUID() ingredientId?: string;
  @IsOptional() @IsIn(['receive', 'issue', 'waste', 'transfer_out', 'transfer_in', 'sale', 'adjust']) type?: MovementType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

@Roles('manager')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inv: InventoryService,
    @InjectRepository(Ingredient) private readonly ingredients: Repository<Ingredient>,
  ) {}

  // ----- วัตถุดิบ -----
  @Get('ingredients')
  listIngredients() {
    return this.ingredients.find({ order: { active: 'DESC', name: 'ASC' } });
  }

  @Post('ingredients')
  async createIngredient(@Body() dto: IngredientDto) {
    if (await this.ingredients.existsBy({ name: dto.name.trim() })) throw new BadRequestException('มีวัตถุดิบชื่อนี้แล้ว');
    return this.ingredients.save(this.ingredients.create({ ...dto, name: dto.name.trim(), sku: dto.sku || null }));
  }

  @Patch('ingredients/:id')
  async updateIngredient(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIngredientDto) {
    const i = await this.ingredients.findOneBy({ id });
    if (!i) throw new NotFoundException();
    // ไม่อนุญาตให้เปลี่ยนหน่วยฐาน เพราะประวัติและสูตรทั้งหมดอ้างอิงหน่วยเดิม
    Object.assign(i, { ...dto, ...(dto.name ? { name: dto.name.trim() } : {}), ...('sku' in dto ? { sku: dto.sku || null } : {}) });
    return this.ingredients.save(i);
  }

  // ----- คงเหลือ / ประวัติ -----
  @Get('levels')
  levels(@CurrentUser() u: AuthUser) {
    return this.inv.levels(u);
  }

  @Get('movements')
  movements(@CurrentUser() u: AuthUser, @Query() q: MovementQuery) {
    return this.inv.movements(u, q);
  }

  @Get('expiring')
  expiring(@CurrentUser() u: AuthUser, @Query('days') days?: string) {
    const d = Math.min(60, Math.max(0, Number(days ?? 7) || 7));
    return this.inv.expiring(u, d);
  }

  // ----- การเคลื่อนไหวสต็อก -----
  @Post('receive')
  receive(@CurrentUser() u: AuthUser, @Body() dto: ReceiveDto) {
    return this.inv.receive(u, dto);
  }

  @Post('issue')
  issue(@CurrentUser() u: AuthUser, @Body() dto: ConsumeDto) {
    return this.inv.consume(u, 'issue', dto);
  }

  @Post('waste')
  waste(@CurrentUser() u: AuthUser, @Body() dto: ConsumeDto) {
    return this.inv.consume(u, 'waste', dto);
  }

  @Post('transfer')
  transfer(@CurrentUser() u: AuthUser, @Body() dto: TransferDto) {
    return this.inv.transfer(u, dto);
  }

  @Post('counts')
  count(@CurrentUser() u: AuthUser, @Body() dto: CountDto) {
    return this.inv.count(u, dto);
  }

  // ----- สูตรอาหาร / ต้นทุน -----
  @Get('costing')
  costing(@CurrentUser() u: AuthUser) {
    return this.inv.costing(u);
  }

  @Get('recipes/:productId')
  getRecipe(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.inv.getRecipe(productId);
  }

  @Put('recipes/:productId')
  setRecipe(@CurrentUser() u: AuthUser, @Param('productId', ParseUUIDPipe) productId: string, @Body() dto: RecipeDto) {
    return this.inv.setRecipe(u, productId, dto.items);
  }
}

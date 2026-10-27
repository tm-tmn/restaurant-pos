import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { Roles } from '../auth/auth.types';
import { Category, Product } from '../entities';

class CategoryDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
class ProductDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsInt() @Min(0) priceSatang: number;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsInt() @Min(0) priceSatang?: number;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller('catalog')
export class CatalogController {
  constructor(
    @InjectRepository(Category) private readonly cats: Repository<Category>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  /** เมนูทั้งหมดที่ขายได้ — เครื่อง POS ดึงไปแคชไว้ใช้ตอนออฟไลน์ */
  @Get('menu')
  async menu() {
    const [categories, products] = await Promise.all([
      this.cats.find({ where: { active: true }, order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.products.find({ where: { active: true }, order: { sortOrder: 'ASC', name: 'ASC' } }),
    ]);
    return { categories, products, fetchedAt: new Date().toISOString() };
  }

  /** รายการทั้งหมดรวมที่ปิดการขาย (สำหรับหน้าจัดการเมนู) */
  @Roles('manager')
  @Get('manage')
  async manage() {
    const [categories, products] = await Promise.all([
      this.cats.find({ order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.products.find({ order: { sortOrder: 'ASC', name: 'ASC' } }),
    ]);
    return { categories, products };
  }

  @Roles('manager')
  @Post('categories')
  createCategory(@Body() dto: CategoryDto) {
    return this.cats.save(this.cats.create(dto));
  }

  @Roles('manager')
  @Patch('categories/:id')
  async updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    const c = await this.cats.findOneBy({ id });
    if (!c) throw new NotFoundException();
    return this.cats.save(Object.assign(c, dto));
  }

  @Roles('manager')
  @Post('products')
  createProduct(@Body() dto: ProductDto) {
    return this.products.save(this.products.create({ ...dto, sku: dto.sku || null, barcode: dto.barcode || null }));
  }

  @Roles('manager')
  @Patch('products/:id')
  async updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    const p = await this.products.findOneBy({ id });
    if (!p) throw new NotFoundException();
    const patch = { ...dto } as Partial<Product>;
    if ('sku' in dto) patch.sku = dto.sku || null;
    if ('barcode' in dto) patch.barcode = dto.barcode || null;
    return this.products.save(Object.assign(p, patch));
  }
}

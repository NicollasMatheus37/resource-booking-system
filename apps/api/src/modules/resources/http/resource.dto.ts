import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateResourceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @IsIn(['EXCLUSIVE', 'SHARED'])
  kind!: 'EXCLUSIVE' | 'SHARED';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitsPerSlot!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUnitsPerUser!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxSlotsPerReservation!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seats?: number | null;
}

export class UpdateResourceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUnitsPerUser?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxSlotsPerReservation?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seats?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

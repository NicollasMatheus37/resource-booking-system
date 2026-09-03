import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  resourceId!: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(48)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  slotIds!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;
}

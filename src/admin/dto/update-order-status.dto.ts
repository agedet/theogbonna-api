import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { order_status } from '@prisma/client';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: order_status })
  @IsEnum(order_status)
  status: order_status;
}

import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const PAYMENT_STATUSES = ['PENDING', 'SUCCESS', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export class UpdatePaymentStatusDto {
  @ApiProperty({ enum: PAYMENT_STATUSES })
  @IsString()
  @IsIn(PAYMENT_STATUSES)
  status: PaymentStatus;
}

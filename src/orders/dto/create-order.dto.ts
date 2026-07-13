import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { DeliveryOption } from '@prisma/client';

export class CreateOrderDto {
  @IsString()
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsInt()
  @Min(1)
  @Max(10)
  quantity: number;

  @IsEnum(DeliveryOption)
  deliveryOption: DeliveryOption;

  /** Required for any non-PICKUP delivery */
  @ValidateIf((o) => o.deliveryOption !== DeliveryOption.PICKUP)
  @IsString()
  deliveryAddress: string;

  @ValidateIf((o) => o.deliveryOption !== DeliveryOption.PICKUP)
  @IsString()
  deliveryState: string;

  /** Buyer submits their payment reference after bank transfer */
  @IsOptional()
  @IsString()
  paymentRef?: string;
}

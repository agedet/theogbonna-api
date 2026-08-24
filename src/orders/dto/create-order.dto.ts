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
import { delivery_option } from '@prisma/client';

export class CreateOrderDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

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

  @IsEnum(delivery_option)
  deliveryOption: delivery_option;

  /** Required for any non-PICKUP delivery */
  @ValidateIf((o) => o.deliveryOption !== delivery_option.PICKUP)
  @IsString()
  deliveryAddress: string;

  @ValidateIf((o) => o.deliveryOption !== delivery_option.PICKUP)
  @IsString()
  deliveryState: string;

  /** Buyer submits their payment reference after bank transfer */
  @IsOptional()
  @IsString()
  paymentRef?: string;

  /** Product type determines unit price. Defaults to womens asoebi if not sent. */
  @IsOptional()
  @IsString()
  productType?: string;
}

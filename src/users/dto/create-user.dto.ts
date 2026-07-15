// import { ApiProperty } from "@nestjs/swagger";
import { role } from "@prisma/client";

export class CreateUserDto {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  job_title: string;
  password: string;
  role?: role;
  otp_count?: number;
  otp_generated_at?: Date | null;
  email_confirmed_at?: Date | null;
  last_sign_in_at?: Date | null;
}

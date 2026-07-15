export interface UserEntity {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  job_title?: string;
  password: string;
  role: string;
  otp_count?: number;
  otp_generated_at?: Date | null;
  status?: string;
  created_at: Date | null;
  updated_at: Date | null;
  deleted_at: Date | null;
  is_anonymous?: boolean;
  instance_id?: string;
  email_confirmed_at: Date | null;
  last_sign_in_at?: Date | null;
}
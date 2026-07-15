export interface ValidatedUser {
    id: string;
    email: string;
    created_at?: Date;
    updated_at?: Date;
}

export interface DatabaseUser {
  id: string;
  email: string | null;
  encrypted_password?: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
}
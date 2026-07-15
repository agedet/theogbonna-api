export interface AuthResponse {
  user: {
    id?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
  };
  accessToken?: string;
  refreshToken?: string;
  message: string;
}

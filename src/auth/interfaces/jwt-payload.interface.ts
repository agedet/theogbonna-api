export interface JwtPayload {
  user: {
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
  };
}

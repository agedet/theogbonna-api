import { role } from '@prisma/client';

// Augment Express Request so req.user is typed throughout the codebase
declare global {
  namespace Express {
    interface User {
      id:        string;
      email:     string;
      role:      role;
      companyId: string | null;
      firstName?: string | null;
      lastName?:  string | null;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};

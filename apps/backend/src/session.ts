import { UnauthorizedException } from "@nestjs/common";
import type { AuthService } from "./auth/auth.service";

/** The NEAR account behind a "Bearer <session token>" header. */
export async function sessionAccount(auth: AuthService, authorization?: string): Promise<string> {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) throw new UnauthorizedException("NO_SESSION");
  return auth.accountFor(token);
}

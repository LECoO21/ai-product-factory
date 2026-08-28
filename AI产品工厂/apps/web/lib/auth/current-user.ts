import { cookies } from "next/headers";
import {
  isFactoryAuthenticationRequired,
  SESSION_COOKIE_NAME,
  verifySessionToken
} from "./session";

export async function isCurrentRequestAuthenticated() {
  if (!isFactoryAuthenticationRequired()) return true;
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token) !== null;
}

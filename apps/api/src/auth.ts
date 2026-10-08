import { createRemoteJWKSet, jwtVerify } from "jose";
import { uuidSchema } from "@daymark/contracts";

export function createJwtVerifier(jwksUrl: URL, issuer: string) {
  const jwks = createRemoteJWKSet(jwksUrl);
  return async (token: string): Promise<string | null> => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
      });
      if (payload.role !== "authenticated") return null;
      const parsed = uuidSchema.safeParse(payload.sub);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
}

/** Supabase Auth's signed session token identifies the canonical owner UUID. */
export function createSupabaseVerifier(projectUrl: string) {
  const base = new URL(projectUrl);
  if (base.protocol !== "https:")
    throw new Error("SUPABASE_URL must use HTTPS");
  const issuer = new URL("/auth/v1", base).toString().replace(/\/$/, "");
  return createJwtVerifier(new URL(`${issuer}/.well-known/jwks.json`), issuer);
}

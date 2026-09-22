import Fastify from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, it } from "vitest";
import { createJwtVerifier } from "./auth.js";

it("accepts only signed authenticated tokens with the expected issuer, audience, and UUID subject", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  const jwksServer = Fastify();
  jwksServer.get("/jwks", async () => ({
    keys: [{ ...publicJwk, kid: "test-key", alg: "ES256", use: "sig" }],
  }));
  const address = await jwksServer.listen({ host: "127.0.0.1", port: 0 });
  const issuer = `${address}/auth/v1`;
  const verify = createJwtVerifier(new URL(`${address}/jwks`), issuer);
  const owner = "11111111-1111-4111-8111-111111111111";
  const sign = (claims: {
    sub: string;
    aud: string;
    role: string;
    iss: string;
  }) =>
    new SignJWT({ role: claims.role })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject(claims.sub)
      .setAudience(claims.aud)
      .setIssuer(claims.iss)
      .setExpirationTime("1h")
      .sign(privateKey);
  try {
    expect(
      await verify(
        await sign({
          sub: owner,
          aud: "authenticated",
          role: "authenticated",
          iss: issuer,
        }),
      ),
    ).toBe(owner);
    expect(
      await verify(
        await sign({
          sub: owner,
          aud: "wrong",
          role: "authenticated",
          iss: issuer,
        }),
      ),
    ).toBeNull();
    expect(
      await verify(
        await sign({
          sub: owner,
          aud: "authenticated",
          role: "anon",
          iss: issuer,
        }),
      ),
    ).toBeNull();
    expect(
      await verify(
        await sign({
          sub: "not-a-uuid",
          aud: "authenticated",
          role: "authenticated",
          iss: issuer,
        }),
      ),
    ).toBeNull();
    expect(
      await verify(
        await sign({
          sub: owner,
          aud: "authenticated",
          role: "authenticated",
          iss: "other",
        }),
      ),
    ).toBeNull();
  } finally {
    await jwksServer.close();
  }
});

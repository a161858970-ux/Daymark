// Supabase Edge Function — Send SMS hook → Aliyun PNVS `SendSmsVerifyCode`.
//
// Product decision (2026-09-28): mainland-China-only phone login.
// Supabase Auth generates and verifies the OTP itself; this function only
// delivers it. Aliyun's Phone Number Verification Service is used because
// it ships a **complimentary signature + template** (no enterprise
// qualification, no template review) and its `TemplateParam` accepts an
// explicit code (`{"code":"123456"}`), so Supabase's OTP is forwarded
// verbatim instead of asking Aliyun to mint one.
//
// Secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET   RAM key with dypns:SendSmsVerifyCode
//   PNVS_SIGN_NAME        complimentary signature from the PNVS console
//   PNVS_TEMPLATE_CODE    complimentary template paired with that signature
//   PNVS_TEMPLATE_PARAM_KEY   template variable holding the code (default "code")
//   PNVS_TEMPLATE_MIN_KEY     optional variable holding the validity minutes (default "min")
//   PNVS_TEMPLATE_MIN         minutes to render (default "5")
//   SEND_SMS_WEBHOOK_SECRET   Standard Webhooks secret of the Send SMS hook (optional but recommended)

const ENDPOINT = "https://dypnsapi.aliyuncs.com/";
const ACTION = "SendSmsVerifyCode";
const VERSION = "2017-05-25";

interface HookPayload {
  user?: { phone?: string };
  sms?: { otp?: string };
  phone?: string;
  otp?: string;
}

/** RFC3986 encoding with Aliyun's extra rules (+ → %20, * → %2A, ~ stays). */
function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Aliyun RPC V1 signature: POST&%2F& + percent-encoded canonical query. */
export async function signRpc(
  params: Record<string, string>,
  accessKeySecret: string,
): Promise<string> {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join("&");
  const stringToSign = `POST&%2F&${encode(canonical)}`;
  return hmacSha1Base64(`${accessKeySecret}&`, stringToSign);
}

/**
 * Standard Webhooks verification (webhook-timestamp.webhook-signature over
 * the raw body). Skipped when no secret is configured so the hook still
 * works while the endpoint is being brought up.
 */
async function verifyWebhook(
  rawBody: string,
  headers: Headers,
): Promise<boolean> {
  const secret = Deno.env.get("SEND_SMS_WEBHOOK_SECRET");
  if (!secret) return true;
  const timestamp = headers.get("webhook-timestamp");
  const signatures = (headers.get("webhook-signature") ?? "").split(" ");
  if (!timestamp || signatures.length === 0) return false;
  const material = secret.startsWith("v1,") ? secret.slice(3) : secret;
  const key = material.startsWith("whsec_")
    ? atob(material.slice("whsec_".length))
    : material;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  const expected = btoa(binary);
  return signatures.some((candidate) => {
    const value = candidate.trim().replace(/^v1,/, "");
    return (
      value.length === expected.length &&
      value.split("").every((char, index) => char === expected[index])
    );
  });
}

Deno.serve(async (request) => {
  const rawBody = await request.text();
  if (!(await verifyWebhook(rawBody, request.headers))) {
    console.error("send-sms: webhook signature rejected");
    return new Response(JSON.stringify({ error: "bad signature" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Shape tolerance: official docs use {user:{phone}, sms:{otp}}; some
  // deployments flatten it. Never log the OTP.
  const phone = payload.user?.phone ?? payload.phone ?? "";
  const otp = payload.sms?.otp ?? payload.otp ?? "";
  const e164 = /^\+86(1\d{10})$/.exec(phone.trim());
  if (!e164 || !/^\d{4,8}$/.test(otp)) {
    console.error(
      `send-sms: unusable payload phone=${phone ? "set" : "missing"} otp=${
        otp ? "set" : "missing"
      }`,
    );
    return new Response(JSON.stringify({ error: "unusable payload" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const accessKeyId = Deno.env.get("ALIYUN_ACCESS_KEY_ID") ?? "";
  const accessKeySecret = Deno.env.get("ALIYUN_ACCESS_KEY_SECRET") ?? "";
  const signName = Deno.env.get("PNVS_SIGN_NAME") ?? "";
  const templateCode = Deno.env.get("PNVS_TEMPLATE_CODE") ?? "";
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    console.error("send-sms: missing configuration");
    return new Response(JSON.stringify({ error: "not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const codeKey = Deno.env.get("PNVS_TEMPLATE_PARAM_KEY") || "code";
  const minKey = Deno.env.get("PNVS_TEMPLATE_MIN_KEY") ?? "min";
  const minutes = Deno.env.get("PNVS_TEMPLATE_MIN") || "5";
  const templateParam: Record<string, string> = { [codeKey]: otp };
  if (minKey) templateParam[minKey] = minutes;

  const params: Record<string, string> = {
    Action: ACTION,
    Version: VERSION,
    Format: "JSON",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    RegionId: Deno.env.get("ALIYUN_REGION_ID") || "cn-hangzhou",
    CountryCode: "86",
    PhoneNumber: e164[1],
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify(templateParam),
  };
  params.Signature = await signRpc(params, accessKeySecret);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const result = (await response.json().catch(() => ({}))) as {
    Code?: string;
    Message?: string;
    BizId?: string;
  };
  if (result.Code !== "OK") {
    // Aliyun error codes are safe to surface; the OTP is not.
    console.error(
      `send-sms: aliyun rejected code=${result.Code ?? response.status} message=${
        result.Message ?? "unknown"
      }`,
    );
    return new Response(
      JSON.stringify({ error: result.Code ?? "provider_error" }),
      {
        status: 502,
        headers: { "content-type": "application/json" },
      },
    );
  }
  console.log(`send-sms: delivered biz=${result.BizId ?? "-"}`);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

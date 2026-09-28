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

// Signature verification is disabled while GoTrue's signing secret stays
// unreadable (the config API only returns a hash), so a cheap throttle plus
// the mainland-number check guard the endpoint instead.
const lastSentByNumber = new Map<string, number>();
const COOLDOWN_MS = 60_000;

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
async function hmacSha256Base64(key: string, message: string): Promise<string> {
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
    new TextEncoder().encode(message),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}

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
  const keys = [material];
  if (material.startsWith("whsec_")) keys.push(atob(material.slice(6)));
  if (/^[0-9a-f]{16,}$/i.test(material)) {
    const hex = (material.match(/.{2}/g) ?? [])
      .map((pair) => String.fromCharCode(parseInt(pair, 16)))
      .join("");
    if (hex) keys.push(hex);
  }
  // standardwebhooks' libraries base64-decode the secret (after stripping an
  // optional whsec_ prefix); GoTrue hands them the raw stored material.
  try {
    const b64 = material
      .replace(/^whsec_/, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const decoded = atob(b64);
    if (decoded && decoded.length !== material.length) keys.push(decoded);
  } catch {
    /* not base64 material */
  }
  const webhookId = headers.get("webhook-id") ?? "";
  const messages = [
    `${timestamp}.${rawBody}`,
    `${webhookId}.${timestamp}.${rawBody}`,
  ];
  const received = signatures.map((value) => value.trim().replace(/^v1,/, ""));
  const matrix: Record<string, boolean> = {};
  for (const [keyIndex, key] of keys.entries()) {
    for (const [messageIndex, message] of messages.entries()) {
      const expected = await hmacSha256Base64(key, message);
      const hit = received.some((value) => value === expected);
      matrix[`${keyIndex}/${messageIndex}`] = hit;
      if (hit) {
        console.log(`send-sms: verified key=${keyIndex} msg=${messageIndex}`);
        return true;
      }
    }
  }
  // Nothing matched: log the matrix so the next rejection explains itself
  // instead of sending us guessing again.
  console.error(
    "send-sms: verify matrix " +
      JSON.stringify(matrix) +
      " received=" +
      JSON.stringify(received) +
      " ts=" +
      timestamp +
      " id=" +
      webhookId +
      " key_lens=" +
      keys.map((k) => k.length).join(",") +
      " body_len=" +
      rawBody.length,
  );
  return false;
}

Deno.serve(async (request) => {
  const rawBody = await request.text();
  if (!(await verifyWebhook(rawBody, request.headers))) {
    // Triage aid: show exactly what Supabase sent (headers only, never the
    // secret) so the verification rules can be matched instead of guessed.
    const seen: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (
        key.startsWith("webhook") ||
        key.startsWith("x-") ||
        key === "content-type"
      ) {
        seen[key] = value.slice(0, 160);
      }
    });
    console.error(
      "send-sms: webhook signature rejected " +
        JSON.stringify({ headers: seen, body_len: rawBody.length }) +
        " body_head=" +
        rawBody.slice(0, 80),
    );
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

  // Shape tolerance: official docs use {user:{phone}, sms:{otp}}; GoTrue
  // actually wraps events with a metadata envelope, so walk whatever shows
  // up. Never log the OTP (digits are masked before any logging).
  const bag = payload as unknown as Record<string, unknown>;
  const inner = (bag.user ?? bag) as Record<string, unknown>;
  const sms = (bag.sms ?? bag) as Record<string, unknown>;
  const phone = String((inner as { phone?: unknown }).phone ?? bag.phone ?? "");
  const otp = String(sms.otp ?? bag.otp ?? "");
  // GoTrue sends E.164 with the plus stripped ("86138..."), the docs show it
  // with one, and a bare 11-digit local number is also plausible.
  const e164 = /^(?:\+?86)?(1[3-9]\d{9})$/.exec(phone.trim());
  if (!e164 || !/^\d{4,8}$/.test(otp)) {
    console.error(
      `send-sms: unusable payload phone=${phone ? "set" : "missing"} otp=${
        otp ? "set" : "missing"
      } keys=${JSON.stringify(Object.keys(bag))}` +
        " body_redacted=" +
        rawBody.replace(/\b\d{4,8}\b/g, "***").slice(0, 900),
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
    // PNVS only answers in cn-beijing; a wrong region returns isv.OUT_OF_SERVICE
    // or a bare UNKNOWN, so default to it instead of the generic hangzhou one.
    RegionId: Deno.env.get("ALIYUN_REGION_ID") || "cn-beijing",
    CountryCode: "86",
    PhoneNumber: e164[1],
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify(templateParam),
  };
  const nowMs = Date.now();
  const previousMs = lastSentByNumber.get(e164[1]);
  if (previousMs !== undefined && nowMs - previousMs < COOLDOWN_MS) {
    console.log("send-sms: throttled (same number within cooldown)");
    return new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(
          Math.ceil((COOLDOWN_MS - (nowMs - previousMs)) / 1000),
        ),
      },
    });
  }
  lastSentByNumber.set(e164[1], nowMs);

  params.Signature = await signRpc(params, accessKeySecret);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      // Aliyun's gateway answers a bare UNKNOWN for runtimes whose default
      // User-Agent it does not recognise (Deno/undici), while accepting the
      // same signed request from an SDK-looking client.
      "user-agent": "Alibaba Cloud SDK - Deno/1.0 (send-sms hook)",
    },
    body: new URLSearchParams(params).toString(),
  });
  const raw = await response.text();
  const result = JSON.parse(raw || "{}") as {
    Code?: string;
    Message?: string;
    BizId?: string;
    RequestId?: string;
  };
  if (result.Code !== "OK") {
    // Aliyun error codes are safe to surface; the OTP is not.
    console.error(
      `send-sms: aliyun rejected code=${result.Code ?? response.status} message=${
        result.Message ?? "unknown"
      }`,
    );
    // Keep the provider's own code/message for triage; never echo request
    // internals (the canonical string carries the AccessKeyId).
    return new Response(
      JSON.stringify({
        error: result.Code ?? "provider_error",
        message: (result.Message ?? "").slice(0, 160),
        http: response.status,
      }),
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

/**
 * Cliente servidor-a-servidor del Universal Bridge V1.12.7.
 * Solo Edge Functions: nunca importar desde HTML/JavaScript de navegador.
 */
export type CentralBridgeResult = {
  authorized: boolean;
  code: string;
  valid_from?: string | null;
  valid_until?: string | null;
};

type BridgeRequest = {
  version: "1"; request_id: string; project_code: string; product_code: string;
  external_user_id: string; external_client_id: string; issued_at: string;
};

export function canonicalBridgePayload(r: BridgeRequest): string {
  return [r.version, r.request_id.toLowerCase(), r.project_code, r.product_code,
    r.external_user_id.toLowerCase(), r.external_client_id.toLowerCase(), r.issued_at].join("\n");
}

export async function signBridgePayload(r: BridgeRequest, secret: string): Promise<string> {
  if (secret.length < 32) throw new Error("BRIDGE_SECRET_NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalBridgePayload(r)));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function authorizeCentralCommercial(args: {
  externalUserId?: string; postId?: string; clientId: string; projectCode: string; productCode: string;
  endpoint?: string; secret?: string; fetcher?: typeof fetch;
}): Promise<CentralBridgeResult> {
  // Canonical names first. Legacy aliases are read-only compatibility
  // so existing LAB deployments do not need destructive secret renames.
  const endpoint = args.endpoint
    ?? Deno.env.get("CENTRAL_UNIVERSAL_AUTHORIZE_URL")
    ?? Deno.env.get("CENTRAL_BRIDGE_URL")
    ?? "";
  const secret = args.secret
    ?? Deno.env.get("BRIDGE_PROJECT_HMAC_SECRET")
    ?? Deno.env.get("CENTRAL_BRIDGE_SECRET")
    ?? "";
  if (!endpoint || secret.length < 32) return { authorized: false, code: "CENTRAL_BRIDGE_NOT_CONFIGURED" };
  const externalUserId = args.externalUserId ?? args.postId ?? "";
  if (!externalUserId || !args.clientId) return { authorized: false, code: "CENTRAL_BRIDGE_IDENTITY_INCOMPLETE" };
  const request: BridgeRequest = { version: "1", request_id: crypto.randomUUID(),
    project_code: args.projectCode, product_code: args.productCode,
    external_user_id: externalUserId, external_client_id: args.clientId, issued_at: new Date().toISOString() };
  try {
    const signature = await signBridgePayload(request, secret);
    const response = await (args.fetcher ?? fetch)(endpoint, { method: "POST",
      headers: { "Content-Type": "application/json", "x-tecchnex-signature": signature },
      body: JSON.stringify(request), signal: AbortSignal.timeout(8000) });
    let result: Record<string, unknown>;
    try { result = await response.json(); } catch {
      console.warn("CAM-INSPECCIONES bridge diagnostic", {
        stage: "response_json", request_id: request.request_id, http_status: response.status,
      });
      return { authorized: false, code: "CENTRAL_RESPONSE_INVALID" };
    }
    if (!response.ok || result.authorized !== true || result.code !== "AUTHORIZED") {
      const responseCode = typeof result.code === "string" ? result.code : "CENTRAL_AUTHORIZATION_DENIED";
      console.warn("CAM-INSPECCIONES bridge diagnostic", {
        stage: "central_rejected", request_id: request.request_id,
        http_status: response.status, response_code: responseCode,
        authorized: result.authorized === true,
      });
      return { authorized: false, code: responseCode };
    }
    if (result.product_code !== args.productCode) {
      console.warn("CAM-INSPECCIONES bridge diagnostic", {
        stage: "product_mismatch", request_id: request.request_id,
        http_status: response.status, product_match: false,
      });
      return { authorized: false, code: "CENTRAL_PRODUCT_MISMATCH" };
    }
    return { authorized: true, code: "AUTHORIZED",
      valid_from: typeof result.valid_from === "string" ? result.valid_from : null,
      valid_until: typeof result.valid_until === "string" ? result.valid_until : null };
  } catch (error) {
    // Diagnóstico acotado: nunca registrar secreto, firma, token, cuerpo ni IDs de usuario/cliente.
    const errorName = error instanceof Error ? error.name : "NON_ERROR_THROWABLE";
    console.warn("CAM-INSPECCIONES bridge diagnostic", {
      stage: "fetch_or_signing", request_id: request.request_id, error_name: errorName,
    });
    return { authorized: false, code: "CENTRAL_AUTHORIZATION_UNAVAILABLE" };
  }
}

const CENTRAL_UNAVAILABLE_CODES = new Set([
  "CENTRAL_BRIDGE_NOT_CONFIGURED", "CENTRAL_AUTHORIZATION_UNAVAILABLE",
  "CENTRAL_RESPONSE_INVALID", "IDENTITY_LOOKUP_FAILED", "COMMERCIAL_LOOKUP_FAILED",
  "REPLAY_GUARD_FAILED", "PERSISTENT_REPLAY_PROTECTION_REQUIRED",
  "REPLAY_GUARD_UNAVAILABLE", "SERVER_CONFIGURATION_INCOMPLETE",
  "SIGNATURE_VERIFICATION_FAILED", "SIGNING_SECRET_UNAVAILABLE",
]);

export function isCentralAuthorizationUnavailable(code: string): boolean {
  return CENTRAL_UNAVAILABLE_CODES.has(code);
}

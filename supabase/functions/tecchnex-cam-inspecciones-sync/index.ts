// TECCHNEX CAM-INSPECCIONES — sincronización operativa
// Nueva función independiente. No modifica tecchnex-product-authorize ni Universal Bridge.
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY o SUPABASE_PUBLISHABLE_KEYS,
// SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SECRET_KEYS,
// CAM_INSPECCIONES_PROJECT_HMAC_SECRET y variables del Universal Bridge.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizeCentralCommercial,
  isCentralAuthorizationUnavailable,
} from "./universal-bridge-client-cam-inspecciones.ts";

const SUPABASE_URL_VALUE = Deno.env.get("SUPABASE_URL") || "";
const PRODUCT_CODE = "CAM-INSPECCIONES";
const DEFAULT_ORIGINS = ["https://gestionriesgos980-debug.github.io"];
const RECORD_TYPES = new Set([
  "inspeccion", "hallazgo", "checklist", "resultado_checklist",
  "matriz_riesgos", "matriz_cliente", "vulnerabilidad", "agenda_visita",
  "actividad_gestion", "seguimiento_proceso", "evento_trazabilidad",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 1024 * 1024;

function readSecretJson(name: string): string {
  const raw = Deno.env.get(name) || "";
  if (!raw) return "";
  try {
    const value = JSON.parse(raw)?.default;
    return typeof value === "string" ? value : "";
  } catch { return ""; }
}
const ANON = readSecretJson("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = readSecretJson("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function normalizedOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.pathname !== "/" || u.search || u.hash) return null;
    const local = u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol !== "https:" && !local) return null;
    return u.origin;
  } catch { return null; }
}
function allowedOrigin(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizedOrigin(value);
  if (!normalized) return null;
  const u = new URL(normalized);
  if (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) return normalized;
  const extras = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean);
  const allowed = [...new Set([...DEFAULT_ORIGINS, ...extras].map(normalizedOrigin).filter(Boolean))];
  return allowed.includes(normalized) ? normalized : null;
}
function responseHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  const origin = allowedOrigin(req.headers.get("Origin"));
  if (origin) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function reply(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(req) });
}
function isUuid(v: unknown): v is string { return typeof v === "string" && UUID_RE.test(v); }
function validOperation(body: Record<string, unknown>): boolean {
  if (!isUuid(body.operation_id) || !isUuid(body.authorized_client_product_id) || !isUuid(body.record_sync_id)) return false;
  if (!["INSERT", "UPDATE", "DELETE"].includes(String(body.operation_type))) return false;
  if (body.expected_version !== null && body.expected_version !== undefined &&
      (!Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 1)) return false;
  if (body.operation_type === "INSERT" && body.expected_version != null) return false;
  if (["UPDATE", "DELETE"].includes(String(body.operation_type)) && body.expected_version == null) return false;
  if (typeof body.record_type !== "string" || !RECORD_TYPES.has(body.record_type)) return false;
  if (body.parent_sync_id != null && !isUuid(body.parent_sync_id)) return false;
  if (body.record_client_product_id != null && !isUuid(body.record_client_product_id)) return false;
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return false;
   return true;
}

function validDiagnostic(body: Record<string, unknown>): boolean {
  return body.mode === "DRY_RUN" &&
    isUuid(body.authorized_client_product_id);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const corsOrigin = origin ? allowedOrigin(origin) : null;
  if (req.method === "OPTIONS") return new Response(null, { status: corsOrigin ? 204 : (origin ? 403 : 204), headers: responseHeaders(req) });
  if (origin && !corsOrigin) return reply(req, 403, { ok: false, code: "ORIGIN_DENIED" });
  if (req.method !== "POST") return reply(req, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });

  try {
    if (!SUPABASE_URL_VALUE || !ANON || !SERVICE) {
      return reply(req, 503, { ok: false, code: "SERVER_CONFIGURATION_INCOMPLETE" });
    }
    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) return reply(req, 413, { ok: false, code: "BODY_TOO_LARGE" });

    const auth = req.headers.get("Authorization") || "";
    const tokenMatch = auth.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) return reply(req, 401, { ok: false, code: "SESSION_REQUIRED" });

    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return reply(req, 413, { ok: false, code: "BODY_TOO_LARGE" });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return reply(req, 400, { ok: false, code: "INVALID_JSON" }); }
   const dryRun = body?.mode === "DRY_RUN";

if (
  !body ||
  typeof body !== "object" ||
  Array.isArray(body) ||
  (dryRun ? !validDiagnostic(body) : !validOperation(body)) ||
  (!dryRun && body.mode !== undefined)
) {
  return reply(req, 400, { ok: false, code: "INVALID_REQUEST" });
}

    const authClient = createClient(SUPABASE_URL_VALUE, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(tokenMatch[1]);
    const actorUserId = claimsData?.claims?.sub;
    if (claimsError || typeof actorUserId !== "string" || !isUuid(actorUserId)) {
      return reply(req, 401, { ok: false, code: "INVALID_SESSION" });
    }

    const admin = createClient(SUPABASE_URL_VALUE, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    // La identidad y el cliente se obtienen del JWT y de las relaciones comerciales;
    // nunca se aceptan client_id ni actor_user_id enviados por el navegador.
    const { data: memberships, error: membershipError } = await admin
      .from("tecchnex_client_users")
      .select("id, client_id")
      .eq("user_id", actorUserId)
      .eq("status", "active");
    if (membershipError) return reply(req, 503, { ok: false, code: "MEMBERSHIP_LOOKUP_FAILED" });
    if (!memberships?.length) return reply(req, 403, { ok: false, code: "NO_ACTIVE_MEMBERSHIP" });

    let authorizedClientId: string | null = null;
    let centralUnavailable = false;
    let centralDeniedCode = "CONTRACT_ACCESS_DENIED";

    for (const membership of memberships) {
      if (!isUuid(membership.id) || !isUuid(membership.client_id)) continue;
      const { data: accesses, error: accessError } = await admin
        .from("tecchnex_user_product_access")
        .select("client_product_id")
        .eq("client_user_id", membership.id)
        .eq("client_id", membership.client_id)
        .eq("status", "active");
      if (accessError) return reply(req, 503, { ok: false, code: "CONTRACT_ACCESS_LOOKUP_FAILED" });
      const contractIds = (accesses || []).map((x: any) => x.client_product_id).filter(isUuid);
      if (!contractIds.includes(body.authorized_client_product_id as string)) continue;

      const { data: contracts, error: contractError } = await admin
        .from("tecchnex_client_products")
        .select("id, client_id, product_id, start_date, end_date, status")
        .eq("id", body.authorized_client_product_id)
        .eq("client_id", membership.client_id)
        .eq("status", "active");
      if (contractError) return reply(req, 503, { ok: false, code: "CONTRACT_LOOKUP_FAILED" });
      if (!contracts?.length) continue;
      const contract = contracts[0];
      const today = new Date().toISOString().slice(0, 10);
      if (contract.start_date > today || (contract.end_date && contract.end_date < today)) continue;

      const { data: product, error: productError } = await admin
        .from("tecchnex_products")
        .select("id, code, status")
        .eq("id", contract.product_id)
        .eq("status", "active")
        .maybeSingle();
      if (productError) return reply(req, 503, { ok: false, code: "PRODUCT_LOOKUP_FAILED" });
      if (!product || product.code !== PRODUCT_CODE) continue;

      const central = await authorizeCentralCommercial({
        externalUserId: actorUserId,
        clientId: membership.client_id,
        projectCode: PRODUCT_CODE,
        productCode: PRODUCT_CODE,
       secret: Deno.env.get("CAM_INSPECCIONES_PROJECT_HMAC_SECRET") || "",
      });
      if (central.authorized) {
        authorizedClientId = membership.client_id;
        break;
      }
      if (isCentralAuthorizationUnavailable(central.code)) {
        centralUnavailable = true;
        centralDeniedCode = central.code;
        break;
      }
      centralDeniedCode = central.code;
    }

    if (!authorizedClientId) {
      if (centralUnavailable) return reply(req, 503, { ok: false, code: "LICENSE_CHECK_UNAVAILABLE" });
      return reply(req, 403, { ok: false, code: centralDeniedCode });
    }
if (dryRun) {
  return reply(req, 200, {
    ok: true,
    code: "DRY_RUN_AUTHORIZED",
    checks: {
      jwt: true,
      membership: true,
      contract: true,
      product: true,
      universal_bridge: true
    },
    write_executed: false
  });
}
    const { data: result, error: rpcError } = await admin.rpc(
      "tecchnex_cam_inspecciones_apply_sync_operation",
      {
        p_operation_id: body.operation_id,
        p_client_id: authorizedClientId,
        p_authorized_client_product_id: body.authorized_client_product_id,
        p_actor_user_id: actorUserId,
        p_record_sync_id: body.record_sync_id,
        p_operation_type: body.operation_type,
        p_expected_version: body.expected_version ?? null,
        p_record_type: body.record_type,
        p_parent_sync_id: body.parent_sync_id ?? null,
        p_record_client_product_id: body.record_client_product_id ?? null,
        p_payload: body.payload,
      },
    );
    if (rpcError) {
      console.error("CAM-INSPECCIONES sync RPC failed", { code: rpcError.code, message: rpcError.message });
      return reply(req, 503, { ok: false, code: "SYNC_PROCESSING_FAILED" });
    }
    return reply(req, result?.ok === true ? 200 : 409, result || { ok: false, code: "INVALID_RPC_RESPONSE" });
  } catch (error) {
    console.error("CAM-INSPECCIONES sync unexpected error", { name: error instanceof Error ? error.name : "UNKNOWN" });
    return reply(req, 503, { ok: false, code: "SYNC_SERVICE_UNAVAILABLE" });
  }
});

// TECCHNEX · CAM-INSPECCIONES-LICENCIA-01 · Puente de autorización de producto
// Función independiente. No reemplaza tecchnex-commercial-admin ni exige MFA AAL2 a usuarios operativos.
// Secrets requeridos: SUPABASE_URL, SUPABASE_ANON_KEY o SUPABASE_PUBLISHABLE_KEYS,
// SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SECRET_KEYS y CAM_INSPECCIONES_PROJECT_HMAC_SECRET.
// La service_role solo se usa aquí, en el servidor. Nunca incluirla en CAM-INSPECCIONES.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeCentralCommercial, isCentralAuthorizationUnavailable } from "../_shared/universal-bridge-client-cam-inspecciones.ts";

const SUPABASE_URL_VALUE = Deno.env.get("SUPABASE_URL") || "";
// Secreto exclusivo de CAM-INSPECCIONES: no reutilizar el secreto genérico de otro producto
// porque todos comparten el mismo proyecto Supabase y sus variables de entorno.
const PRODUCT_HMAC_SECRET = Deno.env.get("CAM_INSPECCIONES_PROJECT_HMAC_SECRET") || "";
function readSecretJson(name: string): string {
  const raw = Deno.env.get(name) || "";
  if (!raw) return "";
  try {
    const value = JSON.parse(raw)?.default;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}
// Prioriza las variables JSON actuales de Supabase; conserva alias heredados para compatibilidad.
const ANON = readSecretJson("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = readSecretJson("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PRODUCT_CODE = "CAM-INSPECCIONES";
const DEFAULT_ORIGINS = [
  "https://gestionriesgos980-debug.github.io",
];

function normalizedOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.pathname !== "/" || u.search || u.hash) return null;
    const localDevelopment = u.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol !== "https:" && !localDevelopment) return null;
    // En producción solo se permiten orígenes HTTPS explícitos.
    // localhost/127.0.0.1 se aceptan únicamente para desarrollo local.
    return u.origin;
  } catch {
    return null;
  }
}

function origins(): string[] {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",").map(x => x.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...extra]
    .map(normalizedOrigin).filter((x): x is string => Boolean(x)))];
}

function allowedOrigin(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizedOrigin(value);
  if (!normalized) return null;
  const u = new URL(normalized);
  const localDevelopment = u.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(u.hostname);
  return localDevelopment || origins().includes(normalized) ? normalized : null;
}

function headers(req: Request): Record<string,string> {
  const h: Record<string,string> = {
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Max-Age":"86400",
    "Vary":"Origin",
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
  };
  const allowed = allowedOrigin(req.headers.get("Origin"));
  if (allowed) h["Access-Control-Allow-Origin"] = allowed;
  return h;
}

function reply(req: Request, status: number, body: Record<string,unknown>) {
  return new Response(JSON.stringify(body), {status, headers:headers(req)});
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const corsOrigin = allowedOrigin(origin);
  // Responder al preflight antes de cualquier lógica de sesión/licencia.
  // Si el origen no está permitido, no se concede Access-Control-Allow-Origin.
  if (req.method === "OPTIONS") {
    console.log("CAM-INSPECCIONES CORS preflight", { origin, allowed: corsOrigin !== null });
    return new Response(null, {
      status: corsOrigin ? 204 : 403,
      headers: headers(req),
    });
  }
  if (origin && !corsOrigin) {
    console.warn("CAM-INSPECCIONES origin denied", { origin });
    return reply(req, 403, { ok:false, code:"ORIGIN_DENIED", message:"Origen no autorizado." });
  }
  if(req.method !== "POST") return reply(req,405,{ok:false,code:"METHOD_NOT_ALLOWED",message:"Método no permitido."});
  try {
    if (!SUPABASE_URL_VALUE || !ANON || !SERVICE || PRODUCT_HMAC_SECRET.length < 32) {
      console.error("CAM-INSPECCIONES license: server configuration incomplete");
      return reply(req, 503, { ok:false, code:"LICENSE_CHECK_UNAVAILABLE", message:"No fue posible verificar la licencia. El acceso permanece bloqueado." });
    }
    const authHeader=req.headers.get("Authorization")||"";
    const match=authHeader.match(/^Bearer\s+(.+)$/i);
    if(!match) return reply(req,401,{ok:false,code:"SESSION_REQUIRED",message:"Inicia sesión para validar la licencia."});
    const authClient=createClient(SUPABASE_URL_VALUE,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:claimsData,error:claimsError}=await authClient.auth.getClaims(match[1]);
    const userId=claimsData?.claims?.sub;
    if(claimsError || typeof userId!=="string") return reply(req,401,{ok:false,code:"INVALID_SESSION",message:"La sesión no es válida o ha vencido."});
    const admin=createClient(SUPABASE_URL_VALUE,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});

    // Todas las consultas se realizan en servidor; el navegador no recibe tablas ni privilegios.
    const {data:memberships,error:mErr}=await admin.from("tecchnex_client_users")
      .select("id, client_id, user_id, status").eq("user_id",userId).eq("status","active");
    if(mErr) { console.error("CAM-INSPECCIONES license membership lookup:",mErr.message); return reply(req,503,{ok:false,code:"LICENSE_CHECK_UNAVAILABLE",message:"No fue posible verificar la asignación. No se concedió acceso."}); }
    if(!Array.isArray(memberships)||memberships.length===0) return reply(req,403,{ok:false,code:"NO_ACTIVE_MEMBERSHIP",message:"No tienes una membresía activa para CAM-INSPECCIONES."});

    // La membresía local identifica al usuario externo y su cliente operativo.
    // La decisión comercial definitiva se resuelve en el Administrador Maestro mediante el Universal Bridge.
    for (const membership of memberships) {
      if (!membership?.id || !membership?.client_id) continue;
      const central = await authorizeCentralCommercial({
        externalUserId: String(userId),
        clientId: String(membership.client_id),
        projectCode: "CAM-INSPECCIONES",
        productCode: PRODUCT_CODE,
        secret: PRODUCT_HMAC_SECRET,
      });
      if (central.authorized) {
        return reply(req,200,{ok:true,authorized:true,product:PRODUCT_CODE,product_code:PRODUCT_CODE,client_id:membership.client_id,valid_from:central.valid_from??null,valid_until:central.valid_until??null,checked_at:new Date().toISOString()});
      }
      if (isCentralAuthorizationUnavailable(central.code)) {
        return reply(req,503,{ok:false,authorized:false,code:"LICENSE_CHECK_UNAVAILABLE",message:"No fue posible verificar la autorización central. El acceso permanece bloqueado."});
      }
      if (central.code !== "IDENTITY_NOT_LINKED") {
        return reply(req,403,{ok:false,authorized:false,code:central.code,message:"El Administrador Maestro no autorizó el acceso a CAM-INSPECCIONES."});
      }
    }
    return reply(req,403,{ok:false,code:"LICENSE_NOT_ACTIVE",message:"No existe una asignación CAM-INSPECCIONES activa y vigente para este usuario."});
  } catch(error) {
    console.error("Unexpected CAM-INSPECCIONES license error:",error);
    return reply(req,503,{ok:false,code:"LICENSE_CHECK_UNAVAILABLE",message:"No se pudo verificar la licencia. El acceso permanece bloqueado."});
  }
});

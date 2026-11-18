import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.TECCHNEX_INSPECCIONES_CONFIG || {};
const PRODUCT_CODE = typeof cfg.productCode === "string" ? cfg.productCode.trim().toUpperCase() : "";
const AUTH_FUNCTION = typeof cfg.authorizationFunction === "string" && cfg.authorizationFunction.trim()
  ? cfg.authorizationFunction.trim() : "tecchnex-product-authorize";
const CONFIG_KEY = typeof cfg.configStorageKey === "string" ? cfg.configStorageKey : "tecchnex_inspecciones_supabase_public_config_v1";
const $ = (id) => document.getElementById(id);
const gate = $("tecchnexInspectionsLicenseGate");
const form = $("tecchnexInspectionsLoginForm");
const loginButton = $("tecchnexInspectionsLoginButton");
const retryButton = $("tecchnexInspectionsRetryButton");
const logoutButton = $("tecchnexInspectionsLogoutButton");
let supabase = null;
let authSubscription = null;
let validationBusy = false;
let lastValidationAt = 0;
const lockedNodes = new Map();

function status(message, ok = false) {
  const el = $("tecchnexInspectionsStatus");
  if (el) { el.textContent = message; el.style.color = ok ? "#146d4a" : "#a22626"; }
}
function showGate(show) {
  if (!gate) return;
  const wasHidden = gate.style.display === "none";
  gate.style.display = show ? "flex" : "none";
  gate.setAttribute("aria-hidden", show ? "false" : "true");
  const sessionChip = $("tecchnexInspectionsSessionChip");
  if (sessionChip) sessionChip.style.display = show ? "none" : "flex";
  if (show) {
    // Evita interacción por teclado con la aplicación de fondo mientras la licencia está bloqueada.
    for (const node of document.body.children) {
      if (node === gate || node.tagName === "SCRIPT") continue;
      if (!lockedNodes.has(node)) lockedNodes.set(node, Boolean(node.inert));
      node.inert = true;
    }
    document.documentElement.style.overflow = "hidden";
    if (wasHidden) $("tecchnexInspectionsSupabaseUrl")?.focus();
  } else {
    for (const [node, previous] of lockedNodes) node.inert = previous;
    lockedNodes.clear();
    document.documentElement.style.overflow = "";
  }
}
function readSavedConfig() {
  try {
    const v = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
function fillConfig() {
  const saved = readSavedConfig();
  // Fijar el destino al proyecto compartido para evitar recuperar una URL antigua de otro proyecto.
  $("tecchnexInspectionsSupabaseUrl").value = cfg.projectUrl || saved.url || "";
  $("tecchnexInspectionsSupabaseKey").value = saved.key || "";
}
function readConfig() {
  const url = $("tecchnexInspectionsSupabaseUrl").value.trim().replace(/\/$/, "");
  const key = $("tecchnexInspectionsSupabaseKey").value.trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key) {
    throw new Error("Completa una URL válida de Supabase y una clave publicable.");
  }
  if (cfg.projectUrl && url !== cfg.projectUrl) {
    throw new Error("Este laboratorio está vinculado al proyecto Supabase compartido configurado. Verifica la URL antes de continuar.");
  }
  return { url, key };
}
function connect(config, persist = true) {
  if (persist) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  if (authSubscription?.unsubscribe) authSubscription.unsubscribe();
  supabase = createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      lastValidationAt = 0;
      showGate(true);
      retryButton.hidden = true;
      logoutButton.hidden = true;
      status("Sesión cerrada. El sistema permanece bloqueado; los datos locales se conservan.");
    }
    if (event === "TOKEN_REFRESHED" && session) {
      // Evita ejecutar una llamada de red dentro del callback interno de Supabase Auth.
      window.setTimeout(() => {
        validateLicense({ force: true }).catch(() => {
          showGate(true);
          status("No se pudo renovar la validación comercial. El acceso permanece bloqueado.");
        });
      }, 0);
    }
  });
  authSubscription = data?.subscription || null;
  return supabase;
}
async function responseBodyFromError(error) {
  try {
    if (error?.context && typeof error.context.json === "function") return await error.context.json();
  } catch { /* usar error genérico si el cuerpo no es JSON o ya fue leído */ }
  return null;
}
function normalized(raw) {
  const bridge = window.TECCHNEXUniversalBridge;
  if (!bridge || typeof bridge.normalizeTecchnexAuthorizationResponse !== "function") {
    throw new Error("No se pudo cargar el contrato TECCHNEX V1.");
  }
  return bridge.normalizeTecchnexAuthorizationResponse(raw, PRODUCT_CODE);
}
async function validateLicense({ force = false } = {}) {
  if (validationBusy) return false;
  if (!PRODUCT_CODE || !/^[A-Z0-9_-]{2,40}$/.test(PRODUCT_CODE)) {
    showGate(true); status("Código de producto sin configurar. Acceso bloqueado."); return false;
  }
  if (!supabase) {
    try { connect(readConfig(), false); }
    catch { showGate(true); status("Configura la conexión de Supabase para validar la licencia."); return false; }
  }
  validationBusy = true;
  try {
    const { data: { session } = {}, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token) {
      showGate(true); retryButton.hidden = true; logoutButton.hidden = true;
      status("Inicia sesión para comprobar la licencia."); return false;
    }
    if (!force && Date.now() - lastValidationAt < 5000) return gate.style.display === "none";
    status("Sesión válida. Comprobando autorización comercial en el servidor…");
    const { data, error } = await supabase.functions.invoke(AUTH_FUNCTION, { body: { product: PRODUCT_CODE } });
    const errorBody = error ? await responseBodyFromError(error) : null;
    const result = normalized(data ?? errorBody);
    if (error || !window.TECCHNEXUniversalBridge.isUniversalAuthorizationGranted(result, PRODUCT_CODE, false)) {
      showGate(true); retryButton.hidden = false; logoutButton.hidden = false;
      const code = result?.code || errorBody?.code || "LICENSE_CHECK_UNAVAILABLE";
      const message = errorBody?.message || result?.message || error?.message || "La licencia no fue confirmada. El acceso permanece bloqueado.";
      status(`${message}\nCódigo: ${code}\nLos datos locales se conservan.`);
      return false;
    }
    lastValidationAt = Date.now();
    retryButton.hidden = false; logoutButton.hidden = false;
    status(`Licencia ${PRODUCT_CODE} verificada. Acceso autorizado.`, true);
    showGate(false);
    return true;
  } catch (error) {
    showGate(true); retryButton.hidden = false;
    status(`${error?.message || "No fue posible verificar la licencia."}\nLos datos locales se conservan.`);
    return false;
  } finally { validationBusy = false; }
}
async function login(event) {
  event.preventDefault();
  loginButton.disabled = true; loginButton.textContent = "Verificando…";
  try {
    const config = readConfig();
    connect(config, true);
    const email = $("tecchnexInspectionsEmail").value.trim();
    const password = $("tecchnexInspectionsPassword").value;
    if (!email || !password) throw new Error("Completa el correo y la contraseña.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    $("tecchnexInspectionsPassword").value = "";
    if (error) throw new Error("No se pudo iniciar sesión: " + error.message);
    await validateLicense({ force: true });
  } catch (error) {
    showGate(true); status(error?.message || "No se pudo verificar el acceso.");
  } finally { loginButton.disabled = false; loginButton.textContent = "Iniciar sesión y validar licencia"; }
}
async function logout() {
  try { if (supabase) await supabase.auth.signOut(); }
  catch { /* no borrar datos locales por fallo de red */ }
  showGate(true); retryButton.hidden = true; logoutButton.hidden = true;
  status("Sesión cerrada. Las inspecciones y fotografías locales se conservan.");
}
form?.addEventListener("submit", login);
retryButton?.addEventListener("click", () => validateLicense({ force: true }));
logoutButton?.addEventListener("click", logout);
$("tecchnexInspectionsSessionLogout")?.addEventListener("click", logout);
fillConfig();
showGate(true);
$("tecchnexInspectionsSupabaseUrl")?.focus();
try {
  const saved = readSavedConfig();
  if (saved.url && saved.key) {
    connect(saved, false);
    supabase.auth.getSession().then(({ data, error }) => {
      if (!error && data?.session) {
        retryButton.hidden = false; logoutButton.hidden = false;
        return validateLicense({ force: true });
      }
      status("Inicia sesión para comprobar la licencia.");
    }).catch(() => status("No se pudo recuperar la sesión. Inicia sesión nuevamente."));
  }
} catch { status("Configura Supabase para validar la licencia."); }
// Revalidar al regresar a la pestaña, sin ejecutar llamadas repetidas durante el mismo foco.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && supabase) validateLicense({ force: true }).catch(() => {});
});

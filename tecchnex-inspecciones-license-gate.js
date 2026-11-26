
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --------------------------------------------------
// CONFIGURACIÓN TECCHNEX CAM-INSPECCIONES
// --------------------------------------------------

const cfg = window.TECCHNEX_INSPECCIONES_CONFIG || {};

const PRODUCT_CODE =
    typeof cfg.productCode === "string"
        ? cfg.productCode.trim().toUpperCase()
        : "";

const AUTH_FUNCTION =
    typeof cfg.authorizationFunction === "string" &&
    cfg.authorizationFunction.trim()
        ? cfg.authorizationFunction.trim()
        : "tecchnex-product-authorize";

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
let lastLicenseAuthorized = false;

const lockedNodes = new Map();

// --------------------------------------------------
// MENSAJES DE ESTADO
// --------------------------------------------------

function status(message, ok = false) {
    const el = $("tecchnexInspectionsStatus");

    if (el) {
        el.textContent = message;
        el.style.color = ok ? "#146d4a" : "#a22626";
    }
}

// --------------------------------------------------
// BLOQUEO Y APERTURA DEL SISTEMA
// --------------------------------------------------

function showGate(show) {
    if (!gate) return;

    const wasHidden = gate.style.display === "none";

    gate.style.display = show ? "flex" : "none";
    gate.setAttribute("aria-hidden", show ? "false" : "true");

    const sessionChip = $("tecchnexInspectionsSessionChip");

    if (sessionChip) {
        sessionChip.style.display = show ? "none" : "flex";
    }

    if (show) {
        // Mantiene bloqueada la aplicación mientras no exista autorización.
        for (const node of document.body.children) {
            if (node === gate || node.tagName === "SCRIPT") continue;

            if (!lockedNodes.has(node)) {
                lockedNodes.set(node, Boolean(node.inert));
            }

            node.inert = true;
        }

        document.documentElement.style.overflow = "hidden";

        if (wasHidden) {
            $("tecchnexInspectionsEmail")?.focus();
        }
    } else {
        for (const [node, previous] of lockedNodes) {
            node.inert = previous;
        }

        lockedNodes.clear();
        document.documentElement.style.overflow = "";
    }
}

// --------------------------------------------------
// CONFIGURACIÓN AUTOMÁTICA DE SUPABASE
// --------------------------------------------------

function readConfig() {
    const url =
        typeof cfg.projectUrl === "string"
            ? cfg.projectUrl.trim().replace(/\/+$/, "")
            : "";

    const key =
        typeof cfg.supabaseAnonKey === "string"
            ? cfg.supabaseAnonKey.trim()
            : "";

    if (!url || !key || key.includes("PEGAR_AQUI")) {
        throw new Error(
            "La configuración de Supabase está incompleta. Verifica el archivo tecchnex-inspecciones-config.js."
        );
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(url);
    } catch {
        throw new Error("La URL configurada de Supabase no es válida.");
    }

    if (
        parsedUrl.protocol !== "https:" ||
        !parsedUrl.hostname.endsWith(".supabase.co")
    ) {
        throw new Error("La dirección del proyecto Supabase no es válida.");
    }

    const configuredUrl =
        typeof cfg.projectUrl === "string"
            ? cfg.projectUrl.trim().replace(/\/+$/, "")
            : "";

    if (configuredUrl && url !== configuredUrl) {
        throw new Error(
            "El proyecto Supabase no coincide con la configuración central."
        );
    }

    return { url, key };
}

// --------------------------------------------------
// CONEXIÓN Y SESIÓN DE SUPABASE
// --------------------------------------------------

function connect(config) {
    // Una sola instancia por pestaña: login, gate y sincronización comparten
    // el mismo cliente y el mismo ciclo de renovación.
    if (supabase) return supabase;

    supabase = createClient(config.url, config.key, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });

    window.TECCHNEX_SUPABASE_CLIENT = supabase;
    window.dispatchEvent(new Event("tecchnex:supabase-ready"));

    const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
            lastValidationAt = 0;
            lastLicenseAuthorized = false;
            showGate(true);

            if (retryButton) retryButton.hidden = true;
            if (logoutButton) logoutButton.hidden = true;

            status(
                "Sesión cerrada. El sistema permanece bloqueado; los datos locales se conservan."
            );
        }

        // TOKEN_REFRESHED confirma la renovación de sesión, no un cambio de
        // licencia. No debe disparar otra autorización comercial central.
    });

    authSubscription = data?.subscription || null;
    return supabase;
}

// --------------------------------------------------
// LECTURA DE RESPUESTAS DE ERROR
// --------------------------------------------------

async function responseBodyFromError(error) {
    try {
        if (
            error?.context &&
            typeof error.context.json === "function"
        ) {
            return await error.context.json();
        }
    } catch {
        // Se utilizará el mensaje general del error.
    }

    return null;
}

// --------------------------------------------------
// CONTRATO TECCHNEX UNIVERSAL BRIDGE
// --------------------------------------------------

function normalized(raw) {
    const bridge = window.TECCHNEXUniversalBridge;

    if (
        !bridge ||
        typeof bridge.normalizeTecchnexAuthorizationResponse !== "function"
    ) {
        throw new Error("No se pudo cargar el contrato TECCHNEX V1.");
    }

    return bridge.normalizeTecchnexAuthorizationResponse(
        raw,
        PRODUCT_CODE
    );
}

// --------------------------------------------------
// VALIDACIÓN COMERCIAL DE LA LICENCIA
// --------------------------------------------------

async function validateLicense({ force = false } = {}) {
    if (validationBusy) return false;

    if (!PRODUCT_CODE || !/^[A-Z0-9_-]{2,40}$/.test(PRODUCT_CODE)) {
        showGate(true);
        status("Código de producto sin configurar. Acceso bloqueado.");
        return false;
    }

    if (!supabase) {
        try {
            connect(readConfig());
        } catch (error) {
            showGate(true);
            status(error.message);
            return false;
        }
    }

    validationBusy = true;

    try {
        const {
            data: { session } = {},
            error: sessionError
        } = await supabase.auth.getSession();

        if (sessionError || !session?.access_token) {
            showGate(true);

            if (retryButton) retryButton.hidden = true;
            if (logoutButton) logoutButton.hidden = true;

            status("Inicia sesión para comprobar la licencia.");
            return false;
        }

        if (
            !force &&
            Date.now() - lastValidationAt < 300000
        ) {
            return gate?.style.display === "none";
        }

        status(
            "Sesión válida. Comprobando autorización comercial en el servidor…"
        );

        const { data, error } = await supabase.functions.invoke(
            AUTH_FUNCTION,
            {
                body: {
                    product: PRODUCT_CODE
                }
            }
        );

        const errorBody = error
            ? await responseBodyFromError(error)
            : null;

        const result = normalized(data ?? errorBody);
        const bridge = window.TECCHNEXUniversalBridge;

        if (
            typeof bridge.isUniversalAuthorizationGranted !== "function"
        ) {
            throw new Error(
                "No está disponible la validación comercial del contrato TECCHNEX."
            );
        }

        const authorized =
            !error &&
            bridge.isUniversalAuthorizationGranted(
                result,
                PRODUCT_CODE,
                false
            );

        if (!authorized) {
            const code =
                result?.code ||
                errorBody?.code ||
                "LICENSE_CHECK_UNAVAILABLE";

            const message =
                errorBody?.message ||
                result?.message ||
                error?.message ||
                "La licencia no fue confirmada.";

            const httpStatus = Number(error?.context?.status || 0);
            const temporaryFailure = [
                "LICENSE_CHECK_UNAVAILABLE",
                "RATE_LIMIT_EXCEEDED",
                "CENTRAL_UNAVAILABLE",
                "NETWORK_ERROR",
                "FUNCTION_TIMEOUT"
            ].includes(String(code).toUpperCase()) ||
                httpStatus === 0 || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;

            // Un fallo transitorio no revoca una autorización ya confirmada.
            if (!(temporaryFailure && lastLicenseAuthorized)) {
                showGate(true);
            }

            if (retryButton) retryButton.hidden = false;
            if (logoutButton) logoutButton.hidden = false;

            status(
                `${message}\nCódigo: ${code}\n${temporaryFailure && lastLicenseAuthorized
                    ? "La última autorización válida se conserva; puedes reintentar la verificación."
                    : "Los datos locales se conservan."}`
            );

            return false;
        }

        lastValidationAt = Date.now();
        lastLicenseAuthorized = true;

        if (retryButton) retryButton.hidden = false;
        if (logoutButton) logoutButton.hidden = false;

        status(
            `Licencia ${PRODUCT_CODE} verificada. Acceso autorizado.`,
            true
        );

        showGate(false);
        return true;

    } catch (error) {
        if (!lastLicenseAuthorized) showGate(true);

        if (retryButton) retryButton.hidden = false;

        status(
            `${error?.message || "No fue posible verificar la licencia."}\n${lastLicenseAuthorized
                ? "La última autorización válida se conserva temporalmente; puedes reintentar."
                : "Los datos locales se conservan."}`
        );

        return false;

    } finally {
        validationBusy = false;
    }
}

// --------------------------------------------------
// INICIO DE SESIÓN: SOLO CORREO Y CONTRASEÑA
// --------------------------------------------------

async function login(event) {
    event.preventDefault();

    if (!loginButton) return;

    loginButton.disabled = true;
    loginButton.textContent = "Verificando…";

    try {
        const config = readConfig();
        connect(config);

        const emailInput = $("tecchnexInspectionsEmail");
        const passwordInput = $("tecchnexInspectionsPassword");

        const email = emailInput?.value.trim() || "";
        const password = passwordInput?.value || "";

        if (!email || !password) {
            throw new Error("Completa el correo y la contraseña.");
        }

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (passwordInput) {
            passwordInput.value = "";
        }

        if (error) {
            throw new Error(
                "No se pudo iniciar sesión: " + error.message
            );
        }

        await validateLicense({ force: true });

    } catch (error) {
        showGate(true);
        status(error?.message || "No se pudo verificar el acceso.");

    } finally {
        loginButton.disabled = false;
        loginButton.textContent = "Iniciar sesión";
    }
}

// --------------------------------------------------
// CIERRE DE SESIÓN
// --------------------------------------------------

async function logout() {
    lastLicenseAuthorized = false;
    lastValidationAt = 0;
    try {
        if (supabase) {
            await supabase.auth.signOut();
        }
    } catch {
        // No borrar datos locales por fallo de red.
    }

    showGate(true);

    if (retryButton) retryButton.hidden = true;
    if (logoutButton) logoutButton.hidden = true;

    status(
        "Sesión cerrada. Las inspecciones y fotografías locales se conservan."
    );
}

// --------------------------------------------------
// EVENTOS DEL FORMULARIO Y BOTONES
// --------------------------------------------------

form?.addEventListener("submit", login);

retryButton?.addEventListener("click", () => {
    validateLicense({ force: true });
});

logoutButton?.addEventListener("click", logout);

$("tecchnexInspectionsSessionLogout")?.addEventListener(
    "click",
    logout
);

// --------------------------------------------------
// INICIALIZACIÓN AUTOMÁTICA
// --------------------------------------------------

showGate(true);

try {
    const config = readConfig();
    connect(config);

    supabase.auth.getSession()
        .then(({ data, error }) => {
            if (!error && data?.session) {
                if (retryButton) retryButton.hidden = false;
                if (logoutButton) logoutButton.hidden = false;

                return validateLicense({ force: true });
            }

            status("Ingresa tu correo y contraseña para continuar.");
        })
        .catch(() => {
            status(
                "No se pudo recuperar la sesión. Inicia sesión nuevamente."
            );
        });

} catch (error) {
    showGate(true);
    status(error.message);
}

// --------------------------------------------------
// REVALIDACIÓN AL REGRESAR A LA PESTAÑA
// --------------------------------------------------

document.addEventListener("visibilitychange", () => {
    if (
        document.visibilityState === "visible" &&
        supabase
    ) {
        validateLicense({ force: false }).catch(() => {});
    }
});

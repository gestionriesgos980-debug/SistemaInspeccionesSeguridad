import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");

test("INS-V25-01: conserva la marca de base LAB V25 y coloca la puerta al inicio del body", async () => {
  const html = await read("index.html");
  assert.match(html, /CAM-INSPECCIONES-LAB-V25/);
  const body = html.indexOf("<body>");
  const gate = html.indexOf("TECCHNEX CAM-INSPECCIONES V25 · PUERTA COMERCIAL LAB CANDIDATA");
  assert.ok(body >= 0 && gate > body && gate - body < 5000);
  assert.equal((html.match(/id="tecchnexInspectionsLicenseGate"/g) || []).length, 1);
});

test("INS-V25-02: carga el adaptador, la configuración y el gate desde rutas locales", async () => {
  const html = await read("index.html");
  assert.match(html, /src="\.\/adapters\/contrato-adaptador\.js"/);
  assert.match(html, /src="\.\/tecchnex-inspecciones-config\.js"/);
  assert.match(html, /type="module" src="\.\/tecchnex-inspecciones-license-gate\.js"/);
  await access(path.join(root, "adapters/contrato-adaptador.js"));
  await access(path.join(root, "tecchnex-inspecciones-config.js"));
  await access(path.join(root, "tecchnex-inspecciones-license-gate.js"));
});

test("INS-V25-03: el gate conserva el producto candidato CAM-INSPECCIONES", async () => {
  const cfg = await read("tecchnex-inspecciones-config.js");
  const fn = await read("supabase/functions/tecchnex-product-authorize/index.ts");
  assert.match(cfg, /productCode:\s*"CAM-INSPECCIONES"/);
  assert.match(cfg, /projectUrl:\s*"https:\/\/ywezkwitbhbyxcwuoiim\.supabase\.co"/);
  assert.match(fn, /const PRODUCT_CODE = "CAM-INSPECCIONES"/);
});

test("INS-V25-04: el navegador invoca solo la función de autorización de producto", async () => {
  const gate = await read("tecchnex-inspecciones-license-gate.js");
  assert.match(gate, /supabase\.functions\.invoke\(AUTH_FUNCTION/);
  assert.match(gate, /authorizationFunction/);
  assert.doesNotMatch(gate, /BRIDGE_PROJECT_HMAC_SECRET|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS/);
});

test("INS-V25-05: el ciclo de sesión bloquea SIGNED_OUT y revalida TOKEN_REFRESHED", async () => {
  const gate = await read("tecchnex-inspecciones-license-gate.js");
  assert.match(gate, /onAuthStateChange/);
  assert.match(gate, /event === "SIGNED_OUT"/);
  assert.match(gate, /event === "TOKEN_REFRESHED" && session/);
  assert.match(gate, /validateLicense\(\{ force: true \}\)/);
});

test("INS-V25-06: la función de servidor exige JWT y valida membresía local", async () => {
  const fn = await read("supabase/functions/tecchnex-product-authorize/index.ts");
  const cfg = await read("supabase/CONFIG_FRAGMENT_TECCHNEX_PRODUCT_AUTHORIZE.toml");
  assert.match(cfg, /\[functions\.tecchnex-product-authorize\][\s\S]*verify_jwt\s*=\s*true/);
  assert.match(fn, /auth\.getClaims\(/);
  assert.match(fn, /from\("tecchnex_client_users"\)/);
});

test("INS-V25-07: el cliente servidor firma el contrato USER histórico", async () => {
  const client = await read("supabase/functions/_shared/universal-bridge-client-cam-inspecciones.ts");
  assert.match(client, /external_user_id/);
  assert.match(client, /external_client_id/);
  assert.match(client, /canonicalBridgePayload/);
  assert.match(client, /x-tecchnex-signature/);
  assert.doesNotMatch(client, /identity_type\s*:/);
});

test("INS-V25-08: Service Worker usa caché LAB V25 y precarga los tres recursos", async () => {
  const sw = await read("sw.js");
  assert.match(sw, /inspecciones-seguridad-v25-bridge-lab-v4/);
  for (const rel of ["./adapters/contrato-adaptador.js", "./tecchnex-inspecciones-config.js", "./tecchnex-inspecciones-license-gate.js"]) {
    assert.ok(sw.includes(rel), `Falta precarga de ${rel}`);
  }
  assert.doesNotMatch(sw, /indexedDB\.deleteDatabase|localStorage\.clear/);
});

test("INS-V25-09: la respuesta del servidor puede normalizarse por el contrato de navegador", async () => {
  const adapter = await read("adapters/contrato-adaptador.js");
  const fn = await read("supabase/functions/tecchnex-product-authorize/index.ts");
  assert.match(adapter, /raw\.ok === true && raw\.authorized === true/);
  assert.match(fn, /ok:true,authorized:true,product:PRODUCT_CODE,product_code:PRODUCT_CODE/);
});

test("INS-V25-10: no se agregan instrucciones SQL ni migraciones al paquete", async () => {
  const fn = await read("supabase/functions/tecchnex-product-authorize/index.ts");
  const client = await read("supabase/functions/_shared/universal-bridge-client-cam-inspecciones.ts");
  assert.doesNotMatch(fn + client, /\b(CREATE|ALTER|DROP)\s+TABLE\b/i);
  assert.doesNotMatch(fn + client, /\.insert\(|\.update\(|\.delete\(/);
});


test("INS-V25-11: precarga el proyecto Supabase compartido sin incorporar una clave al código", async () => {
  const cfg = await read("tecchnex-inspecciones-config.js");
  const gate = await read("tecchnex-inspecciones-license-gate.js");
  assert.match(cfg, /projectUrl:\s*"https:\/\/ywezkwitbhbyxcwuoiim\.supabase\.co"/);
  assert.match(gate, /cfg\.projectUrl \|\| saved\.url \|\| ""/);
  assert.match(gate, /url !== cfg\.projectUrl/);
  assert.doesNotMatch(cfg, /(?:sb_publishable_|eyJ[a-zA-Z0-9_-]{20,})/);
});


test("INS-V25-12: utiliza un secreto HMAC exclusivo y no hereda el secreto genérico de otro producto", async () => {
  const fn = await read("supabase/functions/tecchnex-product-authorize/index.ts");
  const client = await read("supabase/functions/_shared/universal-bridge-client-cam-inspecciones.ts");
  assert.match(fn, /CAM_INSPECCIONES_PROJECT_HMAC_SECRET/);
  assert.match(fn, /secret:\s*PRODUCT_HMAC_SECRET/);
  assert.match(fn, /PRODUCT_HMAC_SECRET\.length < 32/);
  assert.doesNotMatch(fn, /Deno\.env\.get\("BRIDGE_PROJECT_HMAC_SECRET"\)/);
  assert.match(client, /args\.secret/);
});


test("INS-V25-13: el helper de Inspecciones queda aislado y no reemplaza el cliente común USER/POST", async () => {
  const fn = await read("supabase/functions/tecchnex-product-authorize/index.ts");
  const isolated = await read("supabase/functions/_shared/universal-bridge-client-cam-inspecciones.ts");
  assert.match(fn, /universal-bridge-client-cam-inspecciones\.ts/);
  assert.doesNotMatch(fn, /from ["']\.\.\/_shared\/universal-bridge-client\.ts["']/);
  assert.match(isolated, /external_user_id/);
  assert.match(isolated, /canonicalBridgePayload/);
  await assert.rejects(access(path.join(root, "supabase/functions/_shared/universal-bridge-client.ts")));
});


test("INS-V25-14: registra diagnóstico central acotado sin exponer secretos ni datos de identidad", async () => {
  const client = await read("supabase/functions/_shared/universal-bridge-client-cam-inspecciones.ts");
  assert.match(client, /CAM-INSPECCIONES bridge diagnostic/);
  assert.match(client, /stage:\s*"central_rejected"/);
  assert.match(client, /stage:\s*"fetch_or_signing"/);
  assert.match(client, /http_status:\s*response\.status/);
  assert.match(client, /error_name:\s*errorName/);
  assert.doesNotMatch(client, /console\.(?:log|warn|error)\([^)]*(?:secret|signature|Authorization|external_user_id|external_client_id)/i);
});



test("INS-V25-15: restauración asocia hallazgos, checklists y matriz por puesto + fecha, nunca por idControl", async () => {
  const html = await read("index.html");
  const inicio = html.indexOf("// CAM-RESTAURACION-PUESTO-FECHA-04");
  const fin = html.indexOf("if (hallazgosRestauradosSinAsociacion", inicio);
  assert.ok(inicio >= 0 && fin > inicio, "debe existir el bloque de restauración por puesto+fecha");
  const bloque = html.slice(inicio, fin);
  assert.match(bloque, /indicesPorClavePuestoFechaRespaldo/);
  assert.match(bloque, /reconstruirListaOperativaPuestoFechaRespaldo/);
  assert.match(bloque, /datos\.checklists\s*=\s*reconstruirListaOperativaPuestoFechaRespaldo/);
  assert.match(bloque, /datos\.matrizRiesgos\s*=\s*reconstruirListaOperativaPuestoFechaRespaldo/);
  assert.doesNotMatch(bloque, /indicesInspeccionPorIdRespaldo|coincidenciasId/);
});

test("INS-V25-16: no permite crear respaldo si falta una fotografía referenciada", async () => {
  const html = await read("index.html");
  const inicio = html.indexOf("async function exportarMediosParaRespaldo");
  const fin = html.indexOf("async function restaurarMediosDesdeRespaldo", inicio);
  const bloque = html.slice(inicio, fin);
  assert.match(bloque, /El respaldo se canceló para no crear una copia incompleta/);
  assert.doesNotMatch(bloque, /if\s*\(!dataUrl\)\s*\{\s*continue;/);
});

test("INS-V25-17: el paquete limpio mantiene aislado el helper comercial de Inspecciones", async () => {
  const helper = path.join(root, "supabase/functions/_shared/universal-bridge-client-cam-inspecciones.ts");
  const shared = path.join(root, "supabase/functions/_shared/universal-bridge-client.ts");
  await access(helper);
  await assert.rejects(access(shared));
  const fn = await read("supabase/functions/tecchnex-product-authorize/index.ts");
  assert.match(fn, /universal-bridge-client-cam-inspecciones\.ts/);
});


test("INS-V25-18: identidad operativa única usa puesto + fecha sin alias cliente/CRM", async () => {
  const html = await read("index.html");
  const inicio = html.indexOf("function obtenerClavesInspeccionPuestoFechaTECCHNEX");
  const fin = html.indexOf("function obtenerClaveInspeccionPuestoFechaTECCHNEX", inicio);
  const bloque = html.slice(inicio, fin);
  assert.match(bloque, /inspeccion\.nombrePuesto\s*\|\|\s*inspeccion\.puesto/);
  assert.match(bloque, /return nombrePuesto \?/);
  assert.doesNotMatch(bloque, /const nombres\s*=/);
});

test("INS-V25-19: restauración estricta verifica IndexedDB y no oculta fallos fotográficos", async () => {
  const html = await read("index.html");
  const inicio = html.indexOf("async function restaurarMediosDesdeRespaldo");
  const fin = html.indexOf("async function prepararFotografiasParaInforme", inicio);
  const bloque = html.slice(inicio, fin);
  assert.match(bloque, /if \(!tecchnexMediaDB\)\s*\{\s*throw new Error/);
  assert.match(bloque, /leerMediaPorId\(referencia\.mediaId\)/);
  assert.match(bloque, /Compatibilidad con respaldos antiguos/);
  assert.match(bloque, /mapaIds\.set\(foto\.mediaId, referencia\.mediaId\)/);
  assert.match(bloque, /if \(errores\.length\)\s*\{/);
  assert.match(bloque, /return hallazgos\.map/);
  assert.doesNotMatch(bloque, /console\.warn\("CAM-ALMACENAMIENTO-01B: no se pudo restaurar un medio/);
});

test("INS-V25-20: valida y prepara las fotografías antes de reemplazar datos en localStorage", async () => {
  const html = await read("index.html");
  const inicio = html.indexOf("// CAM-ALMACENAMIENTO-05A: validar y restaurar todos los medios");
  const escritura = html.indexOf('localStorage.setItem(\n    "inspecciones"', inicio);
  const llamadaFinalAntigua = html.indexOf("await restaurarMediosDesdeRespaldo(", escritura + 1);
  assert.ok(inicio >= 0 && escritura > inicio, "la verificación de medios debe preceder al primer reemplazo de inspecciones");
  assert.equal(llamadaFinalAntigua, -1, "no debe quedar una segunda restauración posterior a la escritura");
  assert.match(html.slice(inicio, escritura), /datos\.hallazgos\s*=\s*await restaurarMediosDesdeRespaldo/);
});

test("INS-V25-21: detiene el guardado de hallazgos con fotografías si IndexedDB no está disponible", async () => {
  const html = await read("index.html");
  const inicioHelper = html.indexOf("async function guardarFotosHallazgoEnBoveda");
  const finHelper = html.indexOf("async function obtenerDataUrlMedia", inicioHelper);
  const helper = html.slice(inicioHelper, finHelper);
  assert.match(helper, /if \(!tecchnexMediaDB\)\s*\{\s*throw new Error/);
  assert.doesNotMatch(helper, /resultado:\s*Array\.isArray\(fotos\)/);

  const inicioGuardado = html.indexOf("// CAM-ALMACENAMIENTO-01B / 06A");
  const finGuardado = html.indexOf("const hallazgoActualizado =", inicioGuardado);
  const guardado = html.slice(inicioGuardado, finGuardado + "const hallazgoActualizado =".length);
  assert.match(guardado, /await tecchnexMediaReady/);
  assert.match(guardado, /if \(!bovedaDisponible \|\| !tecchnexMediaDB\)/);
  assert.match(guardado, /Sus datos y fotografías siguen en el formulario/);
  assert.match(guardado, /return;/);
  assert.ok(finGuardado > inicioGuardado);
  assert.ok(html.indexOf("return;", inicioGuardado) < finGuardado);
});

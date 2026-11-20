/* TECCHNEX CAM-INSPECCIONES SYNC CLIENT V1 — integración manual y controlada.
   Reutiliza la cola local existente. No cambia registros funcionales ni dispara POST automático.
   El envío ocurre únicamente al pulsar “Sincronizar pendientes”. */
const QUEUE_KEY = "tecchnex_cam_inspecciones_sync_queue_v1";
const RECORDS_KEY = "tecchnex_cam_inspecciones_sync_records_v1";
const CONFIG_KEY = "tecchnex_inspecciones_supabase_public_config_v1";
const FUNCTION_NAME = "tecchnex-cam-inspecciones-sync";
const $ = (id) => document.getElementById(id);
let busy = false;

function readJson(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value == null ? fallback : value; }
  catch { return fallback; }
}
function writePair(queue, records) {
  const previous = { [QUEUE_KEY]: localStorage.getItem(QUEUE_KEY), [RECORDS_KEY]: localStorage.getItem(RECORDS_KEY) };
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) {
      try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {}
    }
    throw error;
  }
}
function status(message, color = "#475569") {
  const el = $("camSyncStatusV1");
  if (el) { el.textContent = message; el.style.color = color; }
}
function getConfig() {
  const cfg = window.TECCHNEX_INSPECCIONES_CONFIG || {};
  const keyName = typeof cfg.configStorageKey === "string" ? cfg.configStorageKey : CONFIG_KEY;
  const saved = readJson(keyName, {});
  const url = String(cfg.projectUrl || saved.url || "").replace(/\/$/, "");
  const anonKey = String(saved.key || "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !anonKey) {
    throw new Error("No se encontró la configuración pública de Supabase guardada en la puerta de acceso.");
  }
  return { url, anonKey };
}
function makeRequestBody(op) {
  if (!op || typeof op !== "object" || !op.operation_id || !op.record_sync_id || !op.record_type || !op.operation_type || !op.payload || typeof op.payload !== "object" || Array.isArray(op.payload)) {
    throw new Error("Hay una operación pendiente con estructura inválida. No se envió.");
  }
  return {
    operation_id: op.operation_id,
    record_sync_id: op.record_sync_id,
    operation_type: op.operation_type,
    expected_version: op.expected_version ?? null,
    record_type: op.record_type,
    parent_sync_id: op.parent_sync_id ?? null,
    payload: op.payload
  };
}
async function sendOne(op) {
  const auth = window.TECCHNEX_CAM_INSPECCIONES_AUTH;
  if (!auth || typeof auth.getAccessToken !== "function") throw new Error("La interfaz de sesión AUTH no está disponible.");
  const token = await auth.getAccessToken();
  const { url, anonKey } = getConfig();
  const body = makeRequestBody(op);
  let response, data = null;
  try {
    response = await fetch(`${url}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    try { data = await response.json(); } catch {}
  } catch (error) {
    return { state: "delivery_uncertain", confirmed: false, code: "NETWORK_ERROR", message: "No se pudo confirmar la respuesta de red." };
  }
  if (response.status === 200 && data?.ok === true) return { state: "completed", confirmed: true, data, httpStatus: response.status };
  if (response.status === 409) return { state: "conflict", confirmed: false, code: data?.code || "HTTP_409", httpStatus: response.status };
  if (response.status === 401 || response.status === 403) return { state: "authorization_required", confirmed: false, code: data?.code || `HTTP_${response.status}`, httpStatus: response.status };
  if (response.status === 429 || response.status >= 500) return { state: "pending", confirmed: false, code: data?.code || `HTTP_${response.status}`, httpStatus: response.status };
  return { state: "request_rejected", confirmed: false, code: data?.code || `HTTP_${response.status}`, httpStatus: response.status };
}
async function syncPending() {
  if (busy) return;
  busy = true;
  const button = $("camSyncSendV1");
  if (button) button.disabled = true;
  try {
    const queue = readJson(QUEUE_KEY, []);
    const records = readJson(RECORDS_KEY, {});
    if (!Array.isArray(queue) || !records || typeof records !== "object" || Array.isArray(records)) throw new Error("La estructura de la cola local no es válida.");
    const pending = queue.filter(op => op && op.status === "pending");
    if (!pending.length) { status(`Cola revisada: ${queue.length} operación(es), ninguna pendiente.`, "#146d4a"); return; }
    status(`Enviando 1 de ${pending.length} operación(es) pendiente(s)…`);
    let completed = 0, blocked = false;
    for (const op of pending) {
      // Se relee antes de cada intento para no sobrescribir cambios externos recientes.
      const currentQueue = readJson(QUEUE_KEY, []);
      const index = currentQueue.findIndex(item => item?.operation_id === op.operation_id && item?.status === "pending");
      if (index < 0) continue;
      const current = currentQueue[index];
      current.attempts = Number(current.attempts || 0) + 1;
      current.last_attempt_at = new Date().toISOString();
      let result;
      try { result = await sendOne(current); }
      catch (error) { result = { state: "authorization_required", confirmed: false, code: "CLIENT_PRECHECK_FAILED", message: error?.message || "No se pudo preparar la solicitud." }; }
      current.last_response = { state: result.state, code: result.code || result.data?.code || null, http_status: result.httpStatus ?? null, occurred_at: new Date().toISOString() };
      if (result.confirmed) {
        current.status = "completed";
        current.completed_at = new Date().toISOString();
        current.result_version = Number(result.data?.result_version ?? result.data?.version ?? 0) || null;
        const meta = records[current.local_record_id] || records[Object.keys(records).find(k => records[k]?.record_sync_id === current.record_sync_id)] || null;
        const metaKey = current.local_record_id || Object.keys(records).find(k => records[k]?.record_sync_id === current.record_sync_id);
        if (meta && metaKey) records[metaKey] = { ...meta, server_version: current.result_version ?? meta.server_version ?? 0, updated_at: new Date().toISOString() };
        completed++;
      } else if (["conflict", "authorization_required", "request_rejected"].includes(result.state)) {
        current.status = result.state;
        blocked = true;
      } else {
        // Error temporal o entrega incierta: permanece pendiente; mismo operation_id y payload.
        current.status = "pending";
        blocked = true;
      }
      writePair(currentQueue, records);
      status(`Resultado ${completed}/${pending.length} completada(s). Última operación: ${current.status}.`);
      if (blocked) break;
    }
    const finalQueue = readJson(QUEUE_KEY, []);
    const remaining = finalQueue.filter(op => op?.status === "pending").length;
    status(`Sincronización finalizada: ${completed} completada(s); ${remaining} pendiente(s).`, completed && !remaining ? "#146d4a" : "#8a5200");
  } catch (error) {
    status(error?.message || "No fue posible iniciar la sincronización.", "#a22626");
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
}

async function validateCompletedOnly() {
  if (busy) return;
  busy = true;
  const button = $("camSyncValidateV1");
  if (button) button.disabled = true;
  try {
    const queue = readJson(QUEUE_KEY, []);
    if (!Array.isArray(queue)) throw new Error("La estructura de la cola local no es válida.");
    const candidate = [...queue].reverse().find(op => op && op.status === "completed");
    if (!candidate) { status("No hay una operación completada disponible para validar.", "#8a5200"); return; }
    const auth = window.TECCHNEX_CAM_INSPECCIONES_AUTH;
    if (!auth || typeof auth.getAccessToken !== "function") throw new Error("La interfaz de sesión AUTH no está disponible.");
    const token = await auth.getAccessToken();
    const { url, anonKey } = getConfig();
    const body = { ...makeRequestBody(candidate), mode: "VALIDATE_ONLY" };
    status("Validando estructura y autorización comercial. No se ejecutará RPC ni escritura…");
    const response = await fetch(`${url}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (response.status === 200 && data?.ok === true && data?.code === "VALIDATE_ONLY_PASSED" && data?.write_executed === false && data?.rpc_executed === false) {
      status("VALIDACIÓN SUPERADA: JWT, contrato, puente y operación correctos. Sin RPC ni escritura. Cola intacta.", "#146d4a");
    } else {
      status(`Validación no superada: ${data?.code || `HTTP_${response.status}`}. La cola permanece intacta.`, "#a22626");
    }
  } catch (error) {
    status(error?.message || "No fue posible validar la operación.", "#a22626");
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
}


// PRUEBA CONTROLADA V1.4: crea un único registro sintético en la cola local.
// No modifica inspecciones funcionales ni realiza solicitudes de red.
const TEST_MARKER = "_tecchnex_sync_lab_test_v1";
function secureUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  throw new Error("El navegador no permite generar UUID seguros para la prueba.");
}
function updateTestButton() {
  const queue = readJson(QUEUE_KEY, []);
  const test = Array.isArray(queue) ? queue.find(op => op?.payload?.[TEST_MARKER] === true) : null;
  const button = $("camSyncSendTestV1");
  if (button) {
    button.disabled = !(test && test.status === "pending");
    button.style.opacity = button.disabled ? ".55" : "1";
  }
}
function prepareLocalTest() {
  try {
    const queue = readJson(QUEUE_KEY, []);
    const records = readJson(RECORDS_KEY, {});
    if (!Array.isArray(queue) || !records || typeof records !== "object" || Array.isArray(records)) {
      throw new Error("La estructura de la cola local no es válida.");
    }
    const existing = queue.find(op => op?.payload?.[TEST_MARKER] === true);
    if (existing) {
      updateTestButton();
      status(`Ya existe una prueba de laboratorio: ${existing.status}. No se creó otra operación.`, "#8a5200");
      return;
    }
    const stamp = new Date().toISOString();
    const date = stamp.slice(0, 10);
    const suffix = secureUuid().slice(0, 8).toUpperCase();
    const payload = {
      idControl: `LAB-SYNC-${date.replaceAll("-", "")}-${suffix}`,
      fecha: date,
      nombrePuesto: "TECCHNEX - PRUEBA TÉCNICA DE SINCRONIZACIÓN",
      estado: "REGISTRO_SINTETICO_DE_LABORATORIO",
      descripcion: "Registro sintético sin datos personales ni información de un cliente real.",
      [TEST_MARKER]: true
    };
    const operation = {
      operation_id: secureUuid(),
      record_sync_id: secureUuid(),
      operation_type: "INSERT",
      expected_version: null,
      record_type: "inspeccion",
      parent_sync_id: null,
      payload,
      status: "pending",
      created_at: stamp,
      attempts: 0,
      local_record_id: "__TECCHNEX_SYNC_LAB_TEST__",
      lab_test: true
    };
    writePair([...queue, operation], records);
    updateTestButton();
    status(`Prueba local preparada: ${payload.idControl}. No se envió nada al servidor.`, "#146d4a");
  } catch (error) {
    status(error?.message || "No fue posible preparar la prueba local.", "#a22626");
  }
}
async function syncOnlyTest() {
  if (busy) return;
  busy = true;
  const button = $("camSyncSendTestV1");
  if (button) button.disabled = true;
  try {
    const queue = readJson(QUEUE_KEY, []);
    const records = readJson(RECORDS_KEY, {});
    if (!Array.isArray(queue) || !records || typeof records !== "object" || Array.isArray(records)) {
      throw new Error("La estructura de la cola local no es válida.");
    }
    const index = queue.findIndex(op => op?.payload?.[TEST_MARKER] === true && op.status === "pending");
    if (index < 0) throw new Error("No hay una prueba sintética pendiente para enviar.");
    const currentQueue = [...queue];
    const operation = { ...currentQueue[index] };
    operation.attempts = Number(operation.attempts || 0) + 1;
    operation.last_attempt_at = new Date().toISOString();
    status("Enviando únicamente el registro sintético de laboratorio. Esta acción escribe en Supabase…", "#8a5200");
    let result;
    try { result = await sendOne(operation); }
    catch (error) { result = { state: "authorization_required", confirmed: false, code: "CLIENT_PRECHECK_FAILED", message: error?.message || "No se pudo preparar la solicitud." }; }
    operation.last_response = { state: result.state, code: result.code || result.data?.code || null, http_status: result.httpStatus ?? null, occurred_at: new Date().toISOString() };
    if (result.confirmed) {
      operation.status = "completed";
      operation.completed_at = new Date().toISOString();
      operation.result_version = Number(result.data?.result_version ?? result.data?.version ?? 0) || null;
      status(`PRUEBA ESCRITA Y CONFIRMADA. Registro ${operation.payload.idControl}; versión ${operation.result_version ?? "confirmación recibida"}.`, "#146d4a");
    } else if (["conflict", "authorization_required", "request_rejected"].includes(result.state)) {
      operation.status = result.state;
      status(`Prueba no completada: ${result.code || result.state}. Revisar respuesta; no repetir automáticamente.`, "#a22626");
    } else {
      operation.status = "pending";
      status("No se confirmó la entrega. La prueba permanece pendiente con el mismo operation_id; no repetir hasta revisar.", "#8a5200");
    }
    currentQueue[index] = operation;
    writePair(currentQueue, records);
    refreshLabel();
  } catch (error) {
    status(error?.message || "No fue posible enviar la prueba controlada.", "#a22626");
  } finally {
    busy = false;
    updateTestButton();
    const generalButton = $("camSyncSendV1");
    if (generalButton) generalButton.disabled = false;
  }
}

function refreshLabel() {
  const queue = readJson(QUEUE_KEY, []);
  if (!Array.isArray(queue)) { status("La cola local requiere revisión.", "#a22626"); return; }
  const pending = queue.filter(op => op?.status === "pending").length;
  status(`${pending} pendiente(s) · ${queue.filter(op => op?.status === "completed").length} completada(s).`);
}
$("camSyncSendV1")?.addEventListener("click", syncPending);
$("camSyncValidateV1")?.addEventListener("click", validateCompletedOnly);
$("camSyncPrepareTestV1")?.addEventListener("click", prepareLocalTest);
$("camSyncSendTestV1")?.addEventListener("click", syncOnlyTest);
refreshLabel();
updateTestButton();
status("Cliente de sincronización cargado. Listo para validación manual.", "#146d4a");

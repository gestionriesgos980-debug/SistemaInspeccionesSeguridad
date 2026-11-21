/*
 * TECCHNEX CAM-INSPECCIONES — cliente de sincronización V1 (LAB)
 *
 * Alcance de esta entrega:
 * - Conecta con la Edge Function existente mediante la sesión Supabase del gate.
 * - Conserva la validación individual de la cola local.
 * - Valida y sincroniza paquetes mediante la Edge Function agrupada V1.
 * - La escritura real requiere confirmación expresa del usuario en pantalla.
 * - Las fotografías permanecen pendientes para una etapa posterior de Storage.
 *
 * Seguridad: usa únicamente la clave publicable configurada y el JWT de sesión.
 * Nunca contiene ni solicita credenciales administrativas, secretos HMAC ni tokens manuales.
 */
(function () {
    "use strict";

    const QUEUE_KEY = "tecchnex_cam_inspecciones_sync_queue_v1";
    const CONFIG = window.TECCHNEX_INSPECCIONES_CONFIG || {};
    const FUNCTION_NAME = "tecchnex-cam-inspecciones-sync";
    const PACKAGE_FUNCTION_NAME = "tecchnex-cam-inspecciones-sync-package";
    const READ_FUNCTION_NAME = "tecchnex-cam-inspecciones-read";
    const REAL_INSPECTION_READ_ID = "e60d753a-8a9e-4d7f-af59-57511416db50";
    const MAX_VALIDATE_BATCH = 10;
    const MAX_PACKAGE_RECORDS = 11;
    const MAX_REQUEST_BYTES = 1024 * 1024;
    let importedPackage = null;
    // Progreso de VALIDATE_ONLY conservado solo en memoria durante esta sesión.
    let packageValidationProgress = null;

    const $ = (id) => document.getElementById(id);
    const statusNode = () => $("camSyncStatusV1");
    let clientPromise = null;
    let preparedTest = null;
    let busy = false;

    function setStatus(message, kind = "info") {
        const node = statusNode();
        if (!node) return;
        node.textContent = message;
        node.style.color = kind === "ok" ? "#146d4a" : kind === "error" ? "#a22626" : "#475569";
    }

    function readQueue() {
        let value;
        try { value = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
        catch (_) { throw new Error("La cola local no contiene JSON válido."); }
        if (!Array.isArray(value)) throw new Error("La cola local tiene una estructura inesperada.");
        return value.filter((item) => item && item.status === "pending");
    }

    function uuid() {
        if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
            throw new Error("Este navegador no permite generar UUID seguros.");
        }
        return window.crypto.randomUUID();
    }

    async function getClient() {
        if (clientPromise) return clientPromise;
        clientPromise = (async () => {
            const url = String(CONFIG.projectUrl || "").trim().replace(/\/+$/, "");
            const key = String(CONFIG.supabaseAnonKey || "").trim();
            if (!url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
                throw new Error("La configuración pública de Supabase está incompleta o no es válida.");
            }
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
            // Supabase usa la misma clave de almacenamiento de sesión por project-ref
            // que el gate comercial, por lo que se reutiliza el login ya existente.
            return createClient(url, key, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
            });
        })().catch((error) => {
            clientPromise = null;
            throw error;
        });
        return clientPromise;
    }

    async function invokeValidation(operation, mode = "VALIDATE_ONLY") {
        const client = await getClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (sessionError || !accessToken) {
            throw new Error("No hay una sesión autenticada. Inicia sesión en la puerta comercial y vuelve a intentar.");
        }

        const body = mode === "DRY_RUN"
            ? { mode: "DRY_RUN" }
            : {
                mode: "VALIDATE_ONLY",
                operation_id: operation.operation_id,
                record_sync_id: operation.record_sync_id,
                operation_type: operation.operation_type,
                expected_version: operation.expected_version ?? null,
                record_type: operation.record_type,
                parent_sync_id: operation.parent_sync_id ?? null,
                payload: operation.payload
            };

        const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body });
        if (error) {
            let detail = "";
            let responseBody = null;
            let httpStatus = Number(error.context?.status || 0);
            try {
                if (error.context && typeof error.context.clone === "function") {
                    const response = error.context.clone();
                    httpStatus = Number(response.status || httpStatus);
                    responseBody = await response.json();
                    detail = JSON.stringify(responseBody);
                }
            } catch (_) { /* No se exponen tokens, cabeceras ni cuerpos ajenos al error. */ }
            const code = String(responseBody?.code || responseBody?.error || "");
            let retryAfterSeconds = Number(responseBody?.retry_after_seconds || 0);
            try {
                const headerValue = error.context?.headers?.get?.("Retry-After");
                if (headerValue && Number.isFinite(Number(headerValue))) retryAfterSeconds = Math.max(retryAfterSeconds, Number(headerValue));
            } catch (_) { /* El cuerpo JSON es la fuente alternativa. */ }
            const failure = new Error(code === "RATE_LIMIT_EXCEEDED"
                ? `RATE_LIMIT_EXCEEDED: el Universal Bridge alcanzó su límite${retryAfterSeconds > 0 ? `. Espera ${retryAfterSeconds} segundos antes de reanudar.` : ". El servidor no informó el tiempo de espera."}`
                : `La función de sincronización no respondió correctamente.${detail ? " " + detail : ""}`);
            failure.code = code;
            failure.httpStatus = httpStatus;
            failure.retryAfterSeconds = retryAfterSeconds;
            throw failure;
        }
        if (!data || data.ok !== true || data.write_executed !== false) {
            throw new Error(`Validación rechazada: ${String(data?.code || "RESPUESTA_INVALIDA")}`);
        }
        if (mode === "VALIDATE_ONLY" && data.rpc_executed !== false) {
            throw new Error("La respuesta no confirmó que el RPC de escritura permaneció sin ejecutar.");
        }
        return data;
    }

    function makeLocalTestOperation() {
        return {
            operation_id: uuid(),
            record_sync_id: uuid(),
            operation_type: "INSERT",
            expected_version: null,
            record_type: "inspeccion",
            parent_sync_id: null,
            payload: {
                _tecchnex_sync_lab_test_v1: true,
                _note: "VALIDACION_CONTROLADA_SIN_ESCRITURA",
                fecha_prueba: new Date().toISOString()
            }
        };
    }

    async function withBusy(task) {
        if (busy) return;
        busy = true;
        for (const id of ["camSyncValidateV1", "camSyncPrepareTestV1", "camSyncSendTestV1", "camSyncReadTestV1", "camSyncListV1", "camSyncSendV1", "camSyncValidatePackageV18"]) {
            const node = $(id);
            if (node) node.disabled = true;
        }
        try { await task(); }
        catch (error) { setStatus(error?.message || "No fue posible completar la validación.", "error"); }
        finally {
            busy = false;
            const pending = (() => { try { return readQueue().length; } catch (_) { return 0; } })();
            const validate = $("camSyncValidateV1");
            const prepare = $("camSyncPrepareTestV1");
            const sendTest = $("camSyncSendTestV1");
            const readTest = $("camSyncReadTestV1");
            const listButton = $("camSyncListV1");
            const send = $("camSyncSendV1");
            const validatePackage = $("camSyncValidatePackageV18");
            if (validate) validate.disabled = pending === 0;
            if (prepare) prepare.disabled = false;
            if (sendTest) sendTest.disabled = !preparedTest;
            if (validatePackage) { validatePackage.disabled = !importedPackage; validatePackage.style.opacity = importedPackage ? "1" : ".55"; }
            if (readTest) readTest.disabled = false;
            if (listButton) listButton.disabled = false;
            // V1 deliberadamente no permite sincronización con escritura.
            if (send) {
                send.disabled = !importedPackage;
                send.title = importedPackage ? "Sincroniza el paquete completo mediante una autorización comercial." : "Primero importa el paquete JSON.";
            }
        }
    }

    async function validateFirstPending() {
        const pending = readQueue();
        if (!pending.length) {
            setStatus("No hay operaciones pendientes en la cola local.");
            return;
        }
        const op = pending[0];
        setStatus("Validando la primera operación pendiente con el servidor; no se guardarán cambios…");
        const result = await invokeValidation(op);
        setStatus(`Validación aprobada (${result.code}). Escritura: no ejecutada. RPC: no ejecutado.`, "ok");
    }

    async function validatePreparedTest() {
        if (!preparedTest) throw new Error("Primero prepara la prueba local.");
        setStatus("Enviando una solicitud VALIDATE_ONLY de laboratorio; no se creará ningún registro…");
        const result = await invokeValidation(preparedTest);
        setStatus(`Prueba validada (${result.code}). write_executed=false; rpc_executed=false.`, "ok");
    }

    function validateImportedPackage(pkg) {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const allowed = new Set(["inspeccion", "hallazgo", "checklist", "resultado_checklist", "matriz_riesgos", "matriz_cliente", "vulnerabilidad", "agenda_visita", "actividad_gestion", "seguimiento_proceso", "evento_trazabilidad"]);
        if (!pkg || pkg.schema !== "TECCHNEX-CAM-INSPECCIONES-SYNC-PACKAGE-1" || pkg.mode !== "LOCAL_PACKAGE_ONLY") {
            throw new Error("El archivo no corresponde a un paquete TECCHNEX LOCAL_PACKAGE_ONLY.");
        }
        if (pkg.source?.id_control !== "INS-2026-0008" || pkg.source?.id_inspeccion_interno !== "d0ac9734-16ae-4bdc-8a63-36687efdccaf") {
            throw new Error("El paquete no corresponde a la inspección INS-2026-0008 esperada.");
        }
        if (!Array.isArray(pkg.records) || pkg.records.length !== MAX_PACKAGE_RECORDS || pkg.counts?.records !== MAX_PACKAGE_RECORDS) {
            throw new Error("Se esperaban exactamente 11 operaciones en el paquete.");
        }
        const ids = new Set();
        const operations = new Set();
        for (let i = 0; i < pkg.records.length; i++) {
            const op = pkg.records[i];
            if (!op || !uuidPattern.test(String(op.operation_id || "")) || !uuidPattern.test(String(op.record_sync_id || ""))) {
                throw new Error(`La operación ${i + 1} contiene identificadores UUID inválidos.`);
            }
            if (ids.has(op.record_sync_id) || operations.has(op.operation_id)) throw new Error("El paquete contiene identificadores duplicados.");
            ids.add(op.record_sync_id); operations.add(op.operation_id);
            if (op.operation_type !== "INSERT" || op.expected_version !== null || !allowed.has(op.record_type) || !op.payload || typeof op.payload !== "object" || Array.isArray(op.payload)) {
                throw new Error(`La operación ${i + 1} no cumple el contrato INSERT esperado.`);
            }
            if (i === 0) {
                if (op.record_type !== "inspeccion" || op.parent_sync_id !== null || op.record_sync_id !== pkg.source.id_inspeccion_interno) {
                    throw new Error("La primera operación debe ser la inspección principal, sin padre.");
                }
            } else if (op.parent_sync_id !== pkg.source.id_inspeccion_interno) {
                throw new Error(`La operación hija ${i + 1} no apunta a la inspección principal.`);
            }
            const body = { mode: "VALIDATE_ONLY", operation_id: op.operation_id, record_sync_id: op.record_sync_id,
                operation_type: op.operation_type, expected_version: op.expected_version,
                record_type: op.record_type, parent_sync_id: op.parent_sync_id, payload: op.payload };
            const size = new TextEncoder().encode(JSON.stringify(body)).byteLength;
            if (size > MAX_REQUEST_BYTES) throw new Error(`La operación ${i + 1} supera el límite de 1 MiB (${size} bytes).`);
        }
        if (pkg.records[0].record_type !== "inspeccion" || pkg.records.slice(1).some(x => x.record_type === "inspeccion")) {
            throw new Error("El orden o la cantidad de inspecciones del paquete no es válido.");
        }
        if (!Array.isArray(pkg.photo_manifest) || pkg.photo_manifest.length !== 16 ||
            pkg.photo_manifest.some(photo => photo.transfer_status !== "PENDING_STORAGE_UPLOAD" ||
                photo.parent_record_sync_id !== pkg.source.id_inspeccion_interno ||
                !/^[0-9a-f]{64}$/i.test(String(photo.hash_sha256 || "")))) {
            throw new Error("El manifiesto de 16 fotografías no conserva el estado pendiente y sus hashes válidos.");
        }
        return true;
    }

    async function importPackageFile(file) {
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) throw new Error("El archivo del paquete supera el límite local de 2 MiB.");
        const parsed = JSON.parse(await file.text());
        validateImportedPackage(parsed);
        importedPackage = parsed;
        packageValidationProgress = {
            packageKey: parsed.records.map(record => record.operation_id).join("|"),
            nextIndex: 0,
            passed: 0,
            details: []
        };
        const button = $("camSyncValidatePackageV18");
        if (button) { button.disabled = false; button.style.opacity = "1"; }
        const sendButton = $("camSyncSendV1"); if (sendButton) { sendButton.disabled = false; sendButton.title = "Sincroniza el paquete completo mediante una autorización comercial."; }
        setStatus(`Paquete V1.8 cargado en memoria: ${parsed.records.length} operaciones. Aún no se ha enviado ninguna solicitud.`, "ok");
    }

    async function invokePackage(mode) {
        if (!importedPackage) throw new Error("Primero selecciona el JSON del paquete V1.8.");
        validateImportedPackage(importedPackage);
        const client = await getClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError || !sessionData?.session?.access_token) throw new Error("No hay una sesión autenticada. Inicia sesión y vuelve a intentar.");
        const { data, error } = await client.functions.invoke(PACKAGE_FUNCTION_NAME, {
            body: { mode, package: importedPackage }
        });
        if (error) {
            // Supabase convierte respuestas HTTP 207 en FunctionsHttpError.
            // Recuperamos el cuerpo para mostrar el avance parcial real y
            // permitir reintentar el mismo paquete con sus UUID originales.
            let responseBody = null;
            let httpStatus = Number(error.context?.status || 0);
            try {
                if (error.context && typeof error.context.clone === "function") {
                    const response = error.context.clone();
                    httpStatus = Number(response.status || httpStatus);
                    responseBody = await response.json();
                }
            } catch (_) { /* La respuesta puede no contener JSON. */ }
            if (httpStatus === 207 && responseBody?.code === "PACKAGE_PARTIAL_FAILURE") return responseBody;
            const code = String(responseBody?.code || responseBody?.error || "");
            throw new Error(`El servidor no confirmó el paquete${code ? ` (${code})` : ""}.${responseBody ? " " + JSON.stringify(responseBody) : ""}`);
        }
        return data;
    }

    async function validateImportedPackageV18() {
        if (!importedPackage) throw new Error("Primero selecciona el JSON del paquete V1.8.");
        setStatus("Validando el paquete completo con una sola autorización comercial; sin escrituras…");
        const result = await invokePackage("VALIDATE_ONLY");
        if (!result || result.ok !== true || result.code !== "PACKAGE_VALIDATED" ||
            result.package_records !== importedPackage.records.length || result.bridge_authorizations !== 1 ||
            result.write_executed !== false || result.rpc_executed !== false) {
            throw new Error(`Validación de paquete no confirmada: ${String(result?.code || "RESPUESTA_INVALIDA")}`);
        }
        const node = $("camSyncPackageResultsV18");
        if (node) node.textContent = `✓ Paquete validado: ${result.package_records}/${result.package_records}\n✓ Autorizaciones Universal Bridge: 1\n✓ Escrituras: 0 · RPC: 0 · Fotografías: pendientes`;
        setStatus("PAQUETE VALIDADO. Una autorización comercial para todo el lote. Sin escrituras ni RPC.", "ok");
    }

    async function syncImportedPackage() {
        if (!importedPackage) throw new Error("Primero selecciona el JSON del paquete V1.8.");
        validateImportedPackage(importedPackage);
        const accepted = window.confirm(
            `Se enviará INS-2026-0008 como un solo paquete de ${importedPackage.records.length} registros. ` +
            "El servidor realizará UNA autorización Universal Bridge y luego ejecutará INSERT en las tablas existentes mediante el RPC actual. " +
            "Si una operación falla, el resultado puede ser parcial; el mismo paquete podrá reintentarse con idempotencia. " +
            "Las 16 fotografías NO se transferirán en esta etapa. ¿Autorizar la escritura real de este paquete?"
        );
        if (!accepted) { setStatus("Sincronización cancelada. No se realizaron escrituras."); return; }
        setStatus("Enviando paquete completo. Una autorización comercial; registros en orden…");
        const result = await invokePackage("SYNC");
        const node = $("camSyncPackageResultsV18");
        if (node) node.textContent = (result?.results || []).map(x => `${x.ok ? "✓" : "✗"} ${x.index}/${result.total} · ${x.record_type} · ${x.code}`).join("\n");
        if (result?.ok === true && result.code === "PACKAGE_SYNC_COMPLETED" && result.completed === importedPackage.records.length) {
            setStatus(`SINCRONIZACIÓN COMPLETADA: ${result.completed}/${result.total} registros. Autorizaciones Universal Bridge: 1. Fotografías: pendientes de Storage.`, "ok");
            return;
        }
        throw new Error(`Paquete con resultado parcial: ${result?.completed ?? 0}/${result?.total ?? importedPackage.records.length}. Código: ${result?.code || "RESPUESTA_INVALIDA"}. Conserva el mismo JSON para reintentar de forma idempotente.`);
    }


    async function retrieveRemoteInspectionList() {
        const accepted = window.confirm(
            "Se consultarán las inspecciones guardadas en Supabase para el cliente y contrato autorizados. " +
            "La operación es solo de lectura: no modifica Supabase ni guarda o reemplaza información de este equipo. ¿Continuar?"
        );
        if (!accepted) {
            setStatus("Recuperación cancelada. No se realizaron cambios.");
            return;
        }

        const client = await getClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (sessionError || !accessToken) {
            throw new Error("No hay una sesión autenticada. Inicia sesión y vuelve a intentar.");
        }

        const pageSize = 5;
        const maxPages = 100;
        const all = [];
        let page = 0;
        let total = null;
        let hasMore = true;
        while (hasMore && page < maxPages) {
            setStatus(`Consultando inspecciones remotas: página ${page + 1}…`);
            const { data, error } = await client.functions.invoke(READ_FUNCTION_NAME, {
                body: { mode: "LIST_INSPECTIONS", page, page_size: pageSize }
            });
            if (error) {
                let detail = "";
                try {
                    const response = error.context && typeof error.context.clone === "function"
                        ? await error.context.clone().json() : null;
                    if (response?.code) detail = ` Código: ${String(response.code)}.`;
                } catch (_) { /* no se exponen cabeceras ni datos sensibles */ }
                throw new Error(`No fue posible recuperar la página ${page + 1}.${detail}`);
            }
            if (!data || data.ok !== true || data.code !== "INSPECTIONS_LISTED" ||
                !Array.isArray(data.inspections) || data.page !== page ||
                data.write_executed !== false) {
                throw new Error(`Respuesta de recuperación no válida en página ${page + 1}: ${String(data?.code || "RESPUESTA_INVALIDA")}`);
            }
            if (total === null) total = Number.isInteger(data.total_inspections) ? data.total_inspections : 0;
            for (const item of data.inspections) {
                if (item?.record?.record_type !== "inspeccion" ||
                    typeof item.record.record_sync_id !== "string" ||
                    !item.record.payload || typeof item.record.payload !== "object" ||
                    !Array.isArray(item.related_records)) {
                    throw new Error("El servidor devolvió una inspección con estructura incompleta. No se guardó información local.");
                }
                all.push(item);
            }
            hasMore = data.has_more === true;
            page++;
        }
        if (hasMore) {
            throw new Error(`La consulta superó el límite de seguridad de ${maxPages} páginas. Se consultaron ${all.length} inspecciones, sin guardar datos localmente.`);
        }

        const adapter = window.TECCHNEXCamInspeccionesRecoveryAdapterV1;
        if (!adapter || typeof adapter.makePlan !== "function") {
            throw new Error("No está disponible el adaptador seguro de recuperación. No se modificó información local.");
        }
        const localState = {};
        const localArrayKeys = [
            "inspecciones", "hallazgos", "checklists", "matrizRiesgos", "matricesRiesgosClientes",
            "tecchnex_lista_vulnerabilidades_multisector_v1_registros_v2",
            "tecchnex_agenda_supervision_v1", "tecchnex_mi_gestion_actividades_v1", "bitacoraTrazabilidad"
        ];
        for (const key of localArrayKeys) {
            try {
                const value = JSON.parse(localStorage.getItem(key) || "[]");
                if (!Array.isArray(value)) throw new Error(`La clave local ${key} no es un arreglo.`);
                const aliases = {
                    "tecchnex_lista_vulnerabilidades_multisector_v1_registros_v2": "evaluacionesVulnerabilidades",
                    "tecchnex_agenda_supervision_v1": "agendaSupervision",
                    "tecchnex_mi_gestion_actividades_v1": "actividadesMiGestion",
                    "bitacoraTrazabilidad": "bitacoraTrazabilidad"
                };
                localState[aliases[key] || key] = value;
            } catch (error) {
                throw new Error(`No se pudo auditar ${key}: ${error.message}. No se modificó información local.`);
            }
        }
        try {
            const followup = JSON.parse(localStorage.getItem("tecchnex_mi_gestion_seguimiento_v1") || "{}");
            if (!followup || typeof followup !== "object" || Array.isArray(followup)) throw new Error("la estructura no es un objeto.");
            localState.seguimientoInspeccionesMiGestion = followup;
        } catch (error) {
            throw new Error(`No se pudo auditar el seguimiento local: ${error.message}. No se modificó información local.`);
        }
        const plan = adapter.makePlan(all, localState);
        const counts = {};
        const lines = all.slice(0, 20).map((item, index) => {
            const payload = item.record.payload || {};
            const related = item.related_records || [];
            const label = String(payload.idControl || payload.idInforme || item.record.record_sync_id).slice(0, 48);
            const date = String(payload.fecha || "Fecha no indicada").slice(0, 24);
            const place = String(payload.nombrePuesto || payload.cliente || "Puesto no indicado").slice(0, 55);
            for (const child of related) {
                const type = String(child?.record_type || "otro");
                counts[type] = (counts[type] || 0) + 1;
            }
            return `${index + 1}. ${label} · ${date} · ${place} · ${related.length} relacionados`;
        });
        const relatedSummary = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]))
            .map(([type, count]) => `${type}: ${count}`).join(" | ") || "Sin registros relacionados";
        const resultNode = $("camSyncListResultsV1");
        if (resultNode) {
            resultNode.textContent = [
                `INSPECCIONES EN SERVIDOR: ${all.length} de ${total ?? all.length}`,
                `Registros relacionados recuperados: ${Object.values(counts).reduce((a, b) => a + b, 0)} (${relatedSummary})`,
                "VISTA PREVIA DE INCORPORACIÓN (sin guardar):",
                ...Object.entries(plan.add_counts).map(([key, count]) => `  ${key}: ${count} nuevo(s) propuesto(s) · ${plan.duplicate_counts[key]} duplicado(s)`),
                `Inspecciones incompletas: ${plan.incomplete_inspections} · registros inválidos: ${plan.invalid_records}`,
                `Tipos aún no incorporables: ${Object.entries(plan.unsupported_record_types).map(([type, count]) => `${type} (${count})`).join(", ") || "ninguno"}`,
                ...Object.entries(plan.deferred_record_types || {}).map(([type, detail]) => `  ${type}: pospuesto (${detail.count}). ${detail.reason}`),
                "Fotos: requieren integración independiente de Storage; no se transfieren.",
                "Agenda, actividades y trazabilidad: mapeadas a sus claves locales existentes; seguimiento y resultados de checklist permanecen protegidos hasta confirmar asociación.",
                ...lines,
                all.length > 20 ? `… y ${all.length - 20} inspección(es) más.` : "",
                "Modo PREVIEW_ONLY. No se modificó Supabase ni el almacenamiento local (localStorage/IndexedDB). La incorporación real sigue desactivada."
            ].filter(Boolean).join("\n");
        }
        setStatus(
            `Consulta completada: ${all.length} inspección(es). Vista previa: ${Object.values(plan.add_counts).reduce((a, b) => a + b, 0)} registros nuevos propuestos; sin cambios locales ni escrituras remotas.`,
            "ok"
        );
    }

    async function validatePendingBatch() {
        const pending = readQueue().slice(0, MAX_VALIDATE_BATCH);
        if (!pending.length) {
            setStatus("No hay operaciones pendientes para validar.");
            return;
        }
        let passed = 0;
        for (let i = 0; i < pending.length; i++) {
            setStatus(`Validando operación ${i + 1} de ${pending.length}; sin escrituras…`);
            await invokeValidation(pending[i]);
            passed++;
        }
        setStatus(`${passed} operación(es) validadas. Ninguna fue escrita ni marcada como sincronizada.`, "ok");
    }

    function initialize() {
        const validate = $("camSyncValidateV1");
        const prepare = $("camSyncPrepareTestV1");
        const sendTest = $("camSyncSendTestV1");
        const readTest = $("camSyncReadTestV1");
        const listButton = $("camSyncListV1");
        const send = $("camSyncSendV1");
        const packageInput = $("camSyncPackageFileV18");
        const validatePackage = $("camSyncValidatePackageV18");
        if (!statusNode() || !validate || !prepare || !sendTest || !readTest || !send) return;

        validate.addEventListener("click", () => withBusy(validateFirstPending));
        if (packageInput && validatePackage) {
            packageInput.addEventListener("change", () => withBusy(async () => {
                importedPackage = null; validatePackage.disabled = true;
                await importPackageFile(packageInput.files && packageInput.files[0]);
            }));
            validatePackage.addEventListener("click", () => withBusy(validateImportedPackageV18));
            validatePackage.disabled = true;
        }
        prepare.addEventListener("click", () => withBusy(async () => {
            preparedTest = makeLocalTestOperation();
            sendTest.disabled = false;
            setStatus("Prueba local preparada en memoria. Aún no se ha enviado ni guardado en Supabase.", "ok");
        }));
        if (listButton) listButton.addEventListener("click", () => withBusy(retrieveRemoteInspectionList));
        readTest.addEventListener("click", () => withBusy(async () => {
            const accepted = window.confirm(
                "Se consultará UNA inspección real ya registrada en Admin Maestro. " +
                "La consulta será exclusivamente de lectura: no modificará registros, " +
                "no guardará datos en este dispositivo y no descargará fotografías. ¿Continuar?"
            );
            if (!accepted) {
                setStatus("Consulta cancelada. No se realizaron cambios.");
                return;
            }
            setStatus("Consultando la inspección real en Admin Maestro…");
            const client = await getClient();
            const { data: sessionData, error: sessionError } = await client.auth.getSession();
            const accessToken = sessionData?.session?.access_token;
            if (sessionError || !accessToken) {
                throw new Error("No hay una sesión autenticada. Inicia sesión y vuelve a intentar.");
            }
            const { data, error } = await client.functions.invoke(READ_FUNCTION_NAME, {
                body: { record_sync_id: REAL_INSPECTION_READ_ID }
            });
            if (error) {
                let detail = "";
                try { detail = error.context && typeof error.context.json === "function" ? JSON.stringify(await error.context.json()) : ""; }
                catch (_) { /* no se expone información sensible */ }
                throw new Error(`La función de lectura no respondió correctamente.${detail ? " " + detail : ""}`);
            }
            if (!data || data.ok !== true || data.code !== "RECORD_RECOVERED" ||
                data.record?.record_sync_id !== REAL_INSPECTION_READ_ID ||
                data.record?.record_type !== "inspeccion" ||
                !data.record?.payload || typeof data.record.payload !== "object" ||
                data.record.payload._tecchnex_sync_lab_test_v1 === true) {
                throw new Error(`Lectura no confirmada: ${String(data?.code || "RESPUESTA_INVALIDA")}`);
            }
            const payload = data.record.payload;
            const cliente = String(payload.cliente || "Cliente no especificado").slice(0, 90);
            const puesto = String(payload.nombrePuesto || payload.idControl || "Puesto no especificado").slice(0, 90);
            const ciudad = String(payload.ciudad || "Ciudad no especificada").slice(0, 70);
            const fecha = String(payload.fecha || "Fecha no especificada").slice(0, 30);
            const campos = Object.keys(payload).length;
            const relacionados = Array.isArray(data.related_records) ? data.related_records : [];
            const resumen = relacionados.reduce((acc, item) => {
                const tipo = String(item?.record_type || "otro").toLowerCase();
                acc[tipo] = (acc[tipo] || 0) + 1;
                return acc;
            }, {});
            const detalle = `Relacionados: ${relacionados.length} (hallazgos: ${resumen.hallazgo || resumen.hallazgos || 0}, checklists: ${resumen.checklist || resumen.checklists || 0}, matrices: ${resumen.matriz_riesgos || resumen.matriz || 0}).`;
            const integridad = data.related_records_complete === false ? " Hay más de 500 registros relacionados; lectura parcial." : "";
            setStatus(`INSPECCIÓN REAL RECUPERADA: ${cliente} · ${puesto} · ${ciudad} · ${fecha}. ${campos} campos, versión ${data.record.version}. ${detalle}${integridad} Solo lectura; sin escrituras ni cambios locales. Fotografías: pendiente de contrato de Storage.`, "ok");
        }));

        sendTest.addEventListener("click", () => withBusy(async () => {
            if (!preparedTest) throw new Error("Primero prepara la prueba local.");
            const accepted = window.confirm(
                "Se enviará UNA inspección ficticia de laboratorio a Supabase. " +
                "Se crearán un registro y una operación en las tablas existentes. ¿Continuar?"
            );
            if (!accepted) {
                setStatus("Envío cancelado. No se realizaron escrituras.");
                return;
            }

            setStatus("Enviando una única inspección ficticia a Supabase…");
            const client = await getClient();
            const { data: sessionData, error: sessionError } = await client.auth.getSession();
            const accessToken = sessionData?.session?.access_token;
            if (sessionError || !accessToken) {
                throw new Error("No hay una sesión autenticada. Inicia sesión y vuelve a preparar la prueba.");
            }

            const body = {
                operation_id: preparedTest.operation_id,
                record_sync_id: preparedTest.record_sync_id,
                operation_type: "INSERT",
                expected_version: null,
                record_type: "inspeccion",
                parent_sync_id: null,
                payload: preparedTest.payload
            };
            const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body });
            if (error) {
                throw new Error("La función de sincronización no confirmó la escritura. Revisa el estado remoto antes de reintentar.");
            }
            if (!data || data.ok !== true || data.code !== "COMPLETED") {
                throw new Error(`La operación no se completó: ${String(data?.code || "RESPUESTA_INVALIDA")}`);
            }

            preparedTest = null;
            setStatus(
                `Prueba controlada completada. Registro ficticio creado. Versión ${data.result_version}. No se enviaron fotografías.`,
                "ok"
            );
        }));
        send.addEventListener("click", (event) => { event.preventDefault(); withBusy(syncImportedPackage); });

        try {
            const count = readQueue().length;
            validate.disabled = count === 0;
            send.disabled = !importedPackage;
            send.title = "Importa un paquete para habilitar sincronización integrada.";
            setStatus(`Cliente V1.12 cargado. ${count} operación(es) pendientes en cola local. La sincronización por paquete requiere importar el JSON.`);
        } catch (error) {
            validate.disabled = true;
            send.disabled = true;
            setStatus(error.message, "error");
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();

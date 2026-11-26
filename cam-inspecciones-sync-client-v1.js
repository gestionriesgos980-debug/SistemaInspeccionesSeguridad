/*
 * TECCHNEX CAM-INSPECCIONES — cliente de sincronización V1 (LAB)
 *
 * Alcance de esta entrega:
 * - Conecta con la Edge Function existente mediante la sesión Supabase del gate.
 * - Conserva la validación individual de la cola local.
 * - Valida y sincroniza paquetes mediante la Edge Function agrupada V1.
 * - La escritura real requiere confirmación expresa del usuario en pantalla.
 * - Las fotografías se transfieren al bucket privado mediante URLs firmadas de uso único.
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
    const MEDIA_BUCKET = "tecchnex-cam-inspecciones-media";
    const REAL_INSPECTION_TARGET_DATE = "2026-09-26";
    const REAL_INSPECTION_TARGET_POST = "CONJUNTO DE USO MIXTO CAMINO DE COLORES P.H";
    const MAX_VALIDATE_BATCH = 10;
    const MAX_PACKAGE_RECORDS = 100; // Límite de seguridad; el cuerpo completo sigue limitado a 1 MiB.
    const MAX_REQUEST_BYTES = 1024 * 1024;
    let importedPackage = null;
    let preparedMediaUploads = null;
    // Progreso de VALIDATE_ONLY conservado solo en memoria durante esta sesión.
    let packageValidationProgress = null;
    let remoteInspectionPackages = [];

    const $ = (id) => document.getElementById(id);
    const statusNode = () => $("camSyncStatusV1");
    let clientPromise = null;
    let preparedTest = null;
    let busy = false;
    let mediaObjectUrls = [];

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
        for (const id of ["camSyncValidateV1", "camSyncPrepareTestV1", "camSyncSendTestV1", "camSyncReadTestV1", "camSyncListV1", "camSyncSendV1", "camSyncValidatePackageV18", "camSyncImportRemoteV1"]) {
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
            const importRemote = $("camSyncImportRemoteV1");
            if (validate) validate.disabled = pending === 0;
            if (prepare) prepare.disabled = false;
            if (sendTest) sendTest.disabled = !preparedTest;
            if (validatePackage) { validatePackage.disabled = !importedPackage; validatePackage.style.opacity = importedPackage ? "1" : ".55"; }
            if (readTest) readTest.disabled = false;
            if (listButton) listButton.disabled = false;
            if (importRemote) importRemote.disabled = !remoteInspectionPackages.length;
            // La recepción local requiere acción y confirmación explícitas; el envío conserva su flujo propio.
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
        if (typeof pkg.source?.id_control !== "string" || !pkg.source.id_control.trim() ||
            !uuidPattern.test(String(pkg.source?.id_inspeccion_interno || ""))) {
            throw new Error("El paquete no contiene una identidad de inspección válida.");
        }
        if (!Array.isArray(pkg.records) || pkg.records.length < 1 ||
            pkg.records.length > MAX_PACKAGE_RECORDS || pkg.counts?.records !== pkg.records.length) {
            throw new Error(`El paquete debe contener entre 1 y ${MAX_PACKAGE_RECORDS} registros y declarar el mismo total.`);
        }
        const root = pkg.records[0];
        const rootDate = String(root?.payload?.fecha || "").slice(0, 10);
        const rootPost = String(root?.payload?.nombrePuesto || "").trim().replace(/\s+/g, " ").toLowerCase();
        const functionalKey = `${rootDate}|${rootPost}`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rootDate) || !rootPost ||
            pkg.source?.clave_funcional !== functionalKey ||
            String(root.payload?.claveInspeccionPuestoFecha || "").trim() !== functionalKey ||
            String(pkg.source?.fecha || "") !== rootDate ||
            String(pkg.source?.nombre_puesto || "").trim() !== String(root.payload?.nombrePuesto || "").trim()) {
            throw new Error("La identidad funcional del paquete no coincide con puesto + fecha. Se bloqueó la importación.");
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
        if (!Array.isArray(pkg.photo_manifest) ||
            pkg.counts?.photos_manifest !== pkg.photo_manifest.length) {
            throw new Error("El manifiesto fotográfico no coincide con el total declarado.");
        }
        const mediaIds = new Set();
        for (let i = 0; i < pkg.photo_manifest.length; i++) {
            const photo = pkg.photo_manifest[i];
            if (!photo || typeof photo.media_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(photo.media_id) ||
                mediaIds.has(photo.media_id) || photo.transfer_status !== "PENDING_STORAGE_UPLOAD" ||
                photo.parent_record_sync_id !== pkg.source.id_inspeccion_interno ||
                String(photo.id_control || "") !== pkg.source.id_control ||
                !/^[0-9a-f]{64}$/i.test(String(photo.hash_sha256 || "")) ||
                !String(photo.finding_number || "").trim()) {
                throw new Error(`La referencia fotográfica ${i + 1} está incompleta, duplicada o no pertenece a esta inspección.`);
            }
            mediaIds.add(photo.media_id);
        }
        const requestBytes = new TextEncoder().encode(JSON.stringify({ mode: "VALIDATE_ONLY", package: pkg })).byteLength;
        if (requestBytes > MAX_REQUEST_BYTES) {
            throw new Error(`El paquete completo supera el límite de 1 MiB (${requestBytes} bytes).`);
        }
        return true;
    }

    async function importPackageFile(file) {
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) throw new Error("El archivo del paquete supera el límite local de 2 MiB.");
        const parsed = JSON.parse(await file.text());
        validateImportedPackage(parsed);
        importedPackage = parsed;
        preparedMediaUploads = null;
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
            result.write_executed !== false || result.rpc_executed !== false ||
            result.media_uploads_prepared !== importedPackage.photo_manifest.length ||
            !Array.isArray(result.uploads) || result.uploads.length !== importedPackage.photo_manifest.length) {
            throw new Error(`Validación de paquete no confirmada: ${String(result?.code || "RESPUESTA_INVALIDA")}`);
        }
        preparedMediaUploads = result.uploads;
        const node = $("camSyncPackageResultsV18");
        if (node) node.textContent = `✓ Paquete validado: ${result.package_records}/${result.package_records}\n✓ Autorizaciones Universal Bridge: 1\n✓ Escrituras: 0 · RPC: 0 · URLs privadas preparadas: ${result.media_uploads_prepared}`;
        setStatus("PAQUETE VALIDADO. URLs privadas preparadas; todavía no se cargaron fotos ni se guardaron registros.", "ok");
    }

    async function prepareAndUploadPackagePhotos(client) {
        const manifest = importedPackage.photo_manifest || [];
        if (!manifest.length) return [];
        const audit = window.CAM_INSPECCIONES_LAST_EXPORT_AUDIT;
        if (!audit || String(audit.source?.idControl || "") !== String(importedPackage.source.id_control || "")) {
            throw new Error("No está disponible la auditoría local de esta inspección. Vuelve a seleccionar el respaldo original y genera el paquete en esta misma sesión.");
        }
        const mediaRows = Array.isArray(audit.related?.media) ? audit.related.media : [];
        const byId = new Map(mediaRows.map(row => [String(row?.payload?.mediaId || ""), row?.payload || {}]));
        const files = [];
        for (const item of manifest) {
            const media = byId.get(String(item.media_id));
            const dataUrl = String(media?.dataUrl || "");
            if (!/^data:image\/(jpeg|png|webp);base64,/i.test(dataUrl)) {
                throw new Error(`No se encontró la imagen original ${item.media_id}. No se iniciará el envío de registros.`);
            }
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
            const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
            if (hash.toLowerCase() !== String(item.hash_sha256).toLowerCase()) {
                throw new Error(`La fotografía ${item.media_id} no supera la comprobación SHA-256. No se enviarán registros.`);
            }
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            const mime = String(blob.type || item.mime_type || "").toLowerCase();
            if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(mime) || !blob.size) {
                throw new Error(`La fotografía ${item.media_id} tiene un formato o tamaño no permitido.`);
            }
            files.push({ item, blob, mime });
        }
        if (!Array.isArray(preparedMediaUploads) || preparedMediaUploads.length !== files.length) {
            throw new Error("Primero ejecuta VALIDAR PAQUETE para preparar las autorizaciones privadas de las fotografías. No se enviaron registros.");
        }
        const uploadById = new Map(preparedMediaUploads.map(row => [String(row.media_id), row]));
        const stored = [];
        for (let i = 0; i < files.length; i++) {
            const { item, blob, mime } = files[i];
            const signed = uploadById.get(String(item.media_id));
            if (!signed?.path || !signed?.token || signed.hash_sha256 !== item.hash_sha256) {
                throw new Error(`La autorización de carga de la fotografía ${item.media_id} no coincide con su manifiesto.`);
            }
            setStatus(`Subiendo fotografía ${i + 1}/${files.length}…`);
            const { error } = await client.storage.from(MEDIA_BUCKET).uploadToSignedUrl(
                signed.path, signed.token, blob, { contentType: mime, upsert: true }
            );
            if (error) throw new Error(`Falló la carga de la fotografía ${i + 1}/${files.length}. Se conservaron los archivos locales; reintenta con el mismo paquete. No se enviarán registros hasta completar las fotos.`);
            stored.push({ media_id: item.media_id, path: signed.path, hash_sha256: item.hash_sha256,
                finding_number: item.finding_number, parent_record_sync_id: item.parent_record_sync_id,
                mime_type: mime, size_bytes: blob.size });
        }
        importedPackage.records[0].payload._tecchnex_media_manifest_v1 = {
            bucket: MEDIA_BUCKET, inspection_sync_id: importedPackage.source.id_inspeccion_interno,
            photos: stored, completed: true
        };
        return stored;
    }

    // Solo retira de pendientes la raíz exacta cuyo paquete fue confirmado por el servidor.
    // Nunca limpia la cola completa ni toca operaciones de otras inspecciones.
    function reconcileCompletedPackageQueue(pkg, result) {
        const source = pkg?.source || {};
        const rootResult = Array.isArray(result?.results)
            ? result.results.find(item => item && item.record_sync_id === source.id_inspeccion_interno)
            : null;
        // El RPC devuelve "COMPLETED" en el primer envío y puede devolver
        // "completed" (estado persistido) cuando responde a un reintento idempotente.
        // Ambos representan confirmación válida solo si ok=true y existe versión remota.
        const rootCode = String(rootResult?.code || "").trim().toUpperCase();
        if (!rootResult || rootResult.ok !== true || rootCode !== "COMPLETED" ||
            !Number.isSafeInteger(Number(rootResult.result_version)) || Number(rootResult.result_version) < 1) {
            return { updated: false, reason: "la respuesta no incluye confirmación y versión de la inspección principal" };
        }

        let queue;
        try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
        catch (_) { return { updated: false, reason: "la cola local no contiene JSON válido" }; }
        if (!Array.isArray(queue)) return { updated: false, reason: "la estructura de la cola local no es válida" };

        const idControl = String(source.id_control || "").trim();
        const internalId = String(source.id_inspeccion_interno || "").trim();
        const fecha = String(source.fecha || "").slice(0, 10);
        const puesto = String(source.nombre_puesto || "").trim().replace(/\s+/g, " ").toLowerCase();
        if (!idControl || !internalId || !fecha || !puesto) {
            return { updated: false, reason: "el paquete no contiene la identidad completa de origen" };
        }
        const matches = [];
        queue.forEach((operation, index) => {
            const payload = operation?.payload || {};
            const opDate = String(payload.fecha || payload.fechaInspeccion || "").slice(0, 10);
            const opPost = String(payload.nombrePuesto || payload.puesto || "").trim().replace(/\s+/g, " ").toLowerCase();
            if (operation?.status === "pending" && operation?.record_type === "inspeccion" &&
                String(payload.idControl || "").trim() === idControl &&
                String(payload.idInspeccionInterno || "").trim() === internalId &&
                opDate === fecha && opPost === puesto) matches.push(index);
        });
        if (matches.length !== 1) {
            return { updated: false, reason: matches.length === 0
                ? "no se encontró una única operación pendiente con la misma identidad"
                : "hay varias operaciones pendientes con la misma identidad; se requiere revisión" };
        }

        const index = matches[0];
        const updatedQueue = queue.slice();
        updatedQueue[index] = {
            ...queue[index],
            status: "completed",
            completed_at: new Date().toISOString(),
            remote_confirmed: true,
            remote_record_sync_id: rootResult.record_sync_id,
            remote_version: Number(rootResult.result_version),
            remote_confirmation_code: rootResult.code
        };
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(updatedQueue));
        } catch (_) {
            return { updated: false, reason: "el navegador no permitió guardar el estado actualizado de la cola" };
        }
        return { updated: true, idControl };
    }

    async function syncImportedPackage() {
        if (!importedPackage) throw new Error("Primero selecciona el JSON del paquete V1.8.");
        validateImportedPackage(importedPackage);
        const accepted = window.confirm(
            `Se enviará la inspección ${importedPackage.source.id_control} como un solo paquete de ${importedPackage.records.length} registros relacionados y ${importedPackage.photo_manifest.length} fotografías. ` +
            "Primero se cargarán las fotografías al bucket privado mediante autorizaciones firmadas; después se guardarán los registros en las tablas existentes con el RPC actual. " +
            "Si algo falla, se conservarán los datos locales y podrás reintentar el mismo paquete. ¿Autorizar el envío desde este equipo?"
        );
        if (!accepted) { setStatus("Sincronización cancelada. No se realizaron escrituras."); return; }
        const client = await getClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError || !sessionData?.session?.access_token) throw new Error("No hay una sesión autenticada. Inicia sesión y vuelve a intentar.");
        const uploadedPhotos = await prepareAndUploadPackagePhotos(client);
        setStatus("Fotografías verificadas en Storage. Enviando registros relacionados…");
        const result = await invokePackage("SYNC");
        const node = $("camSyncPackageResultsV18");
        if (node) node.textContent = (result?.results || []).map(x => `${x.ok ? "✓" : "✗"} ${x.index}/${result.total} · ${x.record_type} · ${x.code}`).join("\n");
        if (result?.ok === true && result.code === "PACKAGE_SYNC_COMPLETED" && result.completed === importedPackage.records.length) {
            const reconciliation = reconcileCompletedPackageQueue(importedPackage, result);
            const successMessage = `SINCRONIZACIÓN COMPLETADA: ${result.completed}/${result.total} registros y ${uploadedPhotos.length} fotografías verificadas en Storage. Las asociaciones quedaron en el manifiesto de la inspección.`;
            if (reconciliation.updated) {
                setStatus(`${successMessage} La operación ${reconciliation.idControl} se marcó como completada en la cola local.`, "ok");
            } else {
                setStatus(`${successMessage} ADVERTENCIA: el servidor confirmó el envío, pero la cola local no se modificó: ${reconciliation.reason}`, "error");
            }
            return;
        }
        throw new Error(`Paquete con resultado parcial: ${result?.completed ?? 0}/${result?.total ?? importedPackage.records.length}. Código: ${result?.code || "RESPUESTA_INVALIDA"}. Conserva el mismo JSON para reintentar de forma idempotente.`);
    }


    async function retrieveRemoteInspectionList() {
        // Consulta estrictamente de lectura: no requiere confirmación adicional.
        // La confirmación explícita se conserva en el paso posterior de incorporación local.
        const client = await getClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (sessionError || !accessToken) {
            throw new Error("No hay una sesión autenticada. Inicia sesión y vuelve a intentar.");
        }

        // Contrato alineado con la Edge Function desplegada:
        // mode=LIST, page_size y cursor {updated_at, sync_id}.
        // La función devuelve records[] y next_cursor; no usa page/page_size
        // ni devuelve inspections[].
        const pageSize = 50;
        const maxPages = 1000;
        const records = [];
        let cursor = null;
        let continuationToken = null;
        let page = 0;
        while (page < maxPages) {
            setStatus(`Consultando registros remotos: página ${page + 1}…`);
            const body = { mode: "LIST", page_size: pageSize };
            if (cursor) body.cursor = cursor;
            if (continuationToken) body.continuation_token = continuationToken;
            const { data, error } = await client.functions.invoke(READ_FUNCTION_NAME, { body });
            if (error) {
                let detail = "";
                try {
                    const response = error.context && typeof error.context.clone === "function"
                        ? await error.context.clone().json() : null;
                    if (response?.code) detail = ` Código: ${String(response.code)}.`;
                } catch (_) { /* no se exponen cabeceras ni datos sensibles */ }
                throw new Error(`No fue posible recuperar la página ${page + 1}.${detail}`);
            }
            if (!data || data.ok !== true || data.code !== "RECORD_PAGE_RECOVERED" ||
                !Array.isArray(data.records) || typeof data.continuation_token !== "string" || !data.continuation_token || !Number.isInteger(data.page_size) ||
                data.page_size < 1 || data.page_size > pageSize) {
                throw new Error(`Respuesta de recuperación no válida en página ${page + 1}: ${String(data?.code || "RESPUESTA_INVALIDA")}`);
            }
            continuationToken = data.continuation_token;
            for (const record of data.records) {
                if (!record || typeof record.record_sync_id !== "string" ||
                    typeof record.record_type !== "string" ||
                    (record.parent_sync_id !== null && typeof record.parent_sync_id !== "string") ||
                    !record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
                    throw new Error("El servidor devolvió un registro con estructura incompleta. No se guardó información local.");
                }
                records.push(record);
            }
            const next = data.next_cursor;
            if (next === null || next === undefined) break;
            if (!next || typeof next.updated_at !== "string" || typeof next.sync_id !== "string" ||
                (cursor && next.updated_at === cursor.updated_at && next.sync_id === cursor.sync_id)) {
                throw new Error("El servidor devolvió un cursor inválido o repetido. No se guardó información local.");
            }
            cursor = next;
            page++;
        }
        if (page >= maxPages && cursor) {
            throw new Error(`La consulta superó el límite de seguridad de ${maxPages} páginas. Se recuperaron ${records.length} registros, sin guardar datos localmente.`);
        }

        // La Edge Function lista el conjunto paginado de registros, no paquetes
        // por inspección. Agrupamos hijos por parent_sync_id en memoria.
        const activeRecords = records.filter(record => !record.deleted_at);
        const roots = activeRecords.filter(record => record.record_type === "inspeccion" && !record.parent_sync_id);
        const childrenByParent = new Map();
        for (const record of activeRecords) {
            if (!record.parent_sync_id) continue;
            if (!childrenByParent.has(record.parent_sync_id)) childrenByParent.set(record.parent_sync_id, []);
            childrenByParent.get(record.parent_sync_id).push(record);
        }
        const all = roots.map(record => ({
            record,
            related_records: childrenByParent.get(record.record_sync_id) || [],
            related_records_complete: true,
            photo_manifest: Array.isArray(record.payload?._tecchnex_media_manifest_v1?.photos)
                ? record.payload._tecchnex_media_manifest_v1.photos : []
        }));
        remoteInspectionPackages = all;
        const remoteSelect = $("camSyncRemoteInspectionV1");
        if (remoteSelect) {
            remoteSelect.replaceChildren();
            all.forEach((item, index) => {
                const option = document.createElement("option");
                const p = item.record.payload || {};
                option.value = String(index);
                option.textContent = `${p.fecha || "Sin fecha"} · ${p.nombrePuesto || p.cliente || "Sin puesto"} · ${item.related_records.length} relacionados`;
                remoteSelect.appendChild(option);
            });
        }
        const importRemoteButton = $("camSyncImportRemoteV1");
        if (importRemoteButton) importRemoteButton.disabled = all.length === 0;

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
                if (!Array.isArray(value)) throw new Error(`la clave local ${key} no contiene un arreglo.`);
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
                `INSPECCIONES EN SERVIDOR: ${all.length}`,
                `Registros activos recuperados: ${activeRecords.length} de ${records.length} (incluye registros relacionados)`,
                `Registros relacionados recuperados: ${Object.values(counts).reduce((a, b) => a + b, 0)} (${relatedSummary})`,
                "RECEPCIÓN DISPONIBLE: selecciona una inspección para incorporarla en este equipo.",
                `Registros relacionados: ${Object.values(counts).reduce((a, b) => a + b, 0)} · Fotografías en manifiestos: ${all.reduce((n, x) => n + x.photo_manifest.length, 0)}`,
                `Inspecciones con relaciones incompletas: ${plan.incomplete_inspections} · registros inválidos: ${plan.invalid_records}`,
                "La incorporación descarga y verifica fotografías, reconstruye resultados de checklist y conserva la identidad del registro raíz.",
                ...lines,
                all.length > 20 ? `… y ${all.length - 20} inspección(es) más.` : "",
                "La consulta LIST es de solo lectura. La incorporación local se ejecuta únicamente al pulsar Incorporar al equipo y confirmar."
            ].filter(Boolean).join("\n");
        }
        setStatus(
            `Consulta completada: ${all.length} inspección(es). Selecciona una y pulsa Incorporar al equipo para completar la recepción local.`,
            "ok"
        );
    }

    function readLocalArray(key) {
        const raw = localStorage.getItem(key);
        const value = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(value)) throw new Error(`La estructura local ${key} no es un arreglo.`);
        return value;
    }

    function functionalKeyOf(payload) {
        const date = String(payload?.fecha || payload?.fechaInspeccion || "").slice(0, 10);
        const post = String(payload?.nombrePuesto || payload?.puesto || payload?.cliente || "").trim().replace(/\s+/g, " ").toLowerCase();
        return date && post ? `${date}|${post}` : "";
    }

    async function downloadRemotePhotos(rootRecord, manifest) {
        if (!manifest.length) return new Map();
        const rootPayload = rootRecord.payload || {};
        const key = functionalKeyOf(rootPayload);
        const declared = rootPayload._tecchnex_media_manifest_v1;
        if (!key || !declared || declared.completed !== true || declared.inspection_sync_id !== rootRecord.record_sync_id ||
            !Array.isArray(declared.photos) || declared.photos.length !== manifest.length) {
            throw new Error("El manifiesto fotográfico no está completo o no corresponde a esta inspección. No se incorporó información.");
        }
        const client = await getClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError || !sessionData?.session?.access_token) throw new Error("No hay una sesión autenticada para recuperar fotografías.");
        const { data, error } = await client.functions.invoke("tecchnex-cam-inspecciones-media-read", {
            body: { record_sync_id: rootRecord.record_sync_id, expected_key: key }
        });
        if (error || !data || data.ok !== true || data.code !== "PHOTO_URLS_CREATED" || data.identity_key !== key || !Array.isArray(data.photos) || data.photos.length !== manifest.length) {
            throw new Error(`Supabase no autorizó la recuperación completa de fotografías (${String(data?.code || error?.message || "MEDIA_READ_FAILED")}).`);
        }
        const byRemoteId = new Map();
        for (const photo of data.photos) {
            if (!photo || !photo.media_id || !photo.signed_url || !/^https:\/\//i.test(photo.signed_url)) throw new Error("Supabase devolvió una referencia fotográfica incompleta.");
            const expected = manifest.find(x => String(x.media_id) === String(photo.media_id));
            if (!expected || String(expected.hash_sha256).toLowerCase() !== String(photo.hash_sha256).toLowerCase()) throw new Error(`La fotografía ${photo.media_id} no coincide con el manifiesto de la inspección.`);
            const response = await fetch(photo.signed_url, { cache: "no-store" });
            if (!response.ok) throw new Error(`No se pudo descargar la fotografía ${photo.media_id} (HTTP ${response.status}).`);
            const blob = await response.blob();
            if (blob.size !== Number(photo.size_bytes)) throw new Error(`Tamaño incorrecto en la fotografía ${photo.media_id}.`);
            const mime = String(photo.mime_type || blob.type || "image/jpeg").toLowerCase();
            const normalizedBlob = blob.type.toLowerCase() === mime ? blob : new Blob([blob], { type: mime });
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || ""));
                reader.onerror = () => reject(new Error("No se pudo leer una fotografía descargada.")); reader.readAsDataURL(normalizedBlob);
            });
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
            const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
            if (hash.toLowerCase() !== String(photo.hash_sha256).toLowerCase()) throw new Error(`SHA-256 incorrecto en la fotografía ${photo.media_id}.`);
            if (typeof window.guardarMediaEnBoveda !== "function") throw new Error("La bóveda fotográfica IndexedDB no está disponible en esta versión.");
            const ref = await window.guardarMediaEnBoveda({
                dataUrl, hashSha256: hash, idControl: String(rootPayload.idControl || ""),
                hallazgo: String(photo.finding_number || expected.finding_number || ""),
                timestamp: photo.timestamp || expected.timestamp || new Date().toISOString()
            });
            if (!ref?.mediaId) throw new Error(`IndexedDB no confirmó el almacenamiento de ${photo.media_id}.`);
            byRemoteId.set(String(photo.media_id), { ...ref, remoteMediaId: String(photo.media_id), finding_number: String(photo.finding_number || expected.finding_number || "") });
        }
        if (byRemoteId.size !== manifest.length) throw new Error("No se recuperaron todas las fotografías declaradas.");
        return byRemoteId;
    }

    async function incorporateSelectedRemoteInspection() {
        const select = $("camSyncRemoteInspectionV1");
        const index = Number(select?.value);
        if (!Number.isInteger(index) || !remoteInspectionPackages[index]) throw new Error("Primero recupera la lista y selecciona una inspección.");
        const item = remoteInspectionPackages[index];
        const rootRecord = item.record;
        const root = { ...(rootRecord.payload || {}) };
        const rootId = String(rootRecord.record_sync_id || "").trim();
        const key = functionalKeyOf(root);
        if (!rootId || !key || root.idInspeccionInterno && String(root.idInspeccionInterno) !== rootId) throw new Error("La identidad técnica o funcional de la inspección remota no coincide. Incorporación cancelada.");
        if (item.related_records_complete === false) throw new Error("La inspección tiene registros relacionados incompletos. No se incorporará parcialmente.");
        const accepted = window.confirm(`Se incorporará al equipo esta inspección completa:\n\n${root.nombrePuesto || root.cliente}\n${root.fecha}\n${item.related_records.length} registros relacionados\n${item.photo_manifest.length} fotografías\n\nNo se reemplazarán inspecciones locales existentes. ¿Continuar?`);
        if (!accepted) { setStatus("Incorporación cancelada; no se modificaron datos locales."); return; }

        const inspections = readLocalArray("inspecciones");
        const existingByUuid = inspections.find(x => String(x?.idInspeccionInterno || "") === rootId);
        const existingByKey = inspections.find(x => functionalKeyOf(x) === key);
        if (existingByUuid) { setStatus("Esta inspección ya existe en este equipo. No se duplicó ni sobrescribió.", "ok"); return; }
        if (existingByKey) throw new Error("Ya existe una inspección local con el mismo puesto y fecha, pero con otro UUID. Se requiere resolver el conflicto antes de incorporar.");

        const related = item.related_records || [];
        const staged = {
            hallazgos: readLocalArray("hallazgos"), checklists: readLocalArray("checklists"),
            matrizRiesgos: readLocalArray("matrizRiesgos"), matricesRiesgosClientes: readLocalArray("matricesRiesgosClientes"),
            vulnerabilidades: readLocalArray("tecchnex_lista_vulnerabilidades_multisector_v1_registros_v2"),
            resultados: (() => { const x=JSON.parse(localStorage.getItem("resultadosChecklistCategorias")||"{}"); if(!x||typeof x!=="object"||Array.isArray(x)) throw new Error("resultadosChecklistCategorias tiene una estructura no válida."); return x; })()
        };

        // CAM-SYNC-RECEIVE-RECONCILIATION-01:
        // El índice de inspección no se calcula con inspections.length a ciegas.
        // Se reserva uno posterior a todos los índices usados en las estructuras locales.
        const usedIndexes = new Set();
        const addIndex = value => {
            const n = Number(value);
            if (Number.isSafeInteger(n) && n >= 0) usedIndexes.add(n);
        };
        addIndex(inspections.length - 1);
        for (const k of Object.keys(staged.resultados)) {
            if (/^(0|[1-9]\d*)$/.test(k)) addIndex(k);
        }
        for (const list of [staged.hallazgos, staged.checklists, staged.matrizRiesgos, staged.matricesRiesgosClientes, staged.vulnerabilidades]) {
            for (const record of list) addIndex(record?.inspeccion);
        }
        const newIndex = usedIndexes.size ? Math.max(...usedIndexes) + 1 : 0;
        if (!Number.isSafeInteger(newIndex)) throw new Error("No se pudo reservar un índice local seguro para la inspección.");

        root.idInspeccionInterno = rootId;
        root.claveInspeccionPuestoFecha = key;
        const normalizeChild = payload => ({ ...payload, idInspeccionInterno: rootId, claveInspeccionPuestoFecha: key, inspeccion: newIndex, idControlInspeccion: root.idControl || payload.idControlInspeccion || "" });
        const findingNumbers = new Set();
        const mediaMap = await downloadRemotePhotos(rootRecord, item.photo_manifest || []);

        for (const child of related) {
            const type = String(child?.record_type || "");
            const payload = child?.payload;
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`Registro relacionado ${type} sin contenido válido.`);
            if (type === "hallazgo") {
                const h = normalizeChild(payload);
                h.idControl = root.idControl || h.idControl || "";
                if (Array.isArray(h.fotos)) h.fotos = h.fotos.map(photo => {
                    const remoteId = String(photo?.mediaId || ""); const mapped = mediaMap.get(remoteId);
                    if (!mapped) throw new Error(`El hallazgo contiene una fotografía no incluida en el manifiesto: ${remoteId}.`);
                    return { ...photo, mediaId: mapped.mediaId, hashSha256: mapped.hashSha256 || photo.hashSha256, idControl: root.nombrePuesto || root.idControl || "", hallazgo: photo.hallazgo || mapped.finding_number };
                });
                for (const photo of h.fotos || []) if (photo?.hallazgo) findingNumbers.add(String(photo.hallazgo));

                const stableId = String(payload.idHallazgoSync || "").trim();
                const findingFingerprint = x => [
                    String(x?.descripcion || "").trim().replace(/\\s+/g, " "),
                    String(x?.elemento || "").trim().replace(/\\s+/g, " "),
                    String(x?.area || "").trim().replace(/\\s+/g, " ").toLowerCase()
                ].join("|");
                const existingFinding = (stableId
                    ? staged.hallazgos.find(x => String(x?.idHallazgoSync || "").trim() === stableId)
                    : null) || staged.hallazgos.find(x =>
                        String(x?.idInspeccionInterno || "") === rootId &&
                        findingFingerprint(x) === findingFingerprint(payload)
                    );
                if (existingFinding) {
                    if (String(existingFinding.idInspeccionInterno || "") !== rootId) {
                        throw new Error(`El hallazgo ${stableId} ya existe asociado a otra inspección. Se requiere revisión; no se modificaron datos.`);
                    }
                    // Reasocia el registro ya existente y conserva sus demás campos.
                    existingFinding.inspeccion = newIndex;
                    existingFinding.claveInspeccionPuestoFecha = key;
                    const currentPhotos = Array.isArray(existingFinding.fotos) ? existingFinding.fotos : [];
                    const photoKeys = new Set(currentPhotos.map(x => String(x?.hashSha256 || x?.mediaId || "")));
                    for (const photo of h.fotos || []) {
                        const photoKey = String(photo?.hashSha256 || photo?.mediaId || "");
                        if (!photoKeys.has(photoKey)) { currentPhotos.push(photo); photoKeys.add(photoKey); }
                    }
                    existingFinding.fotos = currentPhotos;
                } else {
                    // Si el UUID raíz ya aparece pero falta la identidad estable del hallazgo,
                    // no se adivina si es el mismo registro: se conserva y se agrega el remoto.
                    staged.hallazgos.push(h);
                }
            } else if (type === "checklist") {
                const normalized = normalizeChild(payload);
                const duplicate = staged.checklists.some(x => String(x?.idInspeccionInterno || "") === rootId &&
                    JSON.stringify({ ...x, inspeccion: null }) === JSON.stringify({ ...normalized, inspeccion: null }));
                if (!duplicate) staged.checklists.push(normalized);
                else {
                    const existing = staged.checklists.find(x => String(x?.idInspeccionInterno || "") === rootId &&
                        JSON.stringify({ ...x, inspeccion: null }) === JSON.stringify({ ...normalized, inspeccion: null }));
                    if (existing) existing.inspeccion = newIndex;
                }
            } else if (type === "matriz_riesgos") staged.matrizRiesgos.push(normalizeChild(payload));
            else if (type === "matriz_cliente") staged.matricesRiesgosClientes.push(normalizeChild(payload));
            else if (type === "vulnerabilidad") {
                const existing = staged.vulnerabilidades.find(x => String(x?.idInspeccionInterno || "") === rootId);
                if (existing) {
                    existing.inspeccion = newIndex;
                    existing.claveInspeccionPuestoFecha = key;
                } else staged.vulnerabilidades.push(normalizeChild(payload));
            } else if (type === "resultado_checklist") {
                const category = String(payload.categoria || "");
                if (!category) throw new Error("Un resultado de checklist remoto no tiene categoría.");
                const row = staged.resultados[String(newIndex)] || (staged.resultados[String(newIndex)] = {});
                if (Object.prototype.hasOwnProperty.call(row, category)) throw new Error(`Resultado duplicado para la categoría ${category} en el nuevo índice reservado.`);
                row[category] = payload.resultado;
            }
        }
        const expectedPhotoFindings = new Set((item.photo_manifest || []).map(x => String(x.finding_number || "")).filter(Boolean));
        for (const n of expectedPhotoFindings) if (!findingNumbers.has(n)) throw new Error(`Las fotografías del hallazgo ${n} no encontraron su registro local.`);
        inspections.push(root);
        const writes = {
            inspecciones: inspections, hallazgos: staged.hallazgos, checklists: staged.checklists,
            matrizRiesgos: staged.matrizRiesgos, matricesRiesgosClientes: staged.matricesRiesgosClientes,
            tecchnex_lista_vulnerabilidades_multisector_v1_registros_v2: staged.vulnerabilidades,
            resultadosChecklistCategorias: staged.resultados,
            indiceInspeccionSeleccionadaInforme: String(newIndex)
        };
        const snapshots = Object.fromEntries(Object.keys(writes).map(k => [k, localStorage.getItem(k)]));
        try {
            for (const [keyName, value] of Object.entries(writes)) localStorage.setItem(keyName, typeof value === "string" ? value : JSON.stringify(value));
        } catch (writeError) {
            for (const [keyName, oldValue] of Object.entries(snapshots)) {
                try { if (oldValue === null) localStorage.removeItem(keyName); else localStorage.setItem(keyName, oldValue); } catch (_) {}
            }
            throw new Error(`No se pudo completar la incorporación local; se restauraron los datos estructurados anteriores. ${writeError?.message || writeError}`);
        }

        setStatus(`SINCRONIZACIÓN RECIBIDA: inspección ${root.nombrePuesto} · ${root.fecha}; ${related.length} registros relacionados y ${mediaMap.size} fotografías incorporados en este equipo.`, "ok");
        const resultNode = $("camSyncListResultsV1");
        if (resultNode) resultNode.textContent += `\n\n✓ INCORPORACIÓN COMPLETADA en el equipo local: ${root.nombrePuesto} · ${root.fecha}\n✓ Registros relacionados: ${related.length}\n✓ Fotografías verificadas e incorporadas: ${mediaMap.size}`;
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
        const mediaButton = $("camSyncMediaReadV1");
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
        const importRemoteButton = $("camSyncImportRemoteV1");
        if (importRemoteButton) importRemoteButton.addEventListener("click", () => withBusy(incorporateSelectedRemoteInspection));
        if (mediaButton) mediaButton.addEventListener("click", () => withBusy(async () => {
            const accepted = window.confirm("Se solicitarán enlaces temporales de solo lectura para las fotografías de Camino de Colores. Se comprobarán tamaño y SHA-256 en el navegador. No se escribirá ni eliminará información. ¿Continuar?");
            if (!accepted) { setStatus("Prueba fotográfica cancelada. Sin cambios."); return; }
            const client = await getClient();
            const { data: sessionData, error: sessionError } = await client.auth.getSession();
            const accessToken = sessionData?.session?.access_token;
            if (sessionError || !accessToken) throw new Error("No hay una sesión autenticada. Inicia sesión y vuelve a intentar.");
            const normalizePost = value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
            const targetKey = `${REAL_INSPECTION_TARGET_DATE}|${normalizePost(REAL_INSPECTION_TARGET_POST)}`;
            setStatus("Localizando primero la raíz por puesto + fecha…");
            const roots = []; let cursor = null; let continuationToken = null; let page = 0;
            // Páginas pequeñas reducen el riesgo de exceder el límite de respuesta
            // cuando existen manifiestos fotográficos grandes en los registros raíz.
            while (page < 1000) {
                const body = { mode: "LIST", page_size: 10 }; if (cursor) body.cursor = cursor; if (continuationToken) body.continuation_token = continuationToken;
                const { data: pageData, error: pageError } = await client.functions.invoke(READ_FUNCTION_NAME, { body });
                if (pageError) {
                    const detail = String(pageError.message || pageError.context?.status || pageError.name || "ERROR_DESCONOCIDO");
                    throw new Error(`Falló la consulta paginada de Supabase (página ${page + 1}): ${detail}. No se solicitaron enlaces ni se modificaron datos.`);
                }
                if (!pageData || pageData.ok !== true || pageData.code !== "RECORD_PAGE_RECOVERED" || !Array.isArray(pageData.records) || typeof pageData.continuation_token !== "string" || !pageData.continuation_token) {
                    const detail = String(pageData?.code || pageData?.message || "RESPUESTA_INVALIDA");
                    throw new Error(`Supabase no devolvió una página de registros válida (página ${page + 1}): ${detail}. No se solicitaron enlaces ni se modificaron datos.`);
                }
                continuationToken = pageData.continuation_token;
                for (const record of pageData.records) if (record && record.record_type === "inspeccion" && !record.parent_sync_id && !record.deleted_at &&
                    String(record.payload?.fecha || "").slice(0,10) === REAL_INSPECTION_TARGET_DATE && normalizePost(record.payload?.nombrePuesto) === normalizePost(REAL_INSPECTION_TARGET_POST)) roots.push(record);
                const next = pageData.next_cursor; if (!next) break;
                if (typeof next.updated_at !== "string" || typeof next.sync_id !== "string" || (cursor && next.updated_at === cursor.updated_at && next.sync_id === cursor.sync_id)) throw new Error("Cursor de lectura inválido; recuperación detenida.");
                cursor = next; page++;
            }
            if (page >= 1000 && cursor) throw new Error("La búsqueda superó el límite de seguridad de páginas.");
            if (roots.length !== 1) throw new Error(roots.length ? `Hay ${roots.length} inspecciones con esa identidad; revisión manual requerida.` : "No se encontró la inspección por puesto + fecha.");
            const root = roots[0];
            if (root.payload?.claveInspeccionPuestoFecha !== targetKey) throw new Error("La clave funcional de la raíz no coincide; recuperación detenida.");
            setStatus("Solicitando autorización temporal de lectura para las fotografías…");
            const { data, error } = await client.functions.invoke("tecchnex-cam-inspecciones-media-read", { body: { record_sync_id: root.record_sync_id, expected_key: targetKey } });
            if (error || !data || data.ok !== true || data.code !== "PHOTO_URLS_CREATED" || data.identity_key !== targetKey || !Array.isArray(data.photos) || data.photos.length !== 27) {
                const code = String(data?.code || error?.message || "MEDIA_RESPONSE_INVALID");
                throw new Error(code === "FUNCTION_NOT_FOUND" || code.includes("404") ? "La función segura de lectura fotográfica aún no está desplegada. El código LAB está preparado, pero Supabase no se ha modificado." : `No fue posible autorizar la recuperación fotográfica: ${code}`);
            }
            const host = $("camSyncMediaResultsV1");
            for (const url of mediaObjectUrls) URL.revokeObjectURL(url);
            mediaObjectUrls = [];
            if (host) host.replaceChildren();
            let ok = 0, failed = 0; const previews = [];
            setStatus(`Descargando y verificando 27 fotografías…`);
            for (let offset = 0; offset < data.photos.length; offset += 3) {
                const batch = data.photos.slice(offset, offset + 3);
                const results = await Promise.all(batch.map(async photo => {
                    try {
                        if (typeof photo.signed_url !== "string" || !photo.signed_url.startsWith(CONFIG.projectUrl)) throw new Error("URL temporal no válida");
                        const response = await fetch(photo.signed_url, { cache: "no-store" });
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const blob = await response.blob();
                        if (blob.size !== Number(photo.size_bytes)) throw new Error(`Tamaño distinto (${blob.size}/${photo.size_bytes})`);
                        // El hash histórico TECCHNEX se calculó sobre el Data URL completo,
                        // no sobre los bytes binarios. Reconstruir el Data URL desde el Blob
                        // descargado conserva el contrato SHA-256 original sin alterar archivos.
                        const expectedMime = String(photo.mime_type || blob.type || "image/jpeg").toLowerCase();
                        if (blob.type && blob.type.toLowerCase() !== expectedMime) {
                            throw new Error(`Tipo MIME distinto (${blob.type}/${expectedMime})`);
                        }
                        const normalizedBlob = blob.type === expectedMime ? blob : new Blob([blob], { type: expectedMime });
                        const dataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(String(reader.result || ""));
                            reader.onerror = () => reject(new Error("No fue posible reconstruir el Data URL para verificar la huella."));
                            reader.readAsDataURL(normalizedBlob);
                        });
                        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
                        const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
                        if (hash.toLowerCase() !== String(photo.hash_sha256).toLowerCase()) throw new Error("SHA-256 del Data URL no coincide");
                        return { ok: true, photo, blob: normalizedBlob };
                    } catch (err) { return { ok: false, photo, error: String(err?.message || err) }; }
                }));
                for (const result of results) {
                    if (result.ok) { ok++; previews.push({ photo: result.photo, blob: result.blob }); }
                    else { failed++; if (host) { const p=document.createElement("div"); p.textContent=`FALLO ${result.photo.media_id}: ${result.error}`; p.style.color="#a22626"; host.appendChild(p); } }
                }
                setStatus(`Fotografías verificadas: ${ok}/27 · fallidas: ${failed}.`);
            }
            if (host) {
                const summary=document.createElement("strong"); summary.textContent=`Resultado: ${ok}/27 recuperadas y verificadas por tamaño y SHA-256; ${failed} fallidas.`; host.prepend(summary);
                const grid=document.createElement("div"); grid.style.cssText="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-top:8px";
                for (const item of previews) { const cell=document.createElement("div"); cell.style.cssText="min-width:0"; const img=document.createElement("img"); img.src=URL.createObjectURL(item.blob); mediaObjectUrls.push(img.src); img.alt=`Hallazgo ${item.photo.finding_number || ""}`; img.style.cssText="width:100%;aspect-ratio:1;object-fit:cover;border:1px solid #cbd5e1;border-radius:5px"; const cap=document.createElement("div"); cap.textContent=String(item.photo.finding_number || item.photo.media_id); cap.style.cssText="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"; cell.append(img,cap); grid.append(cell); }
                host.append(grid);
            }
            setStatus(`PRUEBA FOTOGRÁFICA FINALIZADA: ${ok}/27 recuperadas, tamaño y SHA-256 verificados; ${failed} fallidas. Sin escrituras ni cambios locales.`, failed ? "error" : "ok");
        }));
        readTest.addEventListener("click", () => withBusy(async () => {
            // La inspección a verificar se toma SIEMPRE de la selección visible
            // en la cola. No usar constantes ni una primera inspección fija.
            const queueSelect = $("camSyncPendingInspectionV1");
            const selectedKey = String(queueSelect?.value || "").trim();
            if (!selectedKey) {
                throw new Error("Selecciona primero una inspección en «Inspección pendiente en este equipo».");
            }
            const syncApi = window.TECCHNEXCamInspeccionesSyncClientV1;
            if (!syncApi || typeof syncApi.getPendingInspectionRemoteStatus !== "function") {
                throw new Error("El módulo de conciliación no está disponible. No se realizó ninguna consulta.");
            }
            const pendingStatuses = await syncApi.getPendingInspectionRemoteStatus();
            const selectedInspection = pendingStatuses.find(item => item.key === selectedKey);
            if (!selectedInspection) {
                throw new Error("La selección ya no está en la cola local. Actualiza la lista y vuelve a seleccionar la inspección.");
            }
            const targetDate = String(selectedInspection.fecha || "").slice(0, 10);
            const targetPost = String(selectedInspection.nombrePuesto || "").trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !targetPost) {
                throw new Error("La inspección seleccionada no tiene nombre y fecha válidos. Consulta detenida.");
            }
            const normalizePost = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
            const targetKey = `${normalizePost(targetPost)}|${targetDate}`;
            const accepted = window.confirm(
                `Se verificará en Supabase esta inspección seleccionada:\\n${targetPost} · ${targetDate}\\n\\n` +
                "La consulta es solo de lectura; no modifica Supabase ni el almacenamiento local. ¿Continuar?"
            );
            if (!accepted) {
                setStatus("Consulta cancelada. No se realizaron cambios.");
                return;
            }
            setStatus(`Buscando en Supabase: ${targetPost} · ${targetDate}…`);
            const client = await getClient();
            const { data: sessionData, error: sessionError } = await client.auth.getSession();
            const accessToken = sessionData?.session?.access_token;
            if (sessionError || !accessToken) {
                throw new Error("No hay una sesión autenticada. Inicia sesión y vuelve a intentar.");
            }

            const pageSize = 50;
            const maxPages = 1000;
            const records = [];
            let cursor = null;
            let continuationToken = null;
            let page = 0;
            while (page < maxPages) {
                setStatus(`Buscando identidad funcional: página ${page + 1}…`);
                const body = { mode: "LIST", page_size: pageSize };
                if (cursor) body.cursor = cursor;
                if (continuationToken) body.continuation_token = continuationToken;
                const { data, error } = await client.functions.invoke(READ_FUNCTION_NAME, { body });
                if (error) throw new Error(`No fue posible consultar la página ${page + 1} de Supabase.`);
                if (!data || data.ok !== true || data.code !== "RECORD_PAGE_RECOVERED" ||
                    !Array.isArray(data.records) || typeof data.continuation_token !== "string" || !data.continuation_token || !Number.isInteger(data.page_size) || data.page_size < 1 || data.page_size > pageSize) {
                    throw new Error(`Respuesta de lectura no válida: ${String(data?.code || "RESPUESTA_INVALIDA")}`);
                }
                continuationToken = data.continuation_token;
                for (const record of data.records) {
                    if (!record || typeof record.record_sync_id !== "string" || typeof record.record_type !== "string" ||
                        (record.parent_sync_id !== null && typeof record.parent_sync_id !== "string") ||
                        !record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
                        throw new Error("Supabase devolvió un registro incompleto. No se modificó información local.");
                    }
                    records.push(record);
                }
                const next = data.next_cursor;
                if (next === null || next === undefined) break;
                if (!next || typeof next.updated_at !== "string" || typeof next.sync_id !== "string" ||
                    (cursor && next.updated_at === cursor.updated_at && next.sync_id === cursor.sync_id)) {
                    throw new Error("Supabase devolvió un cursor inválido o repetido. Consulta cancelada.");
                }
                cursor = next;
                page++;
            }
            if (page >= maxPages && cursor) throw new Error("La consulta superó el límite de seguridad de páginas. No se modificó información local.");

            const active = records.filter(record => !record.deleted_at);
            const matches = active.filter(record => record.record_type === "inspeccion" && !record.parent_sync_id &&
                String(record.payload.fecha || "").slice(0, 10) === targetDate &&
                normalizePost(record.payload.nombrePuesto) === normalizePost(targetPost));
            if (matches.length !== 1) {
                throw new Error(matches.length === 0
                    ? `No se encontró la inspección ${targetKey}. No se eligió ningún registro alternativo.`
                    : `Se encontraron ${matches.length} raíces con la misma identidad ${targetKey}. Revisión manual requerida; no se eligió ninguna.`);
            }

            const root = matches[0];
            const payloadKey = String(root.payload.claveInspeccionPuestoFecha || "").trim();
            if (payloadKey !== targetKey) throw new Error("La clave funcional guardada no coincide con puesto + fecha. Lectura detenida para evitar asociaciones incorrectas.");
            const related = active.filter(record => record.parent_sync_id === root.record_sync_id);
            const summary = related.reduce((acc, item) => {
                const type = String(item.record_type || "otro").toLowerCase();
                acc[type] = (acc[type] || 0) + 1;
                return acc;
            }, {});
            const detail = `Relacionados: ${related.length} (hallazgos: ${summary.hallazgo || 0}, matrices: ${summary.matriz_cliente || 0}, checklist: ${summary.checklist || 0}, resultados de checklist: ${summary.resultado_checklist || 0}, vulnerabilidades: ${summary.vulnerabilidad || 0}).`;
            const campos = Object.keys(root.payload).length;
            setStatus(`IDENTIDAD CORRECTA EN SUPABASE: ${root.payload.nombrePuesto} · ${root.payload.fecha}. Clave: ${targetKey}. UUID técnico: ${root.record_sync_id}. ${campos} campos. ${detail} Consulta paginada de solo lectura; sin escrituras ni cambios locales.`, "ok");
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
            setStatus(count
                ? `${count} operación(es) pendiente(s) detectadas. El envío habitual recupera los datos completos desde el almacenamiento local; selecciona la inspección en el panel y confirma después de validar.`
                : "No hay cambios pendientes en la cola local. La importación manual de un respaldo JSON permanece disponible en Administración avanzada.");
        } catch (error) {
            validate.disabled = true;
            send.disabled = true;
            setStatus(error.message, "error");
        }
    }

    // Comprueba que el respaldo elegido corresponda a una inspección marcada
    // como pendiente cuando la cola local contiene una sola inspección.
    // La cola es solo un marcador: no contiene hallazgos, matrices ni fotografías.
    function assertBackupMatchesLocalQueue(report) {
        const pending = readQueue();
        if (!pending.length) return;
        const reportPayload = report?.inspection?.payload || {};
        const reportId = String(report?.source?.idControl || reportPayload.idControl || "").trim();
        const reportDate = String(reportPayload.fecha || report?.source?.fecha || "").slice(0, 10);
        const reportPost = String(reportPayload.nombrePuesto || report?.source?.nombrePuesto || "").trim().replace(/\s+/g, " ").toLowerCase();
        if (!reportId) throw new Error("El respaldo no contiene el identificador de inspección necesario para compararlo con la cola local.");
        const matches = pending.filter(operation => {
            const payload = operation?.payload || {};
            const id = String(payload.idControl || "").trim();
            const date = String(payload.fecha || "").slice(0, 10);
            const post = String(payload.nombrePuesto || "").trim().replace(/\s+/g, " ").toLowerCase();
            return id === reportId && (!date || !reportDate || date === reportDate) && (!post || !reportPost || post === reportPost);
        });
        if (matches.length !== 1) {
            throw new Error(matches.length > 1
                ? "Hay varias operaciones locales que coinciden con este respaldo. Revisa la cola antes de continuar; no se enviará información."
                : `El respaldo seleccionado (${reportId}) no coincide con la inspección marcada en la cola local. Selecciona el respaldo correspondiente; no se enviará información.`);
        }
    }

    // Agrupa las operaciones raíz pendientes por identidad de inspección. La cola
    // solo identifica qué inspección cambió; los datos completos se recuperan
    // mediante el exportador local existente, incluidas las relaciones y fotos.
    function getPendingInspectionCandidates() {
        const pending = readQueue();
        const roots = pending.filter(op => op && op.record_type === "inspeccion" && op.payload && typeof op.payload === "object");
        const groups = new Map();
        for (const op of roots) {
            const payload = op.payload || {};
            const idControl = String(payload.idControl || "").trim();
            const internalId = String(payload.idInspeccionInterno || "").trim();
            const fecha = String(payload.fecha || payload.fechaInspeccion || "").slice(0, 10);
            const nombrePuesto = String(payload.nombrePuesto || payload.puesto || "").trim();
            if (!idControl || !fecha || !nombrePuesto || !internalId) {
                throw new Error("La cola contiene una inspección pendiente sin identidad completa (ID, UUID interno, fecha o puesto). Se requiere revisión; no se enviará información.");
            }
            const key = String(op.record_sync_id || internalId);
            const previous = groups.get(key);
            if (previous && (previous.idControl !== idControl || previous.fecha !== fecha || previous.nombrePuesto.trim().toLowerCase() !== nombrePuesto.trim().toLowerCase())) {
                throw new Error("La cola contiene identidades contradictorias para una misma operación. Se requiere revisión manual.");
            }
            if (!previous) groups.set(key, { key, idControl, idInspeccionInterno: internalId, fecha, nombrePuesto, operationCount: 1 });
            else previous.operationCount++;
        }
        if (pending.length && !roots.length) throw new Error("Hay operaciones pendientes, pero ninguna corresponde a una inspección principal. No se puede construir un paquete completo de forma segura.");
        return Array.from(groups.values());
    }


    function normalizeInspectionIdentityPart(value) {
        return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
    }

    function inspectionIdentityKey(fecha, nombrePuesto) {
        // Identidad operativa acordada: nombre del puesto + fecha.
        // idControl se conserva como dato informativo, nunca como llave de conciliación.
        const date = String(fecha || "").slice(0, 10);
        const post = normalizeInspectionIdentityPart(nombrePuesto);
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && post
            ? `${post}|${date}` : null;
    }

    async function getPendingInspectionRemoteStatus() {
        const candidates = getPendingInspectionCandidates();
        const client = await getClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError || !sessionData?.session?.access_token) {
            throw new Error("No hay una sesión autenticada para verificar el estado remoto.");
        }
        const pageSize = 50, maxPages = 1000;
        const remoteRootsByIdentity = new Map();
        let cursor = null, continuationToken = null, page = 0;
        while (page < maxPages) {
            const body = { mode: "LIST", page_size: pageSize };
            if (cursor) body.cursor = cursor;
            if (continuationToken) body.continuation_token = continuationToken;
            const { data, error } = await client.functions.invoke(READ_FUNCTION_NAME, { body });
            if (error || !data || data.ok !== true || data.code !== "RECORD_PAGE_RECOVERED" || !Array.isArray(data.records) || typeof data.continuation_token !== "string" || !data.continuation_token) {
                throw new Error(`No fue posible verificar Supabase (página ${page + 1}). La lista queda bloqueada para evitar reenvíos.`);
            }
            continuationToken = data.continuation_token;
            for (const record of data.records) {
                if (!record || typeof record.record_sync_id !== "string" || typeof record.record_type !== "string") {
                    throw new Error("Supabase devolvió un registro incompleto. No se habilitarán envíos.");
                }
                if (record.record_type !== "inspeccion" || record.parent_sync_id || record.deleted_at) continue;
                const payload = record.payload && typeof record.payload === "object" ? record.payload : {};
                const idControl = String(payload.idControl || "").trim();
                const fecha = String(payload.fecha || payload.fechaInspeccion || "").slice(0, 10);
                const nombrePuesto = String(payload.nombrePuesto || payload.puesto || "").trim();
                const identity = inspectionIdentityKey(fecha, nombrePuesto);
                if (identity) {
                    const matches = remoteRootsByIdentity.get(identity) || [];
                    matches.push(record);
                    remoteRootsByIdentity.set(identity, matches);
                }
            }
            const next = data.next_cursor;
            if (next == null) break;
            if (!next || typeof next.updated_at !== "string" || typeof next.sync_id !== "string" ||
                (cursor && next.updated_at === cursor.updated_at && next.sync_id === cursor.sync_id)) {
                throw new Error("Supabase devolvió un cursor inválido. No se habilitarán envíos.");
            }
            cursor = next;
            page++;
        }
        if (page >= maxPages && cursor) throw new Error("Se alcanzó el límite de páginas. No se habilitarán envíos.");
        return candidates.map(item => {
            const identity = inspectionIdentityKey(item.fecha, item.nombrePuesto);
            const exactMatches = identity ? (remoteRootsByIdentity.get(identity) || []) : [];
            if (exactMatches.length === 1) return { ...item, remoteStatus: "EXISTS", remoteVersion: exactMatches[0].version,
                remoteMatch: "POST_DATE", remoteConflict: false };
            if (exactMatches.length > 1) return { ...item, remoteStatus: "CONFLICT", remoteVersion: null,
                remoteMatch: "MULTIPLE_POST_DATE_MATCHES", remoteConflict: true };
            return { ...item, remoteStatus: "ABSENT", remoteVersion: null,
                remoteMatch: "NO_POST_DATE_MATCH", remoteConflict: false };
        });
    }

    async function sendPendingInspection(recordSyncId) {
        const candidates = getPendingInspectionCandidates();
        const selected = candidates.find(item => item.key === String(recordSyncId || ""));
        if (!selected) throw new Error("Selecciona una inspección pendiente válida. No se enviará información.");
        // Segunda verificación justo antes de preparar el paquete: LIST es solo lectura.
        const remoteStatus = await getPendingInspectionRemoteStatus();
        const checked = remoteStatus.find(item => item.key === selected.key);
        if (!checked || checked.remoteStatus !== "ABSENT") {
            throw new Error("ENVÍO BLOQUEADO: esta inspección ya aparece en Supabase o no fue posible confirmar su ausencia. Requiere revisión; no se enviaron datos.");
        }
        if (selected.operationCount !== 1) throw new Error("La inspección tiene varias operaciones raíz pendientes. Se requiere revisión para evitar duplicados.");
        if (typeof window.exportarInspeccionSeleccionada !== "function") throw new Error("No está disponible el exportador individual local.");
        setStatus(`Recuperando datos locales de ${selected.nombrePuesto} (${selected.fecha}), incluidos hallazgos, matrices y fotografías…`);
        const individual = await window.exportarInspeccionSeleccionada({
            returnPackageOnly: true, idControl: selected.idControl,
            idInspeccionInterno: selected.idInspeccionInterno, fecha: selected.fecha, nombrePuesto: selected.nombrePuesto
        });
        const adapter = window.TECCHNEXCamInspeccionesExportAdapter;
        if (!adapter || typeof adapter.normalize !== "function") throw new Error("No está disponible el auditor de integridad del respaldo individual.");
        const report = adapter.normalize(individual);
        setStatus(`Datos completos recuperados: ${report.counts.hallazgos} hallazgos, ${report.counts.matriz_riesgos_inspeccion + report.counts.matrices_riesgos_cliente} matrices y ${report.counts.media} fotografías. Revisando integridad…`, "ok");
        return sendAuditReport(report);
    }

    // Entrada única para el flujo simplificado: construir en memoria, validar
    // sin escritura y solicitar confirmación antes de cargar fotos o registros.
    async function sendAuditReport(report) {
        return withBusy(async () => {
            if (!report || !report.integrity?.photo_associations_valid) {
                throw new Error("La auditoría del respaldo no aprobó las asociaciones fotográficas. No se enviará información.");
            }
            assertBackupMatchesLocalQueue(report);
            const builder = window.TECCHNEXCamInspeccionesSyncPackageV18;
            if (!builder || typeof builder.build !== "function") {
                throw new Error("No está disponible el constructor local del paquete de sincronización.");
            }
            const pkg = await builder.build(report);
            validateImportedPackage(pkg);
            importedPackage = pkg;
            preparedMediaUploads = null;
            packageValidationProgress = {
                packageKey: pkg.records.map(record => record.operation_id).join("|"),
                nextIndex: 0,
                passed: 0,
                details: []
            };
            window.CAM_INSPECCIONES_LAST_EXPORT_AUDIT = report;
            setStatus(`Inspección ${pkg.source.id_control}: paquete local preparado (${pkg.records.length} registros y ${pkg.photo_manifest.length} fotografías). Validando antes del envío…`);
            await validateImportedPackageV18();
            await syncImportedPackage();
        });
    }

    window.TECCHNEXCamInspeccionesSyncClientV1 = Object.freeze({
        sendAuditReport, getPendingInspectionCandidates, getPendingInspectionRemoteStatus, sendPendingInspection
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();

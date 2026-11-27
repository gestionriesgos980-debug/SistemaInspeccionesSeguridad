# Bitácora TECCHNEX CAM-INSPECCIONES V25 — V1.16.5

## Objetivo
Cerrar el ciclo de sincronización entre equipos mediante Supabase existente: Equipo A → Supabase → Equipo B.

## Cambios locales
- Conserva el envío de paquetes V1.8 existente.
- La consulta LIST conserva las inspecciones y permite seleccionar una para recepción.
- Incorpora el registro raíz y sus hijos a las estructuras locales existentes.
- Reconstruye `resultadosChecklistCategorias` usando el índice local recién asignado, no el índice del equipo emisor.
- Descarga fotografías mediante `tecchnex-cam-inspecciones-media-read`, verifica tamaño y SHA-256, y las guarda en la bóveda IndexedDB existente.
- Remapea `mediaId` remoto a la referencia local en los hallazgos.
- Bloquea duplicados por UUID y conflictos de puesto+fecha con UUID diferente.
- No crea tablas, buckets, RPC ni funciones Edge. No realiza despliegues ni escrituras Supabase durante la recepción.

## Límites conocidos
- La recepción de fotografías requiere que la función Edge `tecchnex-cam-inspecciones-media-read` ya esté desplegada y devuelva el contrato `PHOTO_URLS_CREATED` usado por la prueba previa.
- La escritura estructurada usa snapshots y rollback de localStorage. Los blobs ya descargados a IndexedDB no se eliminan si falla después la escritura estructurada; quedan como medios huérfanos no referenciados, sin afectar los datos existentes.
- La validación completa entre dos navegadores reales sigue pendiente; no se declara aún producción validada.
- La sincronización bidireccional con resolución de conflictos de ediciones simultáneas no se incorpora en esta entrega. El envío existente y la recepción se mantienen como flujos explícitos.

## Seguridad
No se han ejecutado escrituras ni despliegues remotos.


## Ajuste visual del panel de sincronización — panel compacto

- Se mantiene intacto el identificador del panel y todos los IDs de controles existentes.
- El panel inicia plegado, con estado resumido y botón Abrir/Cerrar.
- Al abrirlo se conservan todas las herramientas de diagnóstico, envío y recepción.
- Ancho máximo ajustado a 310 px; no se modifican llamadas, adaptadores ni operaciones de sincronización.
- Se incrementa únicamente el nombre de caché del Service Worker para que GitHub Pages solicite el HTML actualizado.
- No se modifican datos locales, tablas, funciones ni secretos de Supabase.


## LAB — Continuación de lectura con comprobante temporal V1

- Base: ZIP V7 confirmado como vigente por el usuario; GitHub sin cambios posteriores reportados.
- Se integra `continuation_token` en los cuatro recorridos paginados LIST del cliente.
- Cada recorrido captura el comprobante devuelto por la primera página y lo reenvía en páginas siguientes.
- Se conserva `cursor`, tamaño de página, identidad funcional por nombre+fecha y el resto de la lógica de sincronización.
- La Edge Function `tecchnex-cam-inspecciones-read` V5 y el Universal Bridge central V15 no se modifican.
- No se crean tablas, no se escriben registros, no se envían inspecciones y no se despliega código remoto.
- Estado: preparado en laboratorio; pendiente de prueba controlada de paginación/autorización antes de publicar.


## AUDITORÍA DE CONEXIÓN — IDENTIDAD CANÓNICA DEL MANIFIESTO FOTOGRÁFICO V1

- Base analizada: ZIP `SistemaInspeccionesSeguridad-main (2)(2).zip`, archivo principal `index.html`.
- Ruta activa: `cam-inspecciones-export-adapter-v1.js` → `cam-inspecciones-sync-package-v1-8.js` → `cam-inspecciones-sync-client-v1.js` → `tecchnex-cam-inspecciones-sync-package`.
- Causa raíz identificada: el constructor tomaba `id_control` del manifiesto desde `media.payload.idControl || sourceId`, pero el validador exige que cada foto pertenezca al mismo `id_control` del paquete. Los metadatos de una foto pueden conservar un identificador histórico distinto al de la inspección que actualmente la referencia.
- Corrección: validar que el `idControl` del origen coincida con el de la inspección raíz y derivar siempre `photo_manifest[].id_control` de esa raíz. La asociación real con el hallazgo continúa dependiendo de la auditoría de `mediaId`/hallazgo, no del identificador histórico de la foto.
- Refuerzo: comprobar `mediaId` único, número de hallazgo no vacío y SHA-256 hexadecimal de 64 caracteres al construir el manifiesto.
- Service Worker: nueva versión de caché para que la publicación solicite los recursos corregidos.
- Sin cambios en esquema Supabase, tablas, buckets, RPC, funciones Edge, secretos ni datos. No se ejecutaron escrituras ni despliegues.
- Estado: corrección local preparada; pendiente de pruebas automatizadas y prueba controlada en navegador.


## LAB V2 - Recuperacion fotografica con conteo dinamico
- Se elimino la exigencia fija de 27 fotografias en el flujo de prueba de recuperacion.
- La cantidad esperada se obtiene del manifiesto fotografico de la inspeccion raiz.
- Se valida que el manifiesto este completo y asociado al UUID de la raiz.
- Se valida unicidad de media_id y correspondencia exacta de IDs + SHA-256 entre manifiesto y respuesta.
- Se conserva la verificacion SHA-256 y del tamano descargado; no se altera la cola ni se ejecutan escrituras.
- Alcance: cambio local LAB; no se desplegaron Edge Functions ni se modifico Supabase.


## LAB V3 - Conciliacion de envios manuales JSON

- Causa raiz: tras confirmar el paquete en Supabase, la conciliacion local buscaba exclusivamente una operacion `pending` en `tecchnex_cam_inspecciones_sync_queue_v1`. El envio desde respaldo JSON puede no tener una operacion en esa cola, por lo que el servidor confirmaba el envio y el panel mostraba una advertencia local.
- Correccion: cuando no existe una operacion pendiente coincidente, se actualiza exclusivamente el indice existente `tecchnex_cam_inspecciones_sync_records_v1` con UUID raiz, version remota y marca de confirmacion `manual_json_backup`.
- La identidad se guarda con clave compuesta `idControl::fecha|puesto`, compatible con la resolucion local existente. Si esa clave ya esta asociada a otro UUID, la conciliacion se bloquea y no sobrescribe datos.
- La cola local no se crea, no se limpia ni se modifica en el flujo de respaldo manual. Si hay una unica operacion pendiente coincidente, se conserva el flujo previo de conciliacion de cola.
- No se modifican Edge Functions, tablas, RPC, Storage, secretos ni datos de Supabase.
- Pruebas nuevas: 3/3 aprobadas (confirmacion manual, proteccion ante colision de UUID y rechazo de version invalida).
- Suite completa: 31/34 aprobadas. Persisten 3 fallos historicos en `tests/sync-lab-v14.test.mjs` por expectativas antiguas sobre estructura de prueba y version de cache; no se modificaron para ocultarlos.
- Estado: LAB V3 preparado; pendiente de prueba controlada en navegador con un respaldo de inspeccion ya confirmado, sin reenviarlo a Supabase.


## LAB V4 — Notificaciones informativas

- Base: LAB V3 conciliación de envío manual; no se modificó lógica de sincronización ni funciones Supabase.
- Se oculta el aviso superior duplicado cuando la cola local está vacía; el estado de cola vacía permanece junto al selector principal.
- El mensaje de consulta completada pasa a ser temporal (6 segundos); otros mensajes, errores y confirmaciones conservan su comportamiento persistente.
- Se conserva el resto de operaciones y botones sin cambios funcionales intencionales.

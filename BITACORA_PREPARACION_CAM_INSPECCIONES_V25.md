# TECCHNEX CAM-INSPECCIONES V25 — Preparación de integración comercial LAB

**Estado:** candidata local de preparación. No desplegada. No es versión de producción.

## Base recibida
- ZIP de origen: `SistemaInspeccionesSeguridad-main (4).zip`.
- Base operativa recibida y etiquetada en la continuidad como **LAB V25**.
- SHA-256 original de `index.html`: `d267fea712aedec0105807150accabd95634b149c4415c1715cd40f54bc6708e`.
- SHA-256 de `index.html` preparado: `60370708cb8b6318848d710fbb17a6c7b12c53e3dbc51739808a157b7cca9a43`.

## Cambios deliberados
1. Se conservó el `index.html` V25 y se agregó el bloque de puerta comercial del candidato previo de Inspecciones, colocando el diálogo al inicio del `<body>` y los tres scripts al final.
2. Se incorporaron los archivos `adapters/contrato-adaptador.js`, `tecchnex-inspecciones-config.js` y `tecchnex-inspecciones-license-gate.js`.
3. El gate se ajustó para bloquear la aplicación cuando Supabase informa `SIGNED_OUT` y volver a validar la licencia en `TOKEN_REFRESHED`, siguiendo el patrón observado en CAM-SST.
4. Se actualizó solamente el identificador de caché del Service Worker y su lista de recursos para incluir los tres archivos nuevos.
5. Se incorporó la Edge Function candidata `tecchnex-product-authorize` y el cliente compartido HMAC `universal-bridge-client.ts` bajo `supabase/functions/`.
6. Se incluyó un fragmento de configuración (`verify_jwt = true`) separado para fusionar con el `config.toml` existente; no sustituye el archivo existente.

## Proyecto Supabase compartido identificado
- Por confirmación del usuario, CAM-INSPECCIONES utiliza el mismo proyecto Supabase de productos/Admin Maestro: `ywezkwitbhbyxcwuoiim`.
- URL precargada en la configuración LAB: `https://ywezkwitbhbyxcwuoiim.supabase.co`.
- La clave publicable no se incorpora al ZIP ni al código; se ingresa localmente en la puerta de acceso.
- La URL queda precargada y validada contra el proyecto compartido para impedir que una URL almacenada previamente redirija accidentalmente la prueba a otro proyecto.
- El Bridge Central permanece separado: `myineqgojoobgyaviqyy`.

## Contrato comercial conservado
- Producto/proyecto candidato: `CAM-INSPECCIONES`.
- Identidad: `USER` mediante `external_user_id` + `external_client_id`.
- El cliente compartido conserva la canonicalización HMAC USER histórica. No se introdujo el contrato POST.
- La Edge Function utiliza `CAM_INSPECCIONES_PROJECT_HMAC_SECRET`, secreto HMAC dedicado, para no reutilizar ni sobrescribir el secreto genérico usado por otros productos dentro del mismo proyecto Supabase. Debe corresponder a la entrada `CAM-INSPECCIONES` de `BRIDGE_PROJECT_SECRETS_JSON` en Bridge Central.
- La puerta de navegador usa únicamente URL y clave publicable de Supabase; nunca contiene `service_role` ni secreto HMAC.
- La función de servidor valida el JWT/membresía local y consulta el Universal Bridge.

## Conservación de la aplicación
No se modificaron rutinas operativas de inspección, riesgos, hallazgos, checklists, agenda, informes Word/PDF, fotografías, IndexedDB, plantilla maestra Word ni los nombres de los archivos originales de la base V25. El resto de los archivos originales se copió sin cambios.

## Pendientes antes de cualquier despliegue
- Confirmar en el panel que la clave publicable suministrada para el login pertenece al proyecto compartido `ywezkwitbhbyxcwuoiim`.
- Confirmar el código `CAM-INSPECCIONES` en el catálogo central.
- Confirmar la existencia y vigencia del vínculo de identidad externa para el UUID local del usuario y del cliente.
- Confirmar la presencia (solo nombres, nunca valores) de los secretos requeridos: `CENTRAL_UNIVERSAL_AUTHORIZE_URL`, `CAM_INSPECCIONES_PROJECT_HMAC_SECRET` dedicado, `SUPABASE_URL`, clave anon/publicable o `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SECRET_KEYS`, y `ALLOWED_ORIGINS`.
- Confirmar que `BRIDGE_PROJECT_SECRETS_JSON` del Bridge Central contiene el secreto independiente de CAM-INSPECCIONES.
- Ejecutar `deno check`, pruebas de la función en el proyecto LAB correcto y E2E positivo/negativo antes de aprobar.
- Revisar la política de revalidación comercial y cualquier requisito de operación offline; el gate no declara licencia offline válida.

## Límites
- Este ZIP no contiene ni reemplaza funciones del Bridge Central o Admin Maestro.
- No contiene SQL, migraciones, creación de tablas, buckets, secretos o proyectos.
- No se realizó despliegue, llamada HTTP remota, ni prueba E2E.
- Suite general del paquete maestro: 198/198 pruebas locales aprobadas al ejecutar `node 06_SCRIPTS/run-lab-tests.mjs`; no certifica esta adaptación V25 ni la conexión remota.
- Suite estática propia de esta preparación: 12/12 aprobadas con `node --test tests/cam-inspecciones-v25-preparation.test.mjs`.
- Sintaxis comprobada: 7 bloques JavaScript inline del HTML y archivos de gate, adaptador, configuración, Service Worker y funciones TypeScript (Node type stripping). No sustituye `deno check`.
- Se comprobó que los 41 archivos originales de V25, salvo `index.html` y `sw.js`, se copiaron sin cambios.


## Actualización V1.3 — aislamiento del helper compartido

- Se detectó que el proyecto Supabase compartido también aloja las funciones de CAM-RONDAS y sus dependencias USER/POST.
- La candidata V1.2 incluía el nombre común `supabase/functions/_shared/universal-bridge-client.ts`, cuyo contenido era la copia histórica USER. No debe copiarse sobre el helper común del proyecto, pues podría sustituir el soporte POST vigente.
- En V1.3, el archivo se renombró a `universal-bridge-client-cam-inspecciones.ts` y `tecchnex-product-authorize/index.ts` importa exclusivamente esa copia aislada.
- El helper dedicado mantiene la canonicalización USER histórica y recibe explícitamente `CAM_INSPECCIONES_PROJECT_HMAC_SECRET`; no consulta ni hereda el secreto genérico de otro producto.
- No se modificó ningún código de CAM-SST, CAM-RONDAS, CAM-ACCESO, Admin Maestro ni Bridge Central.
- Se agregó la prueba `INS-V25-13` para impedir una colisión futura con el helper común USER/POST.
- Estado: candidata local; no desplegada; sin consultas HTTP remotas ni cambios de Secrets.

- Para el despliegue, el valor de `CAM_INSPECCIONES_PROJECT_HMAC_SECRET` debe reutilizar la entrada ya asignada al producto en el JSON central. No generar ni rotar una clave nueva; si no se dispone del valor existente, detener despliegue funcional y recuperar el registro seguro.


## Actualización de diagnóstico técnico — 17 de noviembre de 2026

- Se añadió trazabilidad acotada al helper aislado `universal-bridge-client-cam-inspecciones.ts`.
- Ante rechazo central registra etapa, `request_id`, estado HTTP y código de respuesta; ante error de transporte/firma registra únicamente el nombre de error.
- No registra secretos, firmas HMAC, tokens, cuerpos HTTP, UUID de usuario ni UUID de cliente.
- Se agregó prueba estática `INS-V25-14` para verificar la presencia del diagnóstico y evitar exposición de datos sensibles.
- Validación ejecutada: 14/14 pruebas estáticas de preparación aprobadas. No equivale a `deno check`, despliegue ni prueba E2E.
- No se modificaron tablas, buckets, secretos, proyectos Supabase, ni funciones de CAM-RONDAS, CAM-ACCESO, CAM-SST, Admin Maestro o Bridge Central.
- Estado: paquete diagnóstico local; pendiente decidir despliegue controlado de la función `tecchnex-product-authorize` para obtener evidencia desde logs reales.


## CAM-ALMACENAMIENTO-V25 — Auditoría y ajuste de candidata limpia

**Fecha:** 18 de noviembre de 2026  
**Base recibida:** `TECCHNEX_CAM_INSPECCIONES_V25_PUENTE_COMERCIAL_LAB_CANDIDATA_V1_3_DIAGNOSTICO(1).zip`  
**Alcance:** auditoría estática y ajuste acotado; sin despliegues ni cambios remotos.

### Hallazgos y ajustes
1. Se confirmó que el manifiesto interno de la candidata recibida conservaba metadatos V1.2, pese a que el README la identificaba como V1.3. La candidata limpia actualiza su identificación y huellas.
2. Se consolidó la identidad operativa a una sola clave: nombre de puesto normalizado + fecha ISO. En CAM-INSPECCIONES, el campo cliente corresponde al nombre del puesto; no se consulta CRM ni Supabase para asociar evidencia.
3. La restauración general dejó de resolver hallazgos mediante `idControlInspeccion` o índice de origen. Ahora reconstruye hallazgos, checklists y matriz de inspección por la clave de puesto+fecha. Las claves duplicadas o ausentes quedan sin asociación para revisión.
4. La exportación del respaldo ahora se detiene si no puede recuperar una fotografía referenciada por `mediaId`, para evitar crear una copia aparentemente correcta pero incompleta.
5. Se conservó IndexedDB `TECCHNEX_MEDIA_V1`, object store `fotos`, los identificadores `mediaId`, la plantilla Word embebida y los archivos de integración comercial.
6. Se incrementó el identificador de caché del Service Worker a `inspecciones-seguridad-v25-bridge-lab-v3`.

### Limpieza del paquete
Se retiraron del paquete ejecutable los HTML históricos duplicados, capturas de pantalla, hoja de cálculo auxiliar, plantillas Word de trabajo duplicadas y documentos CAM de etapas intermedias. Se conservaron los recursos realmente referenciados por la aplicación, el helper comercial aislado, la función candidata, pruebas y documentación operativa.

### Pruebas
- Pruebas automatizadas Node: **18/18 aprobadas**.
- `node --check`: adaptador, configuración, gate y Service Worker aprobados.
- `node --experimental-strip-types --check`: ambas funciones TypeScript aprobadas.
- Siete bloques JavaScript inline de `index.html`: comprobación sintáctica aprobada.
- No se ejecutó `deno check`.
- No se ejecutó prueba E2E de navegador para respaldo/restauración ni fotografías.
- No se ejecutó prueba remota contra Supabase o Universal Bridge.

### Límites y estado
**Candidata limpia LAB; no desplegada y no aprobada para producción.**  
Antes de reemplazar la versión estable, falta probar en navegador con datos de prueba: restauración en otro perfil/dispositivo, colisión de dos inspecciones con mismo puesto+fecha, checklists, matriz, fotografías, Word/PDF y conexión comercial. Los datos actuales del usuario no se modificaron.

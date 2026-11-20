# CAM-INSPECCIONES V25 — Candidata LAB limpia

**Estado:** candidata de laboratorio para validación local. No desplegada ni aprobada para producción.

## Estructura
- `index.html`: aplicación principal.
- `sw.js`, `manifest.json` e iconos: PWA y caché.
- `adapters/`, `tecchnex-inspecciones-config.js`, `tecchnex-inspecciones-license-gate.js`: puerta comercial de navegador.
- `supabase/functions/`: función candidata de autorización y helper HMAC dedicado de CAM-INSPECCIONES.
- `tests/`: pruebas estáticas de preparación comercial.
- `BITACORA_PREPARACION_CAM_INSPECCIONES_V25.md`: trazabilidad de la preparación.

Se retiraron del paquete ejecutable los HTML históricos duplicados, capturas, hojas de cálculo auxiliares y plantillas/documentos de trabajo que no son cargados por la aplicación. La plantilla Word embebida en la aplicación no fue editada.

## Ejecución local
Desde esta carpeta, ejecutar:

```bash
py -m http.server 5500
```

Abrir `http://localhost:5500/`. No usar Live Server para esta candidata: las pruebas previas detectaron inyección de scripts en HTML generado dinámicamente.

## Pruebas locales
```bash
node --test tests/cam-inspecciones-v25-preparation.test.mjs
```

Estas pruebas no reemplazan la validación E2E en navegador, `deno check` ni las pruebas contra Supabase.

## Almacenamiento — ajuste CAM-RESTAURACION-PUESTO-FECHA-04
- La restauración reconstruye la relación de hallazgos, checklists y matriz de inspección mediante **nombre del puesto normalizado + fecha**.
- `idControl` e índices del equipo de origen no determinan pertenencia.
- Si la clave no existe o es ambigua, el registro queda sin asociación para revisión; no se asigna a otra inspección.
- Si una fotografía referenciada no puede recuperarse al crear un respaldo, la exportación se detiene para evitar una copia incompleta.
- IndexedDB conserva la bóveda `TECCHNEX_MEDIA_V1` y el almacén `fotos`; no se cambió su esquema.

## Protección comercial
- Proyecto Supabase compartido: `ywezkwitbhbyxcwuoiim`.
- Bridge Central: `myineqgojoobgyaviqyy`.
- Helper aislado: `universal-bridge-client-cam-inspecciones.ts`. No copiarlo sobre el helper compartido USER/POST.
- No contiene claves publicables, secretos privados ni valores HMAC.
- No ejecutar despliegues, SQL, migraciones ni cambios de Secrets desde este paquete sin aprobación y verificación independiente.

## Importante
Esta versión limpia organiza los archivos y contiene un ajuste acotado de restauración/respaldo. Aún requiere pruebas funcionales con copias de datos de prueba: respaldo general, restauración en otro perfil/navegador, fotografías, duplicidad de puesto+fecha, checklists, matriz, informe Word/PDF y conexión comercial. No usar todavía como reemplazo de la versión estable publicada.

## CAM-ALMACENAMIENTO-06A — guardado seguro de hallazgos con fotografías
- Si IndexedDB no está disponible, el guardado de un hallazgo que contiene fotografías se detiene antes de actualizar `localStorage`.
- El formulario conserva los datos y fotografías para que el usuario pueda reintentar; no se presenta un guardado exitoso.
- No se cambia el esquema `TECCHNEX_MEDIA_V1` / `fotos`, ni Supabase, tablas, informes o la plantilla Word.
- Se añadió la prueba automatizada `INS-V25-21`. La validación real en navegador sigue pendiente.


SYNC LAB V1.2 — VALIDACIÓN SIN ESCRITURA
El botón “Validar operación (sin escritura)” toma la última operación local completada y envía mode=VALIDATE_ONLY a la Edge Function. Requiere sesión y autorización comercial vigentes; realiza una solicitud HTTPS y lecturas de autorización en servidor, pero la ruta VALIDATE_ONLY se detiene antes del RPC y no escribe en Supabase. No modifica la cola local. El botón “Sincronizar pendientes” conserva su comportamiento de escritura y solo debe usarse con autorización expresa.


## SYNC LAB V1.4 — prueba de escritura controlada
- `Preparar prueba local` crea una única operación sintética `INSERT` de tipo `inspeccion` en la cola local existente. No modifica la colección funcional de inspecciones, no usa datos personales y no realiza solicitudes de red.
- `Enviar prueba controlada` envía exclusivamente esa operación marcada como laboratorio; no procesa otras operaciones pendientes. Al ejecutarlo, la Edge Function valida sesión y contrato y la ruta normal invoca el RPC, por lo que puede insertar un registro sintético persistente en las tablas existentes `tecchnex_cam_inspecciones_sync_ops` y `tecchnex_cam_inspecciones_records`.
- No pulsar `Enviar prueba controlada` sin autorización expresa para esta escritura real. Si la respuesta de red es incierta, no repetir: conservar el mismo `operation_id` y revisar primero el estado en servidor.
- La prueba se considera completada solo con HTTP 200 y `ok:true`. El registro queda marcado en el payload con `_tecchnex_sync_lab_test_v1: true`; no se elimina automáticamente.
- `Sincronizar pendientes` sigue siendo el botón general y no debe usarse para esta prueba; usar únicamente `Enviar prueba controlada` después de revisar el registro local y autorizar la escritura.

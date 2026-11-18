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


/*
 * TECCHNEX CAM-INSPECCIONES
 * CONFIGURACIÓN CENTRAL DE ACCESO
 *
 * Objetivo:
 * - Conexión automática con Supabase.
 * - El usuario no introduce URL ni clave.
 * - Mantener la validación comercial TECCHNEX Universal Bridge.
 *
 * IMPORTANTE:
 * La clave debe ser la clave PUBLICABLE del proyecto.
 * Nunca colocar aquí una service_role ni una clave secreta.
 */

window.TECCHNEX_INSPECCIONES_CONFIG = Object.freeze({

    // Identificación comercial del producto
    productCode: "CAM-INSPECCIONES",

    // Proyecto Supabase compartido Admin Maestro
    projectUrl: "https://ywezkwitbhbyxcwuoiim.supabase.co",

    // Clave pública de Supabase.
    // Sustituir el texto por la clave anon/publicable real.
    supabaseAnonKey: "sb_publishable_vHedj57nWXA_3pRHjJODyA_YSU_OSfh",

    // Función de autorización comercial
    authorizationFunction: "tecchnex-product-authorize",

    // Almacenamiento local de configuración heredada
    configStorageKey: "tecchnex_inspecciones_supabase_public_config_v1"

});

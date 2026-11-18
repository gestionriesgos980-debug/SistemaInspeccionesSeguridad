/*
 * TECCHNEX Universal Bridge — runtime canónico del contrato V1.
 * Se distribuye como copia idéntica dentro de cada aplicación cliente,
 * verificada por tests/sync-contract-adapters.test.mjs.
 * Normaliza respuestas; no autentica identidades ni concede permisos por sí solo.
 */
(function (root) {
  'use strict';

  var OPERATIONAL_ROLES = ['Vigilante', 'Supervisor', 'Administrador TIC'];
  var CONTRACT_CODES = new Set([
    'AUTHORIZED', 'SESSION_REQUIRED', 'INVALID_CREDENTIALS', 'NO_ACTIVE_MEMBERSHIP',
    'PRODUCT_INACTIVE', 'CONTRACT_NOT_ACTIVE', 'IDENTITY_REVOKED', 'PROJECT_LINK_MISSING',
    'ORIGIN_DENIED', 'LICENSE_CHECK_UNAVAILABLE', 'INVALID_REQUEST'
  ]);
  var CODE_ALIASES = {
    INVALID_SESSION: 'SESSION_REQUIRED',
    SESSION_INVALID: 'SESSION_REQUIRED',
    SESSION_INVALID_OR_EXPIRED: 'SESSION_REQUIRED',
    SESSION_TOKEN_REQUIRED: 'SESSION_REQUIRED',
    PRODUCT_NOT_ACTIVE: 'PRODUCT_INACTIVE',
    LICENSE_NOT_ACTIVE: 'CONTRACT_NOT_ACTIVE',
    NO_ACTIVE_PRODUCT_ACCESS: 'CONTRACT_NOT_ACTIVE',
    POST_OR_CONTRACT_INACTIVE: 'CONTRACT_NOT_ACTIVE',
    CONTRACT_LOOKUP_FAILED: 'LICENSE_CHECK_UNAVAILABLE',
    AUTH_BACKEND_UNAVAILABLE: 'LICENSE_CHECK_UNAVAILABLE',
    AUTH_BACKEND_NOT_CONFIGURED: 'LICENSE_CHECK_UNAVAILABLE',
    AUTH_LOOKUP_FAILED: 'LICENSE_CHECK_UNAVAILABLE',
    VALIDATION_UNAVAILABLE: 'LICENSE_CHECK_UNAVAILABLE',
    CENTRAL_SERVER_CONFIGURATION_INCOMPLETE: 'LICENSE_CHECK_UNAVAILABLE',
    CENTRAL_AUTHORIZATION_INTERNAL_ERROR: 'LICENSE_CHECK_UNAVAILABLE',
    IDENTITY_MAPPING_NOT_ACTIVE: 'PROJECT_LINK_MISSING',
    IDENTITY_MAPPING_AMBIGUOUS: 'PROJECT_LINK_MISSING',
    IDENTITY_MAPPING_INVALID: 'PROJECT_LINK_MISSING',
    METHOD_NOT_ALLOWED: 'INVALID_REQUEST',
    UNSUPPORTED_MEDIA_TYPE: 'INVALID_REQUEST',
    INVALID_BODY: 'INVALID_REQUEST',
    INVALID_JSON: 'INVALID_REQUEST',
    BODY_TOO_LARGE: 'INVALID_REQUEST',
    INVALID_RESPONSE: 'LICENSE_CHECK_UNAVAILABLE'
  };

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function productCode(value) {
    return typeof value === 'string' ? value.trim().toUpperCase() : '';
  }

  function normalizedCode(value) {
    var candidate = typeof value === 'string' ? value.trim().toUpperCase() : '';
    candidate = CODE_ALIASES[candidate] || candidate;
    return CONTRACT_CODES.has(candidate) ? candidate : 'LICENSE_CHECK_UNAVAILABLE';
  }

  function validDateOnly(value) {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split('-').map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
  }

  function failure(expectedProductCode, code, message) {
    return {
      schema_version: 1,
      authorized: false,
      code: normalizedCode(code),
      message: typeof message === 'string' && message.trim() ? message.trim() : 'El servidor no autorizó el acceso.',
      product_code: productCode(expectedProductCode) || null,
      valid_from: null,
      valid_until: null,
      checked_at: null,
      expires_in: 0,
      session: null
    };
  }

  function normalizeTecchnexAuthorizationResponse(raw, expectedProductCode) {
    var expected = productCode(expectedProductCode || 'CAM-SST');
    if (!expected || !isRecord(raw)) {
      return failure(expected || null, 'INVALID_REQUEST', 'Respuesta o producto esperado inválido.');
    }

    var suppliedProduct = raw.product_code !== undefined ? raw.product_code : raw.product;
    if (suppliedProduct !== undefined && productCode(suppliedProduct) !== expected) {
      return failure(expected, 'INVALID_REQUEST', 'La respuesta corresponde a otro producto.');
    }

    var canonicalPositive = raw.schema_version === 1 && raw.authorized === true && raw.code === 'AUTHORIZED' && raw.product_code === expected;
    var legacyPositive = raw.ok === true && raw.authorized === true && productCode(suppliedProduct) === expected;
    if (!canonicalPositive && !legacyPositive) {
      var failureCode = raw.code || (raw.authorized === false ? 'LICENSE_CHECK_UNAVAILABLE' : 'INVALID_RESPONSE');
      return failure(expected, failureCode, raw.message || 'No fue posible verificar la licencia. El acceso permanece bloqueado.');
    }

    var validFrom = raw.valid_from === undefined ? null : raw.valid_from;
    var validUntil = raw.valid_until === undefined ? null : raw.valid_until;
    if (!validDateOnly(validFrom) || !validDateOnly(validUntil)) {
      return failure(expected, 'LICENSE_CHECK_UNAVAILABLE', 'La respuesta de licencia contiene fechas inválidas.');
    }
    if (typeof validFrom === 'string' && typeof validUntil === 'string' && validUntil < validFrom) {
      return failure(expected, 'LICENSE_CHECK_UNAVAILABLE', 'El rango de vigencia recibido es inválido.');
    }
    var checkedAt = typeof raw.checked_at === 'string' && Number.isFinite(Date.parse(raw.checked_at)) ? raw.checked_at : null;
    return {
      schema_version: 1,
      authorized: true,
      code: 'AUTHORIZED',
      message: typeof raw.message === 'string' && raw.message.trim() ? raw.message.trim() : 'Autorización comercial confirmada.',
      product_code: expected,
      valid_from: validFrom,
      valid_until: validUntil,
      checked_at: checkedAt,
      expires_in: null,
      session: null
    };
  }

  function normalizeCamRondasPostAuthorization(raw, expectedProductCode) {
    var expected = productCode(expectedProductCode || 'CAM-RONDAS');
    if (expected !== 'CAM-RONDAS' || !isRecord(raw)) {
      return failure('CAM-RONDAS', 'INVALID_REQUEST', 'Respuesta o producto esperado inválido.');
    }
    if (raw.authorized !== true || raw.code !== 'AUTHORIZED') {
      return failure('CAM-RONDAS', raw.code, raw.message || 'El servidor no autorizó el puesto.');
    }
    if (!isRecord(raw.post) || typeof raw.post.id !== 'string' || !raw.post.id.trim() ||
        typeof raw.post.role !== 'string' || OPERATIONAL_ROLES.indexOf(raw.post.role) < 0 ||
        typeof raw.session_token !== 'string' || !raw.session_token.trim() ||
        typeof raw.expires_in !== 'number' || !Number.isFinite(raw.expires_in) || raw.expires_in <= 0) {
      return failure('CAM-RONDAS', 'LICENSE_CHECK_UNAVAILABLE', 'La respuesta de autorización está incompleta o no es válida.');
    }
    return {
      schema_version: 1,
      authorized: true,
      code: 'AUTHORIZED',
      message: typeof raw.message === 'string' && raw.message.trim() ? raw.message.trim() : 'Puesto autorizado por el servidor.',
      product_code: 'CAM-RONDAS',
      valid_from: null,
      valid_until: null,
      checked_at: null,
      expires_in: raw.expires_in,
      session: { token: raw.session_token, token_type: 'Bearer' }
    };
  }

  function normalizeCamRondasAuthorizationResponse(raw) {
    var normalized = normalizeCamRondasPostAuthorization(raw, 'CAM-RONDAS');
    return normalized.authorized === true ? normalized : null;
  }

  function isUniversalAuthorizationGranted(result, expectedProductCode, requireSession) {
    if (!isRecord(result) || result.schema_version !== 1 || result.authorized !== true ||
        result.code !== 'AUTHORIZED' || result.product_code !== productCode(expectedProductCode) ||
        typeof result.message !== 'string' || !result.message.trim()) return false;

    if (!validDateOnly(result.valid_from) || !validDateOnly(result.valid_until)) return false;
    if (typeof result.valid_from === 'string' && typeof result.valid_until === 'string' && result.valid_until < result.valid_from) return false;

    if (result.session === null || result.session === undefined) return requireSession !== true;
    if (!isRecord(result.session) || typeof result.session.token !== 'string' ||
        !result.session.token.trim() || result.session.token_type !== 'Bearer' ||
        typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0) return false;
    return true;
  }

  root.TECCHNEXUniversalBridge = Object.freeze({
    OPERATIONAL_ROLES: Object.freeze(OPERATIONAL_ROLES.slice()),
    normalizeTecchnexAuthorizationResponse: normalizeTecchnexAuthorizationResponse,
    normalizeCamRondasPostAuthorization: normalizeCamRondasPostAuthorization,
    normalizeCamRondasAuthorizationResponse: normalizeCamRondasAuthorizationResponse,
    isUniversalAuthorizationGranted: isUniversalAuthorizationGranted,
    isTecchnexAuthorizationGranted: isUniversalAuthorizationGranted
  });
})(typeof window !== 'undefined' ? window : globalThis);

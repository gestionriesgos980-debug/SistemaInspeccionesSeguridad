/* TECCHNEX CAM-INSPECCIONES — adaptador de recuperación remota V1
 * Convierte registros remotos a un plan de incorporación de SOLO LECTURA.
 * No escribe localStorage, IndexedDB, Supabase ni Storage.
 */
(function(root){
  'use strict';
  const MAP = Object.freeze({
    hallazgo: 'hallazgos',
    checklist: 'checklists',
    matriz_riesgos: 'matrizRiesgos',
    matriz_cliente: 'matricesRiesgosClientes',
    vulnerabilidad: 'evaluacionesVulnerabilidades',
    agenda_visita: 'agendaSupervision',
    actividad_gestion: 'actividadesMiGestion',
    evento_trazabilidad: 'bitacoraTrazabilidad'
  });
  const ARRAY_KEYS = Object.freeze(['inspecciones','hallazgos','checklists','matrizRiesgos','matricesRiesgosClientes','evaluacionesVulnerabilidades','agendaSupervision','actividadesMiGestion','bitacoraTrazabilidad']);
  const DEFERRED = Object.freeze({
    resultado_checklist: 'La estructura local resultadosChecklistCategorias es un objeto indexado por el índice local de inspección; el contrato remoto actual no define una identidad estable para reconstruir esa asociación. Se excluye para evitar mezclar resultados entre inspecciones.',
    seguimiento_proceso: 'El seguimiento local se almacena como objeto en tecchnex_mi_gestion_seguimiento_v1. El contrato remoto no acredita todavía una clave de asociación compatible; se conserva fuera del plan para evitar sobrescribir o mezclar procesos.'
  });
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const arr = v => Array.isArray(v) ? v : [];
  function canonical(value){
    if(Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if(isObj(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function makePlan(remoteItems, localState){
    if(!Array.isArray(remoteItems)) throw new Error('La lista remota no tiene formato válido.');
    const local = isObj(localState) ? localState : {};
    const buckets = {};
    for(const key of ARRAY_KEYS){
      if(local[key] !== undefined && !Array.isArray(local[key])) throw new Error(`La clave local ${key} no contiene un arreglo; vista previa cancelada.`);
      buckets[key] = arr(local[key]);
    }
    const planned = Object.fromEntries(ARRAY_KEYS.map(k => [k, []]));
    const duplicateCounts = Object.fromEntries(ARRAY_KEYS.map(k => [k, 0]));
    const unsupported = {};
    const deferred = {};
    const inspections = [];
    let incomplete = 0, invalid = 0, photosPending = 0;
    for(const item of remoteItems){
      const record = item && item.record;
      if(!isObj(record) || record.record_type !== 'inspeccion' || !isObj(record.payload) || !Array.isArray(item.related_records)) { invalid++; continue; }
      const rootPayload = record.payload;
      const identity = String(rootPayload.idInspeccionInterno || record.record_sync_id || '').trim();
      const rootDuplicate = buckets.inspecciones.some(x =>
        (identity && String(x?.idInspeccionInterno || '').trim() === identity) ||
        canonical(x) === canonical(rootPayload)
      );
      if(!rootDuplicate) planned.inspecciones.push(rootPayload); else duplicateCounts.inspecciones++;
      let childAdded = 0, childDuplicates = 0, childUnsupported = 0;
      for(const child of item.related_records){
        const type = String(child?.record_type || '');
        const target = MAP[type];
        if(!target){
          const key = type || '(sin tipo)';
          unsupported[key] = (unsupported[key] || 0) + 1;
          if(DEFERRED[key]) deferred[key] = { count: (deferred[key]?.count || 0) + 1, reason: DEFERRED[key] };
          childUnsupported++; continue;
        }
        if(!isObj(child.payload)){ invalid++; continue; }
        const payloadIdentity = ['evaluacionesVulnerabilidades','agendaSupervision','actividadesMiGestion','bitacoraTrazabilidad'].includes(target)
          ? String(child.payload.id || child.payload.idEvento || '').trim()
          : '';
        const duplicate = buckets[target].some(x => (payloadIdentity && String(x?.id || x?.idEvento || '').trim() === payloadIdentity) || canonical(x) === canonical(child.payload)) ||
          planned[target].some(x => (payloadIdentity && String(x?.id || x?.idEvento || '').trim() === payloadIdentity) || canonical(x) === canonical(child.payload));
        if(duplicate){ duplicateCounts[target]++; childDuplicates++; }
        else { planned[target].push(child.payload); childAdded++; }
      }
      if(item.related_records_complete === false) incomplete++;
      inspections.push({
        record_sync_id: record.record_sync_id,
        id_control: String(rootPayload.idControl || rootPayload.idInforme || record.record_sync_id),
        cliente: String(rootPayload.nombrePuesto || rootPayload.cliente || rootPayload.nombreCliente || rootPayload.razonSocial || 'Sin nombre'),
        fecha: String(rootPayload.fecha || rootPayload.fechaInspeccion || 'Sin fecha'),
        root_action: rootDuplicate ? 'DUPLICADA' : 'NUEVA',
        children_to_add: childAdded,
        children_duplicates: childDuplicates,
        children_unsupported: childUnsupported,
        related_records_complete: item.related_records_complete !== false
      });
      photosPending += arr(item.photo_manifest).length;
    }
    const addCounts = Object.fromEntries(ARRAY_KEYS.map(k => [k, planned[k].length]));
    return Object.freeze({
      schema:'TECCHNEX-CAM-INSPECCIONES-RECOVERY-PLAN-1',
      mode:'PREVIEW_ONLY',
      inspections,
      planned,
      add_counts:addCounts,
      duplicate_counts:duplicateCounts,
      unsupported_record_types:unsupported,
      deferred_record_types:deferred,
      incomplete_inspections:incomplete,
      invalid_records:invalid,
      photos_pending:photosPending,
      deferred_local_structures:{resultadosChecklistCategorias:'No incorporado: asociación por índice local no reconstruible con seguridad.',seguimientoInspeccionesMiGestion:'No incorporado: requiere confirmar identidad y estructura de asociación.'},
      safeguards:{local_writes:0,indexeddb_writes:0,remote_writes:0,storage_uploads:0}
    });
  }
  root.TECCHNEXCamInspeccionesRecoveryAdapterV1 = Object.freeze({makePlan});
})(typeof window !== 'undefined' ? window : globalThis);

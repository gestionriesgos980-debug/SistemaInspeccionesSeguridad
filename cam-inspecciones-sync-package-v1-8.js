/* TECCHNEX CAM-INSPECCIONES — constructor local de paquete de sincronización V1.8
 * Solo prepara JSON local. No hace fetch, RPC, Storage ni escrituras.
 */
(function(root){
 'use strict';
 const NS_RECORD='7a3f5d90-1e2b-5c4d-8f60-1234567890ab';
 const NS_OPERATION='9b4e6fa1-2f3c-5d6e-8a70-abcdef123456';
 const ALLOWED=new Set(['inspeccion','hallazgo','matriz_cliente','vulnerabilidad','checklist','resultado_checklist','matriz_riesgos','agenda_visita','actividad_gestion','seguimiento_proceso','evento_trazabilidad']);
 const MAX=1024*1024;
 const enc=new TextEncoder();
 function uuidBytes(s){return s.toLowerCase().replace(/-/g,'').match(/.{2}/g).map(x=>parseInt(x,16));}
 function uuidString(b){const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
 async function uuidV5(namespace,name){
  const ns=uuidBytes(namespace), data=new Uint8Array(ns.length+enc.encode(name).length);data.set(ns);data.set(enc.encode(name),ns.length);
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-1',data)).slice(0,16);
  hash[6]=(hash[6]&0x0f)|0x50;hash[8]=(hash[8]&0x3f)|0x80;return uuidString(hash);
 }
 function cloneWithoutBinary(value){
  if(Array.isArray(value))return value.map(cloneWithoutBinary);
  if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value)){if(k==='dataUrl'||k==='dataURL'||k==='blob'||k==='file')continue;out[k]=cloneWithoutBinary(v);}return out;}
  return value;
 }
 function bytes(v){return enc.encode(JSON.stringify(v)).byteLength;}
 async function build(report){
  if(!report||!report.source||!report.inspection||!report.related||!report.integrity?.photo_associations_valid)throw new Error('Primero debe aprobarse la auditoría V1.6 de asociaciones fotográficas.');
  const internal=String(report.source.idInspeccionInterno||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(internal))throw new Error('La inspección no tiene un UUID interno válido para conservar su identidad.');
  const inspectionId=internal, sourceId=report.source.idControl;
  const rootPayload=report.inspection.payload||{};
  const rootDate=String(rootPayload.fecha||'').slice(0,10);
  const rootPost=String(rootPayload.nombrePuesto||'').trim().replace(/\s+/g,' ').toLowerCase();
  const functionalKey=`${rootDate}|${rootPost}`;
  const storedKey=String(rootPayload.claveInspeccionPuestoFecha||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(rootDate)||!rootPost)throw new Error('La inspección principal no tiene fecha y nombre de puesto válidos; paquete cancelado.');
  if(storedKey && storedKey!==functionalKey)throw new Error('La clave funcional del registro principal no coincide con puesto + fecha; no se permite sincronizar una inspección anterior.');
  const records=[];
  async function add(recordType,sourceKey,payload,parentSyncId=null){
   if(!ALLOWED.has(recordType))throw new Error(`Tipo de registro no admitido por el contrato actual: ${recordType}`);
   const syncId=recordType==='inspeccion'?inspectionId:await uuidV5(NS_RECORD,`${inspectionId}|${recordType}|${sourceKey}`);
   const operationId=await uuidV5(NS_OPERATION,`${syncId}|INSERT|v1`);
   const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
   if(!uuidPattern.test(syncId)||!uuidPattern.test(operationId))throw new Error('Se generó un UUID inválido; paquete cancelado.');
   const clean=cloneWithoutBinary(payload);
   const operation={operation_id:operationId,record_sync_id:syncId,operation_type:'INSERT',expected_version:null,record_type:recordType,parent_sync_id:parentSyncId,payload:clean};
   const payloadBytes=bytes(operation);
   if(payloadBytes>MAX)throw new Error(`El registro ${recordType} supera el límite de solicitud de 1 MiB (${payloadBytes} bytes).`);
   records.push({...operation,payload_bytes:payloadBytes});
  }
  await add('inspeccion','root',report.inspection.payload,null);
  for(let i=0;i<report.related.hallazgos.length;i++){
   const h=report.related.hallazgos[i];
   await add('hallazgo',`${i+1}|${h.finding_number||''}|${h.payload.area||''}`,h.payload,inspectionId);
  }
  for(let i=0;i<report.related.matrices_riesgos_cliente.length;i++){
   await add('matriz_cliente',`${i+1}|${report.related.matrices_riesgos_cliente[i].payload.area||''}`,report.related.matrices_riesgos_cliente[i].payload,inspectionId);
  }
  if(report.related.evaluacion_vulnerabilidades){
   await add('vulnerabilidad',String(report.related.evaluacion_vulnerabilidades.payload.id||'evaluacion'),report.related.evaluacion_vulnerabilidades.payload,inspectionId);
  }
  for(const group of report.related.checklists||[])await add('checklist',String(records.length),group.payload,inspectionId);
  for(let i=0;i<(report.related.resultados_checklist||[]).length;i++){
   const row=report.related.resultados_checklist[i];
   await add('resultado_checklist',`${row.payload.inspeccionIndice}|${row.payload.categoria}`,row.payload,inspectionId);
  }
  for(const group of report.related.matriz_riesgos_inspeccion||[])await add('matriz_riesgos',String(records.length),group.payload,inspectionId);
  const media=(report.related.media||[]).map(row=>({
   media_id:String(row.payload.mediaId),record_type:'media_file',parent_record_sync_id:inspectionId,
   finding_number:String(row.payload.hallazgo),timestamp:row.payload.timestamp||null,
   hash_sha256:row.payload.hashSha256||null,id_control:row.payload.idControl||sourceId,
   mime_type:(String(row.payload.dataUrl||'').match(/^data:([^;,]+)/)||[])[1]||null,
   transfer_status:'PENDING_STORAGE_UPLOAD'
  }));
  if(media.some(x=>!x.media_id||!x.hash_sha256||!x.finding_number))throw new Error('El manifiesto fotográfico contiene referencias incompletas.');
  const ids=new Set(records.map(x=>x.record_sync_id));
  if(ids.size!==records.length)throw new Error('Se detectaron identificadores de registro duplicados.');
  return {
   schema:'TECCHNEX-CAM-INSPECCIONES-SYNC-PACKAGE-1',
   mode:'LOCAL_PACKAGE_ONLY',
   created_at:new Date().toISOString(),
   source:{id_control:sourceId,id_inspeccion_interno:inspectionId,fecha:rootDate,nombre_puesto:String(rootPayload.nombrePuesto).trim(),clave_funcional:functionalKey},
   contract:{accepted_record_types:[...ALLOWED],max_request_bytes:MAX,photo_transfer:'SEPARATE_PRIVATE_STORAGE_UPLOAD_NOT_INCLUDED'},
   counts:{records:records.length,inspecciones:1,hallazgos:report.counts.hallazgos,matrices_cliente:report.counts.matrices_riesgos_cliente,vulnerabilidad:report.related.evaluacion_vulnerabilidades?1:0,checklists:report.counts.checklists,resultados_checklist:report.counts.resultados_checklist||0,matrices_inspeccion:report.counts.matriz_riesgos_inspeccion,photos_manifest:media.length},
   records,photo_manifest:media,
   safeguards:{network_requests:0,rpc_calls:0,storage_uploads:0,local_data_mutations:0,production_changes:0},
   ready_for_remote_write:false
  };
 }
 root.TECCHNEXCamInspeccionesSyncPackageV18=Object.freeze({build});
})(typeof window!=='undefined'?window:globalThis);

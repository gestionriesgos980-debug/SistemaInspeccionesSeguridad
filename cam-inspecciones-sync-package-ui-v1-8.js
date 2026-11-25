/* CAM-INSPECCIONES V25 — interfaz simplificada de envío.
 * Un respaldo individual -> auditoría local -> paquete en memoria -> VALIDATE_ONLY
 * -> confirmación explícita -> fotografías y registros. No modifica el contrato remoto.
 */
(function(){
 'use strict';
 const queueSelect=document.getElementById('camSyncPendingInspectionV1');
 const queueSend=document.getElementById('camSyncSendPendingV1');
 const queueStatus=document.getElementById('camSyncPendingStatusV1');
 function getSyncApi(){return window.TECCHNEXCamInspeccionesSyncClientV1||null;}
 function refreshPendingQueue(){
  if(!queueSelect||!queueSend)return;
  const syncApi=getSyncApi();
  if(!syncApi||typeof syncApi.getPendingInspectionCandidates!=='function'){
   queueSelect.replaceChildren();const opt=document.createElement('option');opt.value='';opt.textContent='Inicializando sincronización…';queueSelect.append(opt);
   queueSend.disabled=true;queueSend.style.opacity='.55';
   if(!queueSelect.dataset.initRetry){queueSelect.dataset.initRetry='1';document.addEventListener('DOMContentLoaded',refreshPendingQueue,{once:true});}
   return;
  }
  try{
   const items=syncApi.getPendingInspectionCandidates();
   queueSelect.replaceChildren();
   if(!items.length){const opt=document.createElement('option');opt.value='';opt.textContent='No hay inspecciones pendientes';queueSelect.append(opt);queueSend.disabled=true;queueSend.style.opacity='.55';queueStatus.textContent='No hay cambios pendientes para enviar desde este equipo.';return;}
   for(const item of items){const opt=document.createElement('option');opt.value=item.key;opt.textContent=`${item.nombrePuesto} · ${item.fecha} · ${item.idControl}`;queueSelect.append(opt);}
   queueSend.disabled=false;queueSend.style.opacity='1';
   queueStatus.textContent=items.length===1
    ? 'Inspección pendiente identificada. Al continuar, se recuperarán localmente sus hallazgos, matrices, checklists, evaluación de vulnerabilidades y fotografías para validar el paquete completo.'
    : `${items.length} inspecciones pendientes. Selecciona cuál deseas preparar y enviar; cada una se procesará por separado.`;
  }catch(error){queueSelect.replaceChildren();const opt=document.createElement('option');opt.value='';opt.textContent='Revisión requerida';queueSelect.append(opt);queueSend.disabled=true;queueSend.style.opacity='.55';queueStatus.textContent=error.message||'No fue posible leer la cola local.';}
 }
 if(queueSelect&&queueSend){
  refreshPendingQueue();
  queueSend.addEventListener('click',async()=>{
   const selected=queueSelect.value;
   const syncApi=getSyncApi();
   if(!selected||!syncApi||typeof syncApi.sendPendingInspection!=='function'){queueStatus.textContent='No hay una inspección pendiente seleccionada o el módulo no está disponible.';return;}
   queueSend.disabled=true;queueSend.textContent='Preparando y validando…';
   try{await syncApi.sendPendingInspection(selected);queueStatus.textContent='Proceso finalizado. Revisa el resultado de sincronización antes de cerrar el panel.';}
   catch(error){queueStatus.textContent=(error&&error.message?error.message:'No fue posible preparar el envío.')+'\nNo se ha confirmado el envío de esta inspección.';}
   finally{queueSend.textContent='Preparar y enviar inspección a Supabase';refreshPendingQueue();}
  });
 }
 const input=document.getElementById('camSyncImportJsonV1');
 const output=document.getElementById('camSyncImportResultV1');
 const send=document.getElementById('camSyncSendIndividualV1');
 const advanced=document.getElementById('camSyncAdvancedTools');
 if(!input||!output||!send||!window.TECCHNEXCamInspeccionesExportAdapter)return;
 let selectedReport=null;
 input.addEventListener('change',async function(){
  selectedReport=null;send.disabled=true;send.style.opacity='.55';
  const file=input.files&&input.files[0];if(!file){output.textContent='Selecciona el respaldo individual JSON.';return;}
  output.textContent='Revisando el respaldo local…';
  try{
   if(file.size>25*1024*1024)throw new Error('El JSON supera el límite local de 25 MB.');
   const parsed=JSON.parse(await file.text());
   const report=window.TECCHNEXCamInspeccionesExportAdapter.normalize(parsed);
   const c=report.counts,q=report.integrity;
   const rows=[
    `Inspección: ${report.source.idControl}`,
    `Hallazgos: ${c.hallazgos} · Fotografías: ${c.media}`,
    `Matrices cliente: ${c.matrices_riesgos_cliente} · Vulnerabilidades: ${c.vulnerability_answers} respuestas`,
    `Asociaciones fotográficas: ${q.photo_associations_valid?'CORRECTAS':'REVISAR'}`
   ];
   if(!q.photo_associations_valid)throw new Error(rows.join('\n')+'\nEl envío queda bloqueado hasta corregir las asociaciones.');
   selectedReport=report;window.CAM_INSPECCIONES_LAST_EXPORT_AUDIT=report;
   output.textContent=rows.join('\n')+'\nRespaldo aprobado para preparar la validación. Todavía no se ha enviado nada.';
   output.style.color='#146d4a';send.disabled=false;send.style.opacity='1';
  }catch(e){output.textContent=e&&e.message?e.message:'No fue posible revisar el respaldo.';output.style.color='#a22626';}
 });
 send.addEventListener('click',async()=>{
  if(!selectedReport){output.textContent='Primero selecciona y valida el respaldo individual.';return;}
  const api=window.TECCHNEXCamInspeccionesSyncClientV1;
  if(!api||typeof api.sendAuditReport!=='function'){output.textContent='El módulo de sincronización no está listo. Recarga la aplicación e inténtalo de nuevo.';return;}
  send.disabled=true;send.textContent='Validando y preparando envío…';
  try{await api.sendAuditReport(selectedReport);}
  catch(e){output.textContent=(e&&e.message?e.message:'No fue posible completar el envío.')+'\nEl respaldo original permanece en este equipo.';output.style.color='#a22626';}
  finally{send.disabled=false;send.textContent='Enviar inspección a Supabase';send.style.opacity='1';}
 });
 // Se conserva la descarga manual del paquete local para soporte técnico.
 if(advanced&&window.TECCHNEXCamInspeccionesSyncPackageV18){
  const btn=document.createElement('button');btn.type='button';btn.id='camSyncBuildPackageV17';btn.textContent='Descargar paquete técnico (solo local)';
  btn.style.cssText='background:#334e68;color:#fff;border:0;border-radius:6px;padding:8px 10px;font-weight:700;cursor:pointer;margin-top:9px;width:100%';
  const out=document.createElement('div');out.id='camSyncPackageStatusV17';out.setAttribute('role','status');out.style.cssText='margin-top:6px;font-size:11px;color:#475569;white-space:pre-line';
  advanced.querySelector('div')?.append(btn,out);
  btn.addEventListener('click',async()=>{
   const report=window.CAM_INSPECCIONES_LAST_EXPORT_AUDIT;
   if(!report){out.textContent='Selecciona primero un respaldo individual y aprueba su auditoría local.';return;}
   btn.disabled=true;btn.textContent='Preparando paquete…';
   try{
    const pkg=await window.TECCHNEXCamInspeccionesSyncPackageV18.build(report);
    const blob=new Blob([JSON.stringify(pkg,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`TECCHNEX_SYNC_PACKAGE_${pkg.source.id_control}_V1_9.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    out.textContent=`Paquete local preparado: ${pkg.counts.records} registros y ${pkg.counts.photos_manifest} fotografías. Sin solicitudes de red ni escrituras.`;
   }catch(e){out.textContent=e&&e.message?e.message:'No fue posible preparar el paquete.';}
   finally{btn.disabled=false;btn.textContent='Descargar paquete técnico (solo local)';}
  });
 }
})();

/* Auditor local del JSON individual: no toca almacenamiento ni red. */
(function(){
 'use strict';
 const input=document.getElementById('camSyncImportJsonV1');
 const output=document.getElementById('camSyncImportResultV1');
 if(!input||!output||!window.TECCHNEXCamInspeccionesExportAdapter)return;
 input.addEventListener('change',async function(){
  const file=input.files&&input.files[0]; if(!file)return;
  output.textContent='Leyendo archivo local…';
  try{
   if(file.size>25*1024*1024)throw new Error('El JSON supera el límite local de 25 MB.');
   const parsed=JSON.parse(await file.text());
   const report=window.TECCHNEXCamInspeccionesExportAdapter.normalize(parsed);
   const c=report.counts, q=report.integrity;
   const rows=[
    `Inspección: ${report.source.idControl} · ${c.inspection_fields} campos`,
    `Hallazgos: ${c.hallazgos} · Fotos: ${c.media} · Fotos asociadas: ${c.media_linked_to_findings}`,
    `Matrices del cliente: ${c.matrices_riesgos_cliente} · Matriz propia: ${c.matriz_riesgos_inspeccion}`,
    `Checklists independientes: ${c.checklists}`,
    `Vulnerabilidades: ${c.vulnerability_answers} respuestas · ${c.vulnerability_observation_keys} claves de observación`,
    `Fotos sin dataURL: ${q.media_missing_data_url} · sin mediaId: ${q.media_missing_media_id} · sin hash: ${q.media_missing_hash}`,
    `Fotos sin referencia de hallazgo: ${q.media_without_finding_reference}`,
    `Referencias sin archivo: ${q.finding_refs_missing_media.length} · Fotos sin referencia inversa: ${q.media_not_referenced_by_finding} · IDs duplicados: ${q.duplicate_media_ids.length}`,
    `Integridad de asociaciones: ${q.photo_associations_valid ? 'CORRECTA' : 'REVISAR'}`,
    `Modo: análisis local; no se envió información ni se modificó ningún dato.`
   ];
   output.textContent=rows.join('\n');
   output.style.whiteSpace='pre-line'; output.style.color=q.photo_associations_valid?'#146d4a':'#a16207';
   window.CAM_INSPECCIONES_LAST_EXPORT_AUDIT=report;
  }catch(e){output.textContent=e&&e.message?e.message:'No fue posible auditar el archivo.';output.style.color='#a22626';}
 });
})();

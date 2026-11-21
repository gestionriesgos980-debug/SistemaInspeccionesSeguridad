/* TECCHNEX CAM-INSPECCIONES — adaptador de exportación individual V1.0
 * Interpreta la estructura real del JSON individual sin mutar el origen.
 * No realiza llamadas de red, escrituras locales ni operaciones Supabase.
 */
(function(root){
  'use strict';
  function isObj(v){ return !!v && typeof v==='object' && !Array.isArray(v); }
  function arr(v){ return Array.isArray(v)?v:[]; }
  function nonEmpty(v){ return v!==null && v!==undefined && String(v).trim()!==''; }
  function normalize(exported){
    if(!isObj(exported) || exported.tipoArchivo!=='inspeccion-individual' || !isObj(exported.datos)) throw new Error('El archivo no corresponde a una exportación individual de inspección TECCHNEX.');
    const d=exported.datos, inspection=d.inspeccion;
    if(!isObj(inspection)) throw new Error('El archivo no contiene datos de inspección válidos.');
    const inspectionId=String(inspection.idControl||exported.idControl||'').trim(), internalId=String(inspection.idInspeccionInterno||'').trim();
    if(!inspectionId) throw new Error('La inspección no tiene idControl.');
    const findings=arr(d.hallazgos), media=arr(d.mediosFotograficos), clientRisks=arr(d.matricesRiesgosClientes), inspectionRisks=arr(d.matrizRiesgos), checklists=arr(d.checklists), vulnerability=isObj(d.evaluacionVulnerabilidades)?d.evaluacionVulnerabilidades:null;
    // El número del hallazgo vive en hallazgos[].fotos[].hallazgo; no se exige id/numero.
    const findingByNumber=new Map(), findingMediaIds=new Set();
    const findingRows=findings.map((payload,index)=>{
      const refs=arr(payload.fotos), numbers=[...new Set(refs.map(f=>String(f?.hallazgo??'').trim()).filter(Boolean))];
      const findingNumber=numbers.length===1?numbers[0]:null, mediaIds=refs.map(f=>String(f?.mediaId||'').trim()).filter(Boolean);
      mediaIds.forEach(id=>findingMediaIds.add(id));
      const row={record_type:'hallazgo',payload,source_index:index+1,finding_number:findingNumber,media_ids:mediaIds,media_count:mediaIds.length};
      if(findingNumber){if(!findingByNumber.has(findingNumber))findingByNumber.set(findingNumber,[]);findingByNumber.get(findingNumber).push(row);} return row;
    });
    const mediaById=new Map(), duplicateMediaIds=[];
    const mediaMissingData=media.filter(m=>typeof m?.dataUrl!=='string'||!/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+$/i.test(m.dataUrl)).length;
    const mediaMissingId=media.filter(m=>!nonEmpty(m?.mediaId)).length, mediaMissingHash=media.filter(m=>!nonEmpty(m?.hashSha256)).length, mediaMissingFinding=media.filter(m=>!nonEmpty(m?.hallazgo)).length;
    for(const item of media){const id=String(item?.mediaId||'').trim();if(!id)continue;if(mediaById.has(id))duplicateMediaIds.push(id);else mediaById.set(id,item);}
    const mediaWithoutFinding=media.filter(m=>{const k=String(m?.hallazgo??'').trim();return !k||!findingByNumber.has(k);}).length;
    const findingRefsMissingMedia=[...findingMediaIds].filter(id=>!mediaById.has(id));
    const mediaNotReferencedByFinding=media.filter(m=>!findingMediaIds.has(String(m?.mediaId||''))).length;
    const associationMismatches=media.filter(m=>{const id=String(m?.mediaId||''), key=String(m?.hallazgo??'');const owners=findings.filter(h=>arr(h.fotos).some(f=>String(f?.mediaId||'')===id));return owners.length!==1||!owners[0]||!arr(owners[0].fotos).some(f=>String(f?.hallazgo??'')===key);}).length;
    const responseCount=vulnerability&&isObj(vulnerability.respuestas)?Object.keys(vulnerability.respuestas).length:0, responseObservations=vulnerability&&isObj(vulnerability.observacionesPorPregunta)?Object.keys(vulnerability.observacionesPorPregunta).length:0;
    const mediaRows=media.map(payload=>({record_type:'media',payload,parent_finding_number:String(payload.hallazgo??''),media_id:String(payload.mediaId||'')}));
    const linkedMediaCount=media.length-mediaWithoutFinding;
    const associationOk=mediaMissingData===0&&mediaMissingId===0&&mediaMissingHash===0&&mediaMissingFinding===0&&mediaWithoutFinding===0&&findingRefsMissingMedia.length===0&&mediaNotReferencedByFinding===0&&duplicateMediaIds.length===0&&associationMismatches===0;
    return Object.freeze({schema:'TECCHNEX-CAM-INSPECCIONES-EXPORT-ADAPTER-2',source:{tipoArchivo:exported.tipoArchivo,versionExportacion:exported.versionExportacion||null,idControl:inspectionId,idInspeccionInterno:internalId||null},inspection:{record_type:'inspeccion',payload:inspection,field_count:Object.keys(inspection).length},related:{hallazgos:findingRows,checklists:checklists.map(payload=>({record_type:'checklist',payload})),matriz_riesgos_inspeccion:inspectionRisks.map(payload=>({record_type:'matriz_riesgos',payload})),matrices_riesgos_cliente:clientRisks.map(payload=>({record_type:'matriz_riesgos_cliente',payload})),evaluacion_vulnerabilidades:vulnerability?{record_type:'evaluacion_vulnerabilidades',payload:vulnerability}:null,media:mediaRows},counts:{inspection_fields:Object.keys(inspection).length,hallazgos:findings.length,checklists:checklists.length,matriz_riesgos_inspeccion:inspectionRisks.length,matrices_riesgos_cliente:clientRisks.length,media:media.length,media_linked_to_findings:linkedMediaCount,vulnerability_answers:responseCount,vulnerability_observation_keys:responseObservations},integrity:{media_missing_data_url:mediaMissingData,media_missing_media_id:mediaMissingId,media_missing_hash:mediaMissingHash,media_missing_finding_number:mediaMissingFinding,media_without_finding_reference:mediaWithoutFinding,finding_refs_missing_media:findingRefsMissingMedia,media_not_referenced_by_finding:mediaNotReferencedByFinding,duplicate_media_ids:duplicateMediaIds,association_mismatches:associationMismatches,finding_media_counts:findingRows.map(h=>({index:h.source_index,finding_number:h.finding_number,area:String(h.payload.area||''),media_count:h.media_count})),photo_associations_valid:associationOk},write_ready:false});
  }
  root.TECCHNEXCamInspeccionesExportAdapter=Object.freeze({normalize});
})(typeof window!=='undefined'?window:globalThis);

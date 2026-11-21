/* UI V1.8: prepara y descarga el paquete de operaciones y manifiesto fotográfico, solo local. */
(function(){
 'use strict';
 const panel=document.getElementById('camSyncPanelV1');
 const result=document.getElementById('camSyncImportResultV1');
 if(!panel||!result||!window.TECCHNEXCamInspeccionesSyncPackageV18)return;
 const btn=document.createElement('button');
 btn.type='button';btn.id='camSyncBuildPackageV17';btn.textContent='Preparar paquete V1.8 (solo local)';
 btn.style.cssText='background:#334e68;color:#fff;border:0;border-radius:6px;padding:8px 10px;font-weight:700;cursor:pointer;margin-top:7px;width:100%';
 const out=document.createElement('div');out.id='camSyncPackageStatusV17';out.setAttribute('role','status');out.style.cssText='margin-top:6px;font-size:12px;color:#475569;white-space:pre-line';
 const audit=document.getElementById('camSyncImportJsonV1');
 if(audit&&audit.parentElement){audit.parentElement.appendChild(btn);audit.parentElement.appendChild(out);}
 btn.addEventListener('click',async()=>{
  const report=window.CAM_INSPECCIONES_LAST_EXPORT_AUDIT;
  if(!report){out.textContent='Primero selecciona el JSON y confirma la auditoría V1.6.';out.style.color='#a16207';return;}
  btn.disabled=true;btn.textContent='Preparando paquete…';
  try{
   const pkg=await window.TECCHNEXCamInspeccionesSyncPackageV18.build(report);
   const blob=new Blob([JSON.stringify(pkg,null,2)],{type:'application/json'});
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download=`TECCHNEX_SYNC_PACKAGE_${pkg.source.id_control}_V1_8.json`;
   document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
   out.textContent=`PAQUETE LOCAL PREPARADO\nRegistros: ${pkg.counts.records} (1 inspección, ${pkg.counts.hallazgos} hallazgos, ${pkg.counts.matrices_cliente} matrices cliente, ${pkg.counts.vulnerabilidad} vulnerabilidad)\nManifiesto: ${pkg.counts.photos_manifest} fotografías\nRed: 0 · RPC: 0 · Storage: 0 · Escrituras: 0\nListo para revisión; todavía no está autorizado para envío.`;
   out.style.color='#146d4a';
   window.CAM_INSPECCIONES_SYNC_PACKAGE_V17=pkg;
  }catch(e){out.textContent=e&&e.message?e.message:'No fue posible preparar el paquete.';out.style.color='#a22626';}
  finally{btn.disabled=false;btn.textContent='Preparar paquete V1.8 (solo local)';}
 });
})();

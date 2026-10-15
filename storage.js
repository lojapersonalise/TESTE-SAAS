/* Single-company Firestore storage, shared by the app and the owner migration tool. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OrganiFinStorage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const KEYS=['pedidos','concluidos','colunas','vendas','compras','estoque','clientes'];
 const CONTROL='organifin_config/estado';
 const PAGE_SIZE=250,MAX_WRITES=450;
 const copy=value=>JSON.parse(JSON.stringify(value));
 const empty=()=>Object.fromEntries(KEYS.map(key=>[key,[]]));
 function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
 function failure(code,message){const error=new Error(message);error.code='organifin/'+code;error.userMessage=message;return error;}
 function validateState(state){
  if(!state||Object.keys(state).sort().join(',')!==[...KEYS].sort().join(','))throw failure('invalid','O conjunto de registros não contém as sete categorias esperadas.');
  for(const key of KEYS){
   if(!Array.isArray(state[key]))throw failure('invalid','Formato inválido em '+key+'.');
   const ids=new Set();
   for(const record of state[key]){
    if(!record||Array.isArray(record)||typeof record!=='object'||typeof record.id!=='string'||!record.id||new TextEncoder().encode(record.id).length>512||ids.has(record.id))throw failure('invalid','Há um registro sem identificador válido ou duplicado em '+key+'. Nenhum dado foi alterado.');
    try{if(new TextEncoder().encode(docId(record.id)).length>1500)throw Error();}catch{throw failure('invalid','Há um identificador que não pode ser armazenado em '+key+'. Nenhum dado foi alterado.');}
    ids.add(record.id);
   }
  }
  return state;
 }
 const counts=state=>Object.fromEntries(KEYS.map(key=>[key,state[key].length]));
 const docId=id=>'r_'+encodeURIComponent(id);
 async function digest(state){return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(state))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
 function controlValid(control){return control&&control.schemaVersion===2&&['migrating','ready'].includes(control.status)&&/^[A-Za-z0-9_-]{1,100}$/.test(control.datasetId)&&Number.isSafeInteger(control.revision)&&control.revision>=0&&control.counts&&KEYS.every(key=>Number.isSafeInteger(control.counts[key])&&control.counts[key]>=0);}
 function planRecords(before,after,ranks){
  validateState(after);
  const operations=[],nextRanks={};
  for(const key of KEYS){
   const old=new Map(before[key].map(record=>[record.id,record]));
   const desired=new Set(after[key].map(record=>record.id));
   const existing=after[key].filter(record=>old.has(record.id)).map(record=>record.id);
   const ordered=[...existing].sort((a,b)=>ranks[key].get(a)-ranks[key].get(b));
   const result=new Map();
   const compact=()=>{result.clear();after[key].forEach((record,index)=>result.set(record.id,index*1024));};
   if(canonical(existing)!==canonical(ordered))compact();
   else {
    existing.forEach(id=>result.set(id,ranks[key].get(id)));
    let start=0;
    while(start<after[key].length){
     if(result.has(after[key][start].id)){start++;continue;}
     let end=start;while(end<after[key].length&&!result.has(after[key][end].id))end++;
     const left=start?result.get(after[key][start-1].id):null,right=end<after[key].length?result.get(after[key][end].id):null;
     for(let i=start;i<end;i++){
      const n=i-start+1,length=end-start;
      result.set(after[key][i].id,left===null?(right===null?n*1024:right-(length-n+1)*1024):right===null?left+n*1024:left+(right-left)*n/(length+1));
     }
     start=end;
    }
    const values=after[key].map(record=>result.get(record.id));
    if(values.some((value,i)=>!Number.isFinite(value)||(i>0&&value<=values[i-1])))compact();
   }
   nextRanks[key]=result;
   for(const record of before[key])if(!desired.has(record.id))operations.push({key,id:record.id,remove:true});
   for(const record of after[key])if(!old.has(record.id)||canonical(record)!==canonical(old.get(record.id))||result.get(record.id)!==ranks[key].get(record.id))operations.push({key,id:record.id,registro:copy(record),ordem:result.get(record.id)});
  }
  if(operations.length>MAX_WRITES)throw failure('too-many','Esta ação altera muitos registros de uma vez. Ela foi bloqueada para preservar a gravação completa; solicite uma atualização em lotes controlados.');
  return {operations,ranks:nextRanks};
 }
 function create(db,projectId){
  const controlRef=db.doc(CONTROL),legacyRef=key=>db.collection('banco_personalise').doc(key);
  const records=(dataset,key)=>db.collection('organifin_dados').doc(dataset).collection(key);
  async function info(allowLegacyPermission=true){
   try {const snap=await controlRef.get({source:'server'});if(!snap.exists)return {mode:'legacy',control:null};const control=snap.data();if(!controlValid(control))throw failure('invalid','A configuração do banco é inválida.');return {mode:control.status,control};}
   catch(error){if(allowLegacyPermission&&error.code==='permission-denied')return {mode:'legacy',control:null};throw error;}
  }
  async function readLegacy(){return db.runTransaction(async transaction=>{
   const state=empty();
   for(const key of KEYS){const snap=await transaction.get(legacyRef(key));state[key]=snap.exists?snap.data().lista:[];}
   return validateState(state);
  });}
  async function allRecords(dataset,key){
   const result=[];let cursor=null;
   do {
    let query=records(dataset,key).orderBy('ordem').limit(PAGE_SIZE);
    if(cursor)query=query.startAfter(cursor);
    const snapshot=await query.get({source:'server'});
    snapshot.docs.forEach(doc=>{const value=doc.data();if(!value.registro||doc.id!==docId(value.registro.id)||!Number.isFinite(value.ordem))throw failure('invalid','Há um registro inválido no banco atualizado.');result.push(value);});
    cursor=snapshot.docs.length===PAGE_SIZE?snapshot.docs[snapshot.docs.length-1]:null;
   }while(cursor);
   return result;
  }
  async function readReady(){
   for(let attempt=0;attempt<4;attempt++){
    const initial=await info(false);if(initial.mode!=='ready')throw failure('migration','O banco está sendo atualizado. Aguarde a conclusão e tente novamente.');
    const values=await Promise.all(KEYS.map(key=>allRecords(initial.control.datasetId,key)));
    const latest=await info(false);
    if(latest.mode!=='ready'||latest.control.datasetId!==initial.control.datasetId||latest.control.revision!==initial.control.revision)continue;
    const state=empty(),ranks={};
    KEYS.forEach((key,index)=>{state[key]=values[index].map(value=>value.registro);ranks[key]=new Map(values[index].map(value=>[value.registro.id,value.ordem]));if(state[key].length!==latest.control.counts[key])throw failure('invalid','A contagem de registros não corresponde à configuração do banco.');});
    validateState(state);
    return {mode:'ready',control:latest.control,state,ranks};
   }
   throw failure('busy','Os dados estão mudando em outro dispositivo. Aguarde um instante e tente novamente.');
  }
  async function commit(view,before,after){
   validateState(after);
   if(view.mode==='legacy'){
    const current=await info();if(current.mode!=='legacy')throw failure('migration','O banco está sendo atualizado. Atualize a página antes de salvar.');
    await db.runTransaction(async transaction=>{
     for(const key of KEYS){const snapshot=await transaction.get(legacyRef(key));const actual=snapshot.exists?snapshot.data().lista:[];if(canonical(actual)!==canonical(before[key]))throw failure('conflict','Os dados mudaram em outra aba ou dispositivo. Confira os dados atualizados e tente salvar novamente.');}
     KEYS.filter(key=>canonical(before[key])!==canonical(after[key])).forEach(key=>transaction.set(legacyRef(key),{lista:after[key]}));
    });
    return {mode:'legacy',control:null};
   }
   const plan=planRecords(before,after,view.ranks),revision=view.control.revision+1;
   const control={...view.control,revision,counts:counts(after)};
   try {
   await db.runTransaction(async transaction=>{
    const snapshot=await transaction.get(controlRef),actual=snapshot.exists?snapshot.data():null;
    if(!actual||actual.status!=='ready'||actual.datasetId!==view.control.datasetId||actual.revision!==view.control.revision)throw failure('conflict','Os dados mudaram em outra aba ou dispositivo. Confira os dados atualizados e tente salvar novamente.');
    for(const operation of plan.operations){const ref=records(control.datasetId,operation.key).doc(docId(operation.id));if(operation.remove)transaction.delete(ref);else transaction.set(ref,{registro:operation.registro,ordem:operation.ordem,revisao:revision});}
    transaction.set(controlRef,control);
   });
   } catch(error){
    if(error.code==='permission-denied'){
      let latest;try{latest=await info(false);}catch{throw error;}
      if(latest.mode==='ready'&&latest.control.datasetId===view.control.datasetId&&latest.control.revision!==view.control.revision)throw failure('conflict','Os dados mudaram em outra aba ou dispositivo. Confira os dados atualizados e tente salvar novamente.');
    }
    throw error;
   }
   return {mode:'ready',control,state:copy(after),ranks:plan.ranks};
  }
  function watchReady(onView,onError){
   let stopped=false,running=false,pending=false;
   async function refresh(){
    pending=true;if(running)return;running=true;
    try{while(pending&&!stopped){pending=false;const view=await readReady();if(!stopped)onView(view);}}
    catch(error){if(!stopped)onError(error);}
    finally{running=false;}
   }
   const stop=controlRef.onSnapshot({includeMetadataChanges:true},snapshot=>{if(!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites)void refresh();},onError);
   return ()=>{stopped=true;stop();};
  }
  async function backup(){
   const current=await info();const state=current.mode==='ready'?(await readReady()).state:await readLegacy();
   return {format:'organifin-backup',version:1,schema:current.mode==='ready'?2:1,projectId,exportedAt:new Date().toISOString(),counts:counts(state),source:state,sha256:await digest(state)};
  }
  async function checkBackup(value){
   if(value?.format!=='organifin-backup'||value.version!==1||value.projectId!==projectId||![1,2].includes(value.schema))throw failure('backup','O arquivo não é um backup válido deste projeto.');
   validateState(value.source);
   if(value.sha256!==await digest(value.source)||canonical(value.counts)!==canonical(counts(value.source)))throw failure('backup','O conteúdo ou a contagem do backup não corresponde à verificação de integridade.');
   return copy(value);
  }
  async function beginMigration(value){
   const saved=await checkBackup(value);if(saved.schema!==1)throw failure('backup','A migração inicial exige um backup do banco antigo.');
   const current=await info(false);
   if(current.mode==='migrating'){
    if(current.control.sourceHash!==saved.sha256||canonical(current.control.counts)!==canonical(saved.counts))throw failure('backup','A migração em andamento pertence a outro backup.');
    return current.control;
   }
   if(current.mode!=='legacy')throw failure('migration','O banco já foi atualizado. Não execute a migração novamente.');
   const control={schemaVersion:2,status:'migrating',datasetId:crypto.randomUUID(),revision:0,counts:saved.counts,sourceHash:saved.sha256,projectId,startedAt:new Date().toISOString(),completedAt:null};
   await db.runTransaction(async transaction=>{
    const existing=await transaction.get(controlRef);if(existing.exists)throw failure('conflict','Outra migração foi iniciada. Atualize o diagnóstico.');
    for(const key of KEYS){const snapshot=await transaction.get(legacyRef(key));const actual=snapshot.exists?snapshot.data().lista:[];if(canonical(actual)!==canonical(saved.source[key]))throw failure('backup','Os dados mudaram depois do backup. Exporte e guarde um backup novo antes de migrar.');}
    transaction.set(controlRef,control);
   });
   return control;
  }
  async function copyMigration(control,value,onProgress=()=>{}){
   const saved=await checkBackup(value);
   const current=await info(false);
   if(current.mode!=='migrating'||current.control.datasetId!==control.datasetId||current.control.sourceHash!==saved.sha256)throw failure('migration','A migração não está ativa para este backup.');
   let chunk=[],done=0,total=Object.values(saved.counts).reduce((a,b)=>a+b,0);
   async function flush(){if(!chunk.length)return;const batch=db.batch();chunk.forEach(({key,record,index})=>batch.set(records(control.datasetId,key).doc(docId(record.id)),{registro:record,ordem:index*1024,revisao:0}));await batch.commit();done+=chunk.length;chunk=[];onProgress(done,total);}
   for(const key of KEYS)for(let index=0;index<saved.source[key].length;index++){chunk.push({key,record:saved.source[key][index],index});if(chunk.length===100)await flush();}
   await flush();onProgress(done,total);
  }
  async function finishMigration(control,value){
   const saved=await checkBackup(value),state=empty();
   for(const key of KEYS)state[key]=(await allRecords(control.datasetId,key)).map(row=>row.registro);
   if(await digest(state)!==saved.sha256)throw failure('verification','A cópia não corresponde ao backup. A ativação foi bloqueada; os dados antigos foram preservados.');
   await db.runTransaction(async transaction=>{
    const snapshot=await transaction.get(controlRef),actual=snapshot.exists?snapshot.data():null;
    if(actual?.status!=='migrating'||actual.datasetId!==control.datasetId||actual.sourceHash!==saved.sha256||canonical(actual.counts)!==canonical(saved.counts))throw failure('conflict','O estado da migração mudou. Atualize o diagnóstico.');
    transaction.set(controlRef,{...actual,status:'ready',completedAt:new Date().toISOString()});
   });
   return readReady();
  }
  async function cancelMigration(){await db.runTransaction(async transaction=>{
   const snapshot=await transaction.get(controlRef);if(!snapshot.exists)return;
   if(snapshot.data().status!=='migrating')throw failure('migration','A versão atual já está ativa e não pode ser revertida por este botão.');
   transaction.delete(controlRef);
  });}
  return {info,readLegacy,readReady,commit,watchReady,backup,checkBackup,beginMigration,copyMigration,finishMigration,cancelMigration};
 }
 return {KEYS,CONTROL,PAGE_SIZE,MAX_WRITES,canonical,validateState,counts,docId,digest,planRecords,create};
});

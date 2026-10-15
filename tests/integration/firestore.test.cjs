const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const firebase=require('firebase/compat/app');require('firebase/compat/firestore');
const Storage=require('../../storage.js');
firebase.firestore.setLogLevel('silent');
const OWNER='OJqtwDYPETUWegYndXmSnRiyNXR2',PROJECT='copinha-8292b';
let env;
const empty=()=>Object.fromEntries(Storage.KEYS.map(k=>[k,[]]));
const copy=value=>JSON.parse(JSON.stringify(value));
const store=()=>Storage.create(env.authenticatedContext(OWNER).firestore(),PROJECT);
before(async()=>{
 assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/,'Tests require a local emulator; never use production');
 env=await initializeTestEnvironment({projectId:'demo-organifin',firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync('firestore.rules','utf8')}});
});
after(async()=>{await env?.cleanup();});beforeEach(async()=>{await env.clearFirestore();});
async function seed(state){await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();for(const k of Storage.KEYS)await db.collection('banco_personalise').doc(k).set({lista:state[k]});});}
async function migrate(state=empty()){
 await seed(state);const api=store(),backup=await api.backup(),control=await api.beginMigration(backup);await api.copyMigration(control,backup);const view=await api.finishMigration(control,backup);return {api,backup,control,view};
}

test('rules restrict the legacy database to the owner and the seven exact documents',async()=>{
 const owner=env.authenticatedContext(OWNER).firestore();
 await assertSucceeds(owner.collection('banco_personalise').doc('vendas').set({lista:[]}));
 await assertFails(env.unauthenticatedContext().firestore().collection('banco_personalise').doc('vendas').get());
 await assertFails(env.authenticatedContext('other-user').firestore().collection('banco_personalise').doc('vendas').get());
 await assertFails(owner.collection('banco_personalise').get());
 await assertFails(owner.collection('banco_personalise').doc('other').set({lista:[]}));
 await assertFails(owner.collection('banco_personalise').doc('vendas').delete());
});

test('legacy concurrent transactions reject a stale edit without overwriting the other device',async()=>{
 const state=empty();state.vendas=[{id:'initial',total:1}];await seed(state);
 const a=store(),b=store(),left=copy(state),right=copy(state);left.vendas.unshift({id:'a',total:2});right.vendas.unshift({id:'b',total:3});
 const results=await Promise.allSettled([a.commit({mode:'legacy'},state,left),b.commit({mode:'legacy'},state,right)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.match(results.find(r=>r.status==='rejected').reason.code,/conflict/);
 const latest=await a.readLegacy();assert.equal(latest.vendas.length,2);
 const missing=latest.vendas.some(v=>v.id==='a')?'b':'a',next=copy(latest);next.vendas.unshift({id:missing,total:4});
 await b.commit({mode:'legacy'},latest,next);assert.equal((await a.readLegacy()).vendas.length,3);
});

test('migration preserves original payloads and order, locks old writers and activates only verified data',async()=>{
 const state=empty();state.clientes=[{id:'client',nome:"D'Ávila",email:'a@example.test'}];state.vendas=[{id:'new',total:32.8,extra:{preservado:true}},{id:'old',total:10}];
 await seed(state);const api=store(),backup=await api.backup(),control=await api.beginMigration(backup);
 assert.equal((await api.info()).mode,'migrating');
 const owner=env.authenticatedContext(OWNER).firestore();await assertFails(owner.collection('banco_personalise').doc('vendas').set({lista:[]}));
 await api.copyMigration(control,backup);const view=await api.finishMigration(control,backup);assert.deepEqual(view.state,state);
 assert.deepEqual(await api.readLegacy(),state);assert.equal((await api.info()).mode,'ready');
 await assertFails(owner.collection('banco_personalise').doc('vendas').set({lista:[]}));
 await assert.rejects(api.cancelMigration(),/não pode ser revertida/);
 const updatedBackup=await api.backup();assert.equal(updatedBackup.schema,2);assert.equal(updatedBackup.sha256,backup.sha256);
});

test('damaged backups, other project backups and stale backups cannot freeze or migrate the database',async()=>{
 await seed(empty());const api=store(),backup=await api.backup(),damaged=copy(backup);damaged.source.vendas.push({id:'tampered'});
 await assert.rejects(api.beginMigration(damaged),/integridade/);
 await assert.rejects(api.beginMigration({...backup,projectId:'another-project'}),/backup válido/);
 const owner=env.authenticatedContext(OWNER).firestore();await owner.collection('banco_personalise').doc('vendas').set({lista:[{id:'later'}]});
 await assert.rejects(api.beginMigration(backup),/mudaram depois do backup/);assert.equal((await api.info()).mode,'legacy');
});

test('interrupted migration resumes idempotently with the same backup',async()=>{
 const state=empty();state.clientes=Array.from({length:215},(_,i)=>({id:'c'+i,nome:'Cliente '+i}));await seed(state);
 const api=store(),backup=await api.backup(),control=await api.beginMigration(backup);
 await assert.rejects(api.copyMigration(control,backup,()=>{throw Error('simulated interruption');}),/simulated/);
 assert.equal((await api.info()).mode,'migrating');
 const resumed=await api.beginMigration(backup);assert.equal(resumed.datasetId,control.datasetId);
 await api.copyMigration(resumed,backup);const view=await api.finishMigration(resumed,backup);assert.deepEqual(view.state,state);
});

test('incomplete or altered copies cannot activate; recopy repairs interrupted payloads',async()=>{
 const state=empty();state.estoque=[{id:'e',qtd:5}];await seed(state);const api=store(),backup=await api.backup(),control=await api.beginMigration(backup);
 await assert.rejects(api.finishMigration(control,backup),/não corresponde/);
 await api.copyMigration(control,backup);
 const owner=env.authenticatedContext(OWNER).firestore();await owner.collection('organifin_dados').doc(control.datasetId).collection('estoque').doc(Storage.docId('e')).set({registro:{id:'e',qtd:999},ordem:0,revisao:0});
 await assert.rejects(api.finishMigration(control,backup),/não corresponde/);assert.equal((await api.info()).mode,'migrating');
 await api.copyMigration(control,backup);assert.equal((await api.finishMigration(control,backup)).state.estoque[0].qtd,5);
});

test('canceling an incomplete migration reopens unchanged legacy data and fences the abandoned copy',async()=>{
 const state=empty();state.clientes=[{id:'c',nome:'Nome'}];await seed(state);const api=store(),backup=await api.backup(),control=await api.beginMigration(backup);await api.copyMigration(control,backup);
 await api.cancelMigration();assert.equal((await api.info()).mode,'legacy');assert.deepEqual(await api.readLegacy(),state);
 const owner=env.authenticatedContext(OWNER).firestore();await assertSucceeds(owner.collection('banco_personalise').doc('vendas').set({lista:[]}));
 await assertFails(owner.collection('organifin_dados').doc(control.datasetId).collection('clientes').get());
 const replacement=await api.beginMigration(backup);assert.notEqual(replacement.datasetId,control.datasetId);
});

test('two updated devices cannot lose a sale or overdraw the same stock',async()=>{
 const state=empty();state.estoque=[{id:'e',qtd:5}];const {api}=await migrate(state);const other=store(),a=await api.readReady(),b=await other.readReady(),left=copy(a.state),right=copy(b.state);
 left.estoque[0].qtd=1;left.vendas.push({id:'left',total:4});right.estoque[0].qtd=1;right.vendas.push({id:'right',total:4});
 const results=await Promise.allSettled([api.commit(a,a.state,left),other.commit(b,b.state,right)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.code,/conflict/);
 const latest=await api.readReady();assert.equal(latest.state.estoque[0].qtd,1);assert.equal(latest.state.vendas.length,1);
});

test('rules require a revision advance and reject an invalid partial transaction atomically',async()=>{
 const {api,view}=await migrate();const db=env.authenticatedContext(OWNER).firestore(),ref=db.collection('organifin_dados').doc(view.control.datasetId).collection('vendas').doc(Storage.docId('v'));
 await assertFails(ref.set({registro:{id:'v'},ordem:0,revisao:1}));
 await assertFails(db.runTransaction(async tx=>{
  const controlRef=db.doc(Storage.CONTROL),snapshot=await tx.get(controlRef);
  tx.set(controlRef,{...snapshot.data(),revision:1,counts:{...snapshot.data().counts,vendas:1}});
  tx.set(ref,{registro:{id:'v'},ordem:'invalid',revisao:1});
 }));
 const latest=await api.readReady();assert.equal(latest.control.revision,0);assert.equal(latest.state.vendas.length,0);
 const outsider=env.authenticatedContext('outsider').firestore();await assertFails(outsider.doc(Storage.CONTROL).get());await assertFails(outsider.collection('organifin_dados').doc(view.control.datasetId).collection('vendas').get());
 await assertFails(db.doc(Storage.CONTROL).update({status:'migrating'}));
});

test('individual records can grow past one MiB in aggregate and prepend without rewriting history',async()=>{
 const {api}=await migrate();let view=await api.readReady();
 for(let batch=0;batch<4;batch++){
  const after=copy(view.state);for(let i=0;i<350;i++)after.vendas.push({id:'v'+(batch*350+i),total:1,descricao:'x'.repeat(1000)});
  view=await api.commit(view,view.state,after);
 }
 assert.ok(Buffer.byteLength(JSON.stringify(view.state.vendas))>1024*1024);
 view=await api.readReady();assert.equal(view.state.vendas.length,1400);
 const after=copy(view.state);after.vendas.unshift({id:'newest',total:1});const plan=Storage.planRecords(view.state,after,view.ranks);assert.equal(plan.operations.length,1);
 await api.commit(view,view.state,after);const latest=await api.readReady();assert.equal(latest.state.vendas.length,1401);assert.equal(latest.state.vendas[0].id,'newest');
});

test('consistent reads retry if a different device commits between collection reads and revision verification',async()=>{
 const {api}=await migrate();const view=await api.readReady(),next=copy(view.state);next.clientes.push({id:'late',nome:'Novo'});
 const db=env.authenticatedContext(OWNER).firestore();let reads=0;
 const wrapped={collection:db.collection.bind(db),doc(path){const ref=db.doc(path);return {async get(options){if(++reads===2)await api.commit(view,view.state,next);return ref.get(options);}};}};
 const observed=await Storage.create(wrapped,PROJECT).readReady();assert.equal(observed.control.revision,1);assert.equal(observed.state.clientes[0].id,'late');assert.ok(reads>=4);
});

async function browserPage(t,entry){
 const http=require('node:http'),path=require('node:path'),{chromium}=require('playwright');const root=path.resolve(__dirname,'../..');
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)||name.startsWith('.')){res.writeHead(403).end();return;}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'text/plain');res.end(data);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});const page=await browser.newPage();const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',route=>{external.push(route.request().url());return route.abort();});
 const prefix=`const realFirebase=firebase;const uiAuth={currentUser:{uid:${JSON.stringify(OWNER)}},onAuthStateChanged(cb){this.cb=cb;setTimeout(()=>cb(this.currentUser),0)},async signOut(){this.currentUser=null;this.cb(null);}};window.firebase={initializeApp(config){const app=realFirebase.initializeApp({...config,projectId:'demo-organifin'});realFirebase.firestore().useEmulator('127.0.0.1',8080,{mockUserToken:{sub:${JSON.stringify(OWNER)}}});return app;},firestore:()=>realFirebase.firestore(),auth:()=>uiAuth};\n`;
 await page.route('**/'+entry+'.js**',route=>route.fulfill({contentType:'application/javascript',body:prefix+fs.readFileSync(path.join(root,entry+'.js'),'utf8')}));
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);assert.deepEqual(external,[],'No production network requests');});
 await page.goto('http://127.0.0.1:'+server.address().port+'/'+(entry==='app'?'index.html':'migracao.html'),{waitUntil:'domcontentloaded'});return page;
}

test('updated app reads the migrated data and saves one individual document using the real browser SDK',async t=>{
 const initial=empty();initial.clientes=[{id:'c',nome:'Cliente de teste',email:'teste@example.test'}];const {api}=await migrate(initial);
 const page=await browserPage(t,'app');await page.waitForFunction(()=>sessionReady&&storageView.mode==='ready');
 await page.evaluate(async()=>{goTo(2);document.getElementById('vp').value='Serviço de teste';document.getElementById('vq').value='1';document.getElementById('vu').value='25';document.getElementById('vpg').value='PIX';await salvarV();});
 const data=await api.readReady();assert.equal(data.state.vendas.length,1);assert.equal(data.state.vendas[0].total,25);assert.equal(data.control.revision,1);
 assert.equal(await page.locator('#vp').inputValue(),'');assert.match(await page.locator('#toast').textContent(),/Venda salva/);
 // A second commit may arrive before the first device receives its own ack.
 await page.evaluate(async()=>{
  const original=storage.commit;
  storage.commit=async(...args)=>{
   const result=await original(...args),other=OrganiFinStorage.create(fbDB,FIREBASE_CONFIG.projectId),fresh=await other.readReady(),next=clone(fresh.state);
   next.vendas.push({id:'other-device',cliente:'',produto:'Outra venda',total:10,data:hj()});await other.commit(fresh,fresh.state,next);
   const deadline=Date.now()+5000;while(storageView.control.revision<result.control.revision+1){if(Date.now()>deadline)throw Error('Newer snapshot did not arrive');await new Promise(resolve=>setTimeout(resolve,20));}
   return result;
  };
  document.getElementById('vp').value='Venda com resposta atrasada';document.getElementById('vu').value='10';await salvarV();storage.commit=original;
 });
 assert.equal(await page.evaluate(()=>MEM[K.v].length),3);assert.equal(await page.evaluate(()=>storageView.control.revision),3);
 await page.evaluate(()=>fazerLogout());assert.equal(await page.evaluate(()=>MEM[K.v].length),0);assert.equal(await page.evaluate(()=>storageView.state),undefined);
});

test('owner migration page exports, accepts the saved backup and activates the verified copy',async t=>{
 const state=empty();state.clientes=[{id:'owner-browser',nome:'Cliente de teste'}];state.estoque=[{id:'item',nome:'Item',qtd:3}];await seed(state);
 const page=await browserPage(t,'migracao');await page.waitForFunction(()=>document.getElementById('migration-status').textContent.includes('Regras acessíveis'));
 const waiting=page.waitForEvent('download');await page.click('#migration-export');const download=await waiting;
 const file=await download.path(),value=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(value.source,state);
 await page.setInputFiles('#migration-file',file);await page.waitForFunction(()=>document.getElementById('migration-status').textContent.includes('Backup íntegro'));
 await page.check('#migration-confirm');await page.click('#migration-run');await page.waitForFunction(()=>document.getElementById('migration-status').textContent.includes('Atualização concluída'));
 assert.deepEqual((await store().readReady()).state,state);assert.deepEqual(await store().readLegacy(),state);
});


test('the upgraded application can still write safely under the previously published legacy-only rules',async()=>{
 const legacyRules=`rules_version = '2';service cloud.firestore {match /databases/{database}/documents {match /banco_personalise/{key} {allow get,create,update: if request.auth.uid == '${OWNER}' && key in ['pedidos','concluidos','colunas','vendas','compras','estoque','clientes'];}}}`;
 const legacy=await initializeTestEnvironment({projectId:'demo-organifin-old-rules',firestore:{host:'127.0.0.1',port:8080,rules:legacyRules}});
 try{const api=Storage.create(legacy.authenticatedContext(OWNER).firestore(),PROJECT);assert.equal((await api.info()).mode,'legacy');const before=await api.readLegacy(),after=copy(before);after.vendas.push({id:'legacy-safe',total:10});await api.commit({mode:'legacy'},before,after);assert.equal((await api.readLegacy()).vendas[0].id,'legacy-safe');}finally{await legacy.cleanup();}
});

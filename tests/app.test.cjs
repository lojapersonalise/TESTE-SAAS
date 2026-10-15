const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
let browser,server,base;
before(async()=>{
 server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative=pathname==='/'?'index.html':pathname.slice(1);
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||relative.split('/').some(p=>p.startsWith('.'))){res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{
   if(error){res.writeHead(404).end();return;}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(data);
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
const client=(id,name='Cliente',extra={})=>({id,nome:name,tel:'11999999999',cidade:'',email:'',...extra});
const order=(id,extra={})=>({id,cliente:'Cliente',clienteId:'c1',desc:'Serviço',valor:100,sinal:0,pago:true,entregue:false,colId:'c0',data:'2026-10-15',sinalVId:null,restVId:null,...extra});
async function fixture(t,seed={},loggedOut=false){
 const context=await browser.newContext();const page=await context.newPage();const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',route=>{external.push(route.request().url());return route.abort();});
 await page.addInitScript(({seed,loggedOut})=>{window.__seed=seed;window.__loggedOut=loggedOut;},{seed,loggedOut});
 await page.addInitScript({path:path.join(__dirname,'firebase-double.js')});
 await page.route('**/app.js**',route=>route.fulfill({contentType:'application/javascript',body:'window.firebase=window.__fake.firebase;\n'+fs.readFileSync(path.join(root,'app.js'),'utf8')}));
 await page.goto(base,{waitUntil:'networkidle'});
 if(!loggedOut)await page.waitForFunction(()=>sessionReady);
 t.after(async()=>{await context.close();assert.deepEqual(errors,[],'Uncaught browser errors');assert.deepEqual(external,[],'Unexpected external request');});
 return page;
}
async function confirm(page){await page.locator('#cfo').click();await page.waitForFunction(()=>!saving);}
async function seedSaleForm(page,method='PIX'){
 await page.evaluate(method=>{goTo(2);document.getElementById('vp').value='Serviço';document.getElementById('vq').value='1';document.getElementById('vu').value='100';document.getElementById('vpg').value=method;calcV();},method);
}

test('untrusted record data is text in every renderer, including IDs and apostrophes',async t=>{
 const payload=`D'Ávila <img src=x onerror="window.__executed=true">`;
 const id=`id\" onclick=\"window.__executed=true`;
 const page=await fixture(t,{clientes:{lista:[client(id,payload,{cidade:payload,email:payload,tel:payload})]},pedidos:{lista:[order('p',{cliente:payload,clienteId:id,desc:payload,tel:payload})]},estoque:{lista:[{id,nome:payload,categoria:payload,qtd:1,min:0,preco:10,custo:5}]},vendas:{lista:[{id,cliente:payload,produto:payload,categoria:payload,qtd:1,total:10,pgto:payload,data:'2026-10-15'}]},compras:{lista:[{id,fornecedor:payload,categoria:payload,valor:10,pgto:payload,data:'2026-10-15'}]},concluidos:{lista:[{id,cliente:payload,desc:payload,valor:10,dataConc:'2026-10-15'}]},colunas:{lista:[{id:'c0',nome:payload,fixa:true}]}});
 await page.evaluate(()=>{for(let i=0;i<7;i++)goTo(i);abrModal('p');});
 assert.equal(await page.locator('#mpif img').count(),0);
 assert.equal(await page.locator('#tbcl').innerText().then(s=>s.includes(payload)),true);
 await page.evaluate(()=>CM('mped'));
 await page.evaluate(()=>goTo(5));
 await page.locator('[data-action="client-history"]').click();
 assert.equal(await page.locator('#tbhc tr').count(),2);
 assert.equal(await page.evaluate(()=>Boolean(window.__executed)),false);
 assert.equal(await page.locator('#app-container [onclick*="__executed"]').count(),0);
});

test('success and form clearing wait for server acknowledgement; repeat clicks are blocked',async t=>{
 const page=await fixture(t);await seedSaleForm(page);
 await page.evaluate(()=>{window.__fake.hold=true;window.__pending=salvarV();});
 assert.equal(await page.locator('#vp').inputValue(),'Serviço');
 assert.equal(await page.locator('#save-status').isVisible(),true);
 assert.equal(await page.evaluate(()=>MEM[K.v].length),0);
 await page.evaluate(()=>salvarV());
 assert.equal(await page.evaluate(()=>window.__fake.attempts.length),1);
 await page.evaluate(()=>{window.__fake.release();return window.__pending;});
 assert.equal(await page.evaluate(()=>MEM[K.v].length),1);
 assert.equal(await page.locator('#vp').inputValue(),'');
 assert.match(await page.locator('#toast').textContent(),/Venda salva/);
});

test('rejected writes retain form fields and confirmed memory; retry succeeds',async t=>{
 const page=await fixture(t);
 await page.evaluate(async()=>{goTo(3);document.getElementById('cf').value='Aluguel';document.getElementById('cv').value='100';window.__fake.failNext=true;await salvarC();});
 assert.equal(await page.locator('#cf').inputValue(),'Aluguel');assert.equal(await page.evaluate(()=>MEM[K.c].length),0);
 assert.match(await page.locator('#toast').textContent(),/Não foi possível salvar/);
 assert.equal(await page.locator('#save-status').isVisible(),false);
 await page.evaluate(()=>salvarC());assert.equal(await page.evaluate(()=>MEM[K.c].length),1);
});

test('offline writes are rejected without clearing inputs or enqueuing a save',async t=>{
 const page=await fixture(t);await seedSaleForm(page);await page.context().setOffline(true);
 assert.equal(await page.evaluate(()=>salvarV()),false);
 assert.equal(await page.evaluate(()=>window.__fake.attempts.length),0);assert.equal(await page.locator('#vp').inputValue(),'Serviço');
});

test('invalid quantities, negative amounts, excessive deposits and invalid email are rejected',async t=>{
 const page=await fixture(t);
 const checks=await page.evaluate(async()=>{
  const result=[];const set=(id,value)=>document.getElementById(id).value=value;
  set('en','Item');set('eq','-5');await salvarE();result.push(MEM[K.e].length);
  set('eq','1.5');await salvarE();result.push(MEM[K.e].length);
  set('cf','Despesa');set('cv','-1');await salvarC();result.push(MEM[K.c].length);
  set('ifc','Pessoa');set('ifd','Pedido');set('ifv','100');set('ifs','101');await addCard();result.push(MEM[K.p].length);
  set('vp','Produto');set('vq','0');set('vu','10');await salvarV();result.push(MEM[K.v].length);
  set('vq','1');set('vu','1.001');await salvarV();result.push(MEM[K.v].length);
  set('cln','Pessoa');set('cle','invalid');await salvarCl();result.push(MEM[K.cl].length);
  return result;
 });assert.deepEqual(checks,[0,0,0,0,0,0,0]);assert.equal(await page.evaluate(()=>window.__fake.attempts.length),0);
});

test('insufficient stock prevents completion before any receipt or inventory write',async t=>{
 const page=await fixture(t,{pedidos:{lista:[order('p',{pago:false})]},estoque:{lista:[{id:'e',nome:'Item',qtd:2}]}});
 await page.evaluate(async()=>{actPed='p';abrirLV();document.getElementById('lvest').value='e';document.getElementById('lvq').value='5';await confLV();});
 assert.equal(await page.evaluate(()=>MEM[K.e][0].qtd),2);assert.equal(await page.evaluate(()=>MEM[K.v].length),0);
 assert.equal(await page.evaluate(()=>MEM[K.p].length),1);assert.match(await page.locator('#toast').textContent(),/Estoque insuficiente/);
});

test('completion and undo restore exactly the amount deducted, including zero legacy quantities',async t=>{
 const page=await fixture(t,{pedidos:{lista:[order('p')]},estoque:{lista:[{id:'e',nome:'Item',qtd:5}]}});
 await page.evaluate(async()=>{actPed='p';abrirLV();document.getElementById('lvest').value='e';document.getElementById('lvq').value='2';await confLV();window.__completed=MEM[K.co][0].id;});
 assert.equal(await page.evaluate(()=>MEM[K.e][0].qtd),3);
 await page.evaluate(()=>desfazerConc(window.__completed));await confirm(page);
 assert.equal(await page.evaluate(()=>MEM[K.e][0].qtd),5);assert.equal(await page.evaluate(()=>MEM[K.co].length),0);
 await page.evaluate(async()=>{await alterar(state=>{state[K.co].push({id:'legacy',cliente:'Pessoa',valor:0,estId:'e',qtdEst:0,dataConc:hj()});});desfazerConc('legacy');});await confirm(page);
 assert.equal(await page.evaluate(()=>MEM[K.e][0].qtd),5);
});

test('failed completion changes neither orders nor inventory',async t=>{
 const page=await fixture(t,{pedidos:{lista:[order('p')]},estoque:{lista:[{id:'e',nome:'Item',qtd:5}]}});
 await page.evaluate(async()=>{actPed='p';abrirLV();document.getElementById('lvest').value='e';document.getElementById('lvq').value='2';window.__fake.failNext=true;await confLV();});
 assert.equal(await page.evaluate(()=>MEM[K.e][0].qtd),5);assert.equal(await page.evaluate(()=>MEM[K.p].length),1);assert.equal(await page.evaluate(()=>MEM[K.co].length),0);
 assert.equal(await page.locator('#mlv').isVisible(),true);
});

test('deleting linked receipts updates open and archived orders and restored copies',async t=>{
 const archived=order('archived',{sinal:20,pago:true,sinalVId:'deposit',restVId:'remaining'});
 const page=await fixture(t,{pedidos:{lista:[order('open',{sinal:20,sinalVId:'deposit',restVId:'remaining'})]},concluidos:{lista:[{id:'c',cliente:'Cliente',valor:100,sinalVId:'deposit',restVId:'remaining',pedOriginal:archived,dataConc:'2026-10-15'}]},vendas:{lista:[{id:'deposit',total:20},{id:'remaining',total:80}]}});
 await page.evaluate(()=>delV('deposit'));await confirm(page);
 assert.deepEqual(await page.evaluate(()=>[MEM[K.p][0].sinal,MEM[K.p][0].pago,MEM[K.co][0].pedOriginal.sinal,MEM[K.co][0].pedOriginal.pago]),[0,false,0,false]);
 await page.evaluate(()=>delV('remaining'));await confirm(page);
 await page.evaluate(()=>desfazerConc('c'));await confirm(page);
 assert.deepEqual(await page.evaluate(()=>{const p=MEM[K.p].find(p=>p.id==='archived');return [p.sinalVId,p.restVId,p.pago];}),[null,null,false]);
});

test('currency is rounded per posting and report amounts match visible sale totals',async t=>{
 const page=await fixture(t);
 const values=await page.evaluate(async()=>{
  const net=calcLiq(33.33,'Débito');
  await alterar(state=>{state[K.v]=[1,2,3].map(i=>({id:String(i),produto:'Venda',cliente:'',qtd:1,total:net,totalBruto:33.33,pgto:'Débito',data:hj()}));});
  buildDash();goTo(6);return {net,dashboard:document.getElementById('dv').textContent,report:document.getElementById('rrv').textContent,cells:document.querySelector('#tbrv tr').children.length,payment:document.querySelector('#tbrv tr').children[3].textContent};
 });assert.deepEqual(values,{net:32.8,dashboard:'R$ 98,40',report:'R$ 98,40',cells:5,payment:'Débito'});
});

test('client email is stored and duplicate names have separate histories',async t=>{
 const page=await fixture(t,{clientes:{lista:[client('first','Pessoa')]},pedidos:{lista:[order('legacy',{cliente:'Pessoa',clienteId:null})]}});
 await page.evaluate(async()=>{document.getElementById('cln').value='Pessoa';document.getElementById('cle').value='pessoa@example.test';await salvarCl();});
 const second=await page.evaluate(()=>MEM[K.cl][0].id);
 assert.equal(await page.evaluate(()=>MEM[K.cl][0].email),'pessoa@example.test');
 assert.equal(await page.evaluate(()=>MEM[K.p][0].clienteId),'first');
 await page.evaluate(async id=>{document.getElementById('ifcliente-id').value=id;escolherCliente('if',id);document.getElementById('ifd').value='Pedido novo';document.getElementById('ifv').value='10';await addCard();},second);
 await page.evaluate(id=>verHist(id),second);assert.equal(await page.locator('#tbhc tr').count(),1);assert.match(await page.locator('#tbhc').innerText(),/Pedido novo/);
 await page.evaluate(()=>verHist('first'));assert.equal(await page.locator('#tbhc tr').count(),1);assert.match(await page.locator('#tbhc').innerText(),/Serviço/);
});

test('ambiguous legacy history is not assigned to either homonym',async t=>{
 const page=await fixture(t,{clientes:{lista:[client('a','Pessoa'),client('b','Pessoa')]},pedidos:{lista:[order('old',{cliente:'Pessoa',clienteId:null})]}});
 await page.evaluate(()=>verHist('a'));assert.equal(await page.locator('#history-warning').isVisible(),true);assert.match(await page.locator('#tbhc').innerText(),/Nenhum pedido/);
});

test('logout clears private fields and listeners; login starts exactly seven subscriptions',async t=>{
 const page=await fixture(t,{clientes:{lista:[client('private','Dado privado')]},pedidos:{lista:[order('p')]}});
 await page.evaluate(()=>{goTo(5);verHist('private');document.getElementById('log-pass').value='private password';});
 await page.evaluate(()=>fazerLogout());
 assert.equal(await page.evaluate(()=>document.body.textContent.includes('Dado privado')),false);
 assert.deepEqual(await page.evaluate(()=>({listeners:window.__fake.listeners(),clients:MEM[K.cl].length,password:document.getElementById('log-pass').value,rows:document.getElementById('tbcl').children.length})),{listeners:0,clients:0,password:'',rows:0});
 await page.evaluate(()=>window.__fake.signIn('second-user'));await page.waitForFunction(()=>sessionReady);
 assert.equal(await page.evaluate(()=>window.__fake.listeners()),7);assert.equal(await page.locator('#loader').evaluate(el=>el.classList.contains('off')),true);
 await page.evaluate(()=>iniciarApp());await page.waitForFunction(()=>sessionReady);assert.equal(await page.evaluate(()=>window.__fake.listeners()),7);
});

test('stale session acknowledgement cannot repopulate data after logout',async t=>{
 const page=await fixture(t);await seedSaleForm(page);
 await page.evaluate(()=>{window.__fake.hold=true;window.__pending=salvarV();});
 await page.evaluate(()=>window.__fake.signOut());
 await page.evaluate(()=>{window.__fake.release();return window.__pending;});
 assert.equal(await page.evaluate(()=>MEM[K.v].length),0);assert.equal(await page.locator('#login-screen').isVisible(),true);
});

test('password reset validates email, handles missing users neutrally and reports failures',async t=>{
 const page=await fixture(t,{},true);
 await page.evaluate(()=>recuperarSenha());assert.equal(await page.evaluate(()=>window.__fake.resetRequests.length),0);
 await page.fill('#log-email','user@example.test');await page.click('#reset-password');
 await page.waitForFunction(()=>document.getElementById('login-feedback').textContent.length>0);
 const message=await page.locator('#login-feedback').textContent();
 await page.evaluate(()=>window.__fake.resetError='auth/user-not-found');await page.click('#reset-password');await page.waitForFunction(()=>!document.getElementById('reset-password').disabled);
 assert.equal(await page.locator('#login-feedback').textContent(),message);
 await page.evaluate(()=>window.__fake.resetError='auth/network-request-failed');await page.click('#reset-password');await page.waitForFunction(()=>!document.getElementById('reset-password').disabled);
 assert.match(await page.locator('#login-error').textContent(),/Não foi possível enviar/);
});

test('local library files match pinned SHA-384 hashes and HTML integrity attributes',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/manifest.json')));
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.equal(manifest.length,5);assert.equal(html.includes('@latest'),false);
 for(const item of manifest){const hash='sha384-'+crypto.createHash('sha384').update(fs.readFileSync(path.join(root,'vendor',item.file))).digest('base64');assert.equal(hash,item.integrity);assert.ok(html.includes(`src="vendor/${item.file}" integrity="${hash}"`));}
});


test('seven screens and forms remain usable at desktop and mobile widths',async t=>{
 const page=await fixture(t,{clientes:{lista:[client('c1')]},pedidos:{lista:[order('p')]}});
 for(const width of [1366,390]){
  await page.setViewportSize({width,height:900});
  await page.mouse.move(width-5,5);
  for(let n=0;n<7;n++){
   await page.evaluate(n=>goTo(n),n);
   await page.locator('#p'+n).waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow on page '+n+' at '+width);
  }
  await page.evaluate(()=>{goTo(1);OM('mnp');});
  assert.equal(await page.locator('#ifcliente-id').isVisible(),true);
  await page.evaluate(()=>CM('mnp'));
 }
});


test('unverifiable legacy stock deductions cannot inflate inventory on undo',async t=>{
 const page=await fixture(t,{estoque:{lista:[{id:'e',nome:'Item',qtd:0}]},concluidos:{lista:[{id:'old',cliente:'Cliente',valor:0,estId:'e',qtdEst:5,pedOriginal:order('p'),dataConc:'2026-10-15'}]}});
 await page.evaluate(()=>desfazerConc('old'));await confirm(page);
 assert.equal(await page.evaluate(()=>MEM[K.e][0].qtd),0);
 assert.equal(await page.evaluate(()=>MEM[K.co].length),1);
 assert.equal(await page.evaluate(()=>MEM[K.p].length),0);
 assert.match(await page.locator('#toast').textContent(),/não possui comprovação/);
});

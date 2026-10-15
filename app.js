// =========================================================================
// 🎨 INICIALIZADOR DE TEMA E CONFIGURAÇÕES DINÂMICAS DO HTML
// =========================================================================
function initThemeAndConfig() {
  const root = document.documentElement;
  root.style.setProperty('--p', APP_CONFIG.tema.p);
  root.style.setProperty('--pd', APP_CONFIG.tema.pd);
  root.style.setProperty('--pl', APP_CONFIG.tema.pl);
  root.style.setProperty('--px', APP_CONFIG.tema.px);
  root.style.setProperty('--bg', APP_CONFIG.tema.bg);
  root.style.setProperty('--bor', APP_CONFIG.tema.bor);
  root.style.setProperty('--accent', APP_CONFIG.tema.accent);
  document.title = APP_CONFIG.nome_sistema;

  const setOpts = (id, arr) => { const el = document.getElementById(id); if(el) el.innerHTML = arr.map(i => `<option>${esc(i)}</option>`).join(''); };
  
  // Injeta "Ajuste de caixa" nas Vendas
  let vcatOpts = APP_CONFIG.categorias_vendas.map(i => `<option>${esc(i)}</option>`).join('');
  vcatOpts += `<option style="color:var(--in); font-weight:bold;">Ajuste de caixa</option>`;
  const elVcat = document.getElementById('vcat');
  if(elVcat) elVcat.innerHTML = vcatOpts;

  setOpts('ecat', APP_CONFIG.categorias_estoque);
  
  // Injeta "Ajuste de caixa", "Retirada" e "Pró-labore" nas Compras
  let ccatOpts = APP_CONFIG.categorias_despesas.map(i => `<option>${esc(i)}</option>`).join('');
  ccatOpts += `<option style="color:var(--wa); font-weight:bold;">Retirada Pessoal</option><option style="color:var(--wa); font-weight:bold;">Pró-labore</option><option style="color:var(--in); font-weight:bold;">Ajuste de caixa</option>`;
  const elCcat = document.getElementById('ccat');
  if(elCcat) elCcat.innerHTML = ccatOpts;
  
  setOpts('vpg', APP_CONFIG.pagamentos_vendas);
  const pgSinal = APP_CONFIG.pagamentos_vendas.filter(p => p !== 'Fiado');
  setOpts('ifspg', pgSinal);
  setOpts('epspg', pgSinal);
  setOpts('mppg_met', pgSinal);
  
  setOpts('cpg', APP_CONFIG.pagamentos_compras);
}

initThemeAndConfig();

// =========================================================================
// 🚀 INÍCIO DO SISTEMA (LÓGICA E BANCO DE DADOS)
// =========================================================================
firebase.initializeApp(FIREBASE_CONFIG);
const fbDB = firebase.firestore();
const auth = firebase.auth();

// Authentication, session lifetime and confirmed writes. The existing document
// layout is retained; this is not a multi-company authorization boundary.
const K = {p:'pedidos', co:'concluidos', col:'colunas', v:'vendas', c:'compras', e:'estoque', cl:'clientes'};
const emptyStore = () => Object.fromEntries(Object.values(K).map(k => [k, []]));
const clone = value => JSON.parse(JSON.stringify(value));
const defaultColumns = () => [{id:'c0',nome:'Novo Pedido',fixa:true}, {id:'c1',nome:'Em andamento',fixa:false}];
let MEM = emptyStore();
const DB = {get: key => MEM[key] || []};
const ITEMS_PER_PAGE = 5;
let cp = {co:1,v:1,c:1,e:1,cl:1,r:1};
let activeFilter = null, kbQ = '';
let subscriptions = [], sessionVersion = 0, sessionReady = false;
let saving = null, controlsBeforeSave = [];
let firstLoad = true;

function loading(message, failed = false) {
  document.getElementById('loader-text').textContent = message;
  document.getElementById('loader-actions').hidden = !failed;
  document.getElementById('loader').classList.remove('off');
}
function setSaving(active) {
  if (active) {
    controlsBeforeSave = [...document.querySelectorAll('#app-container button,#app-container input,#app-container select,#app-container textarea,.mo button,.mo input,.mo select,.mo textarea')].map(el => [el, el.disabled]);
    controlsBeforeSave.forEach(([el]) => {el.disabled = true;});
  } else {
    controlsBeforeSave.forEach(([el, disabled]) => {el.disabled = disabled;});
    controlsBeforeSave = [];
  }
  document.getElementById('save-status').hidden = !active;
}
function clearSession() {
  sessionVersion++;
  subscriptions.forEach(unsubscribe => unsubscribe());
  subscriptions = [];
  sessionReady = false;
  firstLoad = true;
  saving = null;
  setSaving(false);
  MEM = emptyStore();
  cp = {co:1,v:1,c:1,e:1,cl:1,r:1};
  activeFilter = null; kbQ = ''; actPed = null; edColId = null;
  Object.values(CHS).forEach(chart => chart.destroy()); CHS = {};
  document.querySelectorAll('.mo').forEach(el => el.classList.remove('on'));
  document.querySelectorAll('input,textarea').forEach(el => {el.value = ''; if(el.type === 'checkbox') el.checked = false;});
  destroyBoardSortables();
  ['kb','tbc','tbv','tbc2','tbe','tbcl','tbhc','tbrv','mpif','alerts','vcl','ifcl'].forEach(id => document.getElementById(id).replaceChildren());
  document.querySelectorAll('.vl,.fi p').forEach(el => {el.textContent = '–';});
  ['mhctt','dsr-ant','dsr-mes','cxeq','cxsq','cxmq','dvq','ddinq'].forEach(id=>document.getElementById(id).textContent='');
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-feedback').textContent = '';
  document.getElementById('toast').classList.remove('on');
  updDL();
}
function iniciarApp() {
  const user = auth.currentUser;
  clearSession();
  if (!user) return;
  const version = sessionVersion;
  const loaded = new Set();
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'none';
  loading('Conectando e sincronizando...');
  Object.values(K).forEach(key => {
    const unsubscribe = fbDB.collection('banco_personalise').doc(key).onSnapshot({includeMetadataChanges:true}, snapshot => {
      if (version !== sessionVersion) return;
      if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
      const data = snapshot.exists ? snapshot.data().lista : (key === K.col ? defaultColumns() : []);
      if (!Array.isArray(data) || data.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
        sessionReady = false; firstLoad = true; loaded.delete(key);
        loading('Há dados em formato inválido. O carregamento foi interrompido para proteger os registros.', true);
        return;
      }
      MEM[key] = clone(data);
      loaded.add(key);
      if (loaded.size === Object.keys(K).length && firstLoad) {
        firstLoad = false; sessionReady = true;
        document.getElementById('app-container').style.display = 'block';
        document.getElementById('loader').classList.add('off');
        document.getElementById('vq').value = '1';
        document.getElementById('eq').value = '0';
        document.getElementById('em').value = '5';
        document.getElementById('vd').value = hj();
        document.getElementById('cd').value = hj();
        goTo(1); initDragToScroll();
      } else if (sessionReady && !saving) atualizarTelaAtual();
    }, error => {
      if (version !== sessionVersion) return;
      sessionReady = false;
      loading(error.code === 'permission-denied' ? 'Sem permissão para acessar os dados deste usuário.' : 'Não foi possível sincronizar os dados. Verifique a conexão e tente novamente.', true);
    });
    subscriptions.push(unsubscribe);
  });
}
async function alterar(mutator, message = 'Salvo na nuvem.', after = () => {}) {
  if (saving) {toast('Aguarde o salvamento em andamento.', true); return false;}
  if (!sessionReady || !auth.currentUser) {toast('Aguarde a conexão com os dados antes de alterar registros.', true); return false;}
  if (!navigator.onLine) {toast('Sem conexão. Seus campos foram preservados; tente novamente quando estiver online.', true); return false;}
  const version = sessionVersion, userId = auth.currentUser.uid, token = {};
  const state = clone(MEM), before = clone(MEM);
  let committed = false;
  saving = token; setSaving(true);
  try {
    mutator(state);
    const changed = Object.values(K).filter(key => JSON.stringify(state[key]) !== JSON.stringify(before[key]));
    if (!changed.length) return false;
    // One commit acknowledges all parts of this action. Whole-list concurrency
    // and the document size limit remain architectural limitations.
    const batch = fbDB.batch();
    changed.forEach(key => batch.set(fbDB.collection('banco_personalise').doc(key), {lista:state[key]}));
    await batch.commit();
    if (version !== sessionVersion || auth.currentUser?.uid !== userId) return false;
    committed = true;
    changed.forEach(key => {MEM[key] = state[key];});
    after();
    if (message) toast(message);
    return true;
  } catch (error) {
    if (version === sessionVersion) {
      if(committed){toast('Os dados foram salvos, mas a tela não pôde ser atualizada. Recarregue a página.',true);return true;}
      toast(error.userMessage || 'Não foi possível salvar na nuvem. A alteração não foi confirmada e seus campos foram preservados.', true);
      if (document.getElementById('mped').classList.contains('on') && actPed) abrModal(actPed);
      atualizarTelaAtual();
    }
    return false;
  } finally {
    if (saving === token) {saving = null; setSaving(false);}
  }
}
function getCols(){return DB.get(K.col).length ? DB.get(K.col) : defaultColumns();}
function invalid(message) {const error = new Error(message); error.userMessage = message; throw error;}
function required(value, name) {const text=String(value ?? '').trim(); if(!text) invalid(`Preencha ${name}.`); return text;}
function quantity(value, name, minimum = 0) {
  const number=Number(value);
  if (String(value).trim()==='' || !Number.isSafeInteger(number) || number < minimum) invalid(`${name}: informe uma quantidade inteira a partir de ${minimum}.`);
  return number;
}
function money(value, name, optional = false) {
  const raw=String(value ?? '').trim();
  if (optional && !raw) return 0;
  const number=Number(raw);
  if(!raw || !Number.isFinite(number) || number < 0 || !Number.isSafeInteger(Math.round(number * 100)) || Math.abs(number*100 - Math.round(number*100)) > 0.00001) invalid(`${name}: informe um valor válido, não negativo, com até duas casas decimais.`);
  return Math.round(number*100)/100;
}
function validDate(value, optional = false) {
  if (!value && optional) return null;
  const date=new Date(value+'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) invalid('Informe uma data válida.');
  return value;
}
function validEmail(value){const input=document.createElement('input');input.type='email';input.value=value;return input.checkValidity();}
function choice(value, allowed) {if(!allowed.includes(value)) invalid('Selecione uma opção válida.'); return value;}
function payment(value, receipt = false) {return choice(value, APP_CONFIG.pagamentos_vendas.filter(p => !receipt || p !== 'Fiado'));}
function cents(value) {const n=Number(value);return Number.isFinite(n) ? Math.round((n + Number.EPSILON)*100) : 0;}
function sumMoney(rows, key) {return rows.reduce((sum,row)=>sum+cents(row[key]),0)/100;}
function subtractMoney(a,b){return (cents(a)-cents(b))/100;}
function esc(value){return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function linkLegacyClient(state,client){
 const link=record=>{if(!record.clienteId&&record.cliente===client.nome)record.clienteId=client.id;};
 state[K.p].forEach(link);state[K.v].forEach(link);state[K.co].forEach(item=>{link(item);if(item.pedOriginal)link(item.pedOriginal);});
}
function clientFor(state, name, tel, selectedId) {
  if (selectedId && selectedId !== '__new__') {
    const selected=state[K.cl].find(c=>c.id===selectedId);
    if (!selected || selected.nome!==name) invalid('Selecione novamente o cliente cadastrado.');
    return selected;
  }
  const matches=state[K.cl].filter(c=>c.nome===name);
  if (selectedId !== '__new__' && matches.length) {
    const phone=tel.replace(/\D/g,'');
    const exact=matches.filter(c=>!phone || String(c.tel||'').replace(/\D/g,'')===phone);
    if (exact.length!==1) invalid('Há clientes com este nome. Selecione o cadastro correto ou escolha cadastrar novo cliente.');
    return exact[0];
  }
  if(matches.length===1)linkLegacyClient(state,matches[0]);
  const client={id:uid(),nome:name,tel,cidade:'',email:''};
  state[K.cl].unshift(client); return client;
}
function escolherCliente(prefix, id) {
  const client=DB.get(K.cl).find(c=>c.id===id);
  if(!client) return;
  document.getElementById(prefix==='if'?'ifc':prefix==='ep'?'epc':'vc').value=client.nome;
  if(prefix!=='v') document.getElementById(prefix==='if'?'ift':'ept').value=client.tel||'';
}
async function fazerLogin() {
  const email=gv('log-email').trim(), pass=gv('log-pass'), err=document.getElementById('login-error');
  err.style.display='none'; document.getElementById('login-feedback').textContent='';
  if(!email || !pass) {err.textContent='Preencha e-mail e senha.';err.style.display='block';return;}
  if(!document.getElementById('log-email').checkValidity()){err.textContent='Informe um e-mail válido.';err.style.display='block';return;}
  const button=document.getElementById('login-submit'); button.disabled=true;
  try {await auth.signInWithEmailAndPassword(email,pass);document.getElementById('log-pass').value='';}
  catch(error){err.textContent=error.code==='auth/network-request-failed'?'Não foi possível conectar. Verifique a internet.':error.code==='auth/too-many-requests'?'Muitas tentativas. Aguarde antes de tentar novamente.':'Não foi possível entrar. Confira o e-mail e a senha.';err.style.display='block';}
  finally{button.disabled=false;}
}
async function recuperarSenha() {
  const err=document.getElementById('login-error'),feedback=document.getElementById('login-feedback'),button=document.getElementById('reset-password');
  err.style.display='none'; feedback.textContent='';
  const email=gv('log-email').trim();
  if(!email || !document.getElementById('log-email').checkValidity()){err.textContent='Informe seu e-mail válido para recuperar a senha.';err.style.display='block';return;}
  button.disabled=true;
  try {await auth.sendPasswordResetEmail(email);feedback.textContent='Se houver uma conta com esse e-mail, você receberá as instruções para redefinir a senha.';}
  catch(error){if(error.code==='auth/user-not-found') feedback.textContent='Se houver uma conta com esse e-mail, você receberá as instruções para redefinir a senha.';else{err.textContent=error.code==='auth/too-many-requests'?'Muitas tentativas. Aguarde antes de tentar novamente.':'Não foi possível enviar a solicitação. Verifique a conexão e tente novamente.';err.style.display='block';}}
  finally{button.disabled=false;}
}
async function fazerLogout() {
  if(saving){toast('Aguarde a confirmação do salvamento antes de sair.',true);return;}
  try{await auth.signOut();}catch{toast('Não foi possível sair. Tente novamente.',true);}
}
window.addEventListener('beforeunload',event=>{if(saving){event.preventDefault();event.returnValue='';}});

function atualizarTelaAtual() {
  updDL(); 
  const pages = ['p0','p1','p2','p3','p4','p5','p6'];
  const active = pages.find(p => document.getElementById(p).classList.contains('on'));
  if(active === 'p0') buildDash();
  if(active === 'p1') atualizarKanbanEAlertas();
  if(active === 'p2') renderV(); 
  if(active === 'p3') renderC();
  if(active === 'p4') renderE();
  if(active === 'p5') renderCl();
  if(active === 'p6') gerarR(false);
}

// ── FUNÇÕES UTILITÁRIAS E MATEMÁTICA DE TAXAS ──
const uid=()=>crypto.randomUUID();
const brl=v=>'R$ '+(cents(v)/100).toFixed(2).replace('.',',');
const hj=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10);};
function fd(d){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(d)))return'–';const[y,m,day]=d.split('-');return`${day}/${m}/${y}`;}
const isL=d=>d&&d<hj();
const isT=d=>d===hj();
function gv(id){const e=document.getElementById(id);return e?e.value:''}
function sv(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function toast(m,e=false){const t=document.getElementById('toast');t.textContent=m;t.style.background=e?'var(--no)':'var(--pd)';t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2700);}
function CM(id){document.getElementById(id).classList.remove('on')}
function OM(id){document.getElementById(id).classList.add('on')}
function conf(m,cb){
  document.getElementById('cfm').textContent=m;OM('mcf');
  document.getElementById('cfo').onclick=async()=>{if(await cb() !== false)CM('mcf');};
}
function calcLiq(val,pgto){
  const gross=cents(val), rate=pgto==='Débito'?APP_CONFIG.taxas.debito:pgto==='Crédito'?APP_CONFIG.taxas.credito:pgto==='Compra Online'?APP_CONFIG.taxas.online:0;
  const scaled=BigInt(Math.abs(gross))*BigInt(10000-Math.round(rate*100));
  return Math.sign(gross)*Number((scaled+5000n)/10000n)/100;
}

function brlLq(bruto, liq) {
    if(bruto > liq) return `<del style="color:var(--tl);font-size:0.7rem">${brl(bruto)}</del><br><span style="color:var(--ok)">${brl(liq)}</span>`;
    return brl(liq);
}

function pagList(lista, idPag, funcMudar, arrKey) {
    let b = document.getElementById(idPag);
    if(!b) return lista;
    if(lista.length <= ITEMS_PER_PAGE) { cp[arrKey]=1; b.innerHTML = ''; return lista; }
    let tot = Math.ceil(lista.length / ITEMS_PER_PAGE);
    if(cp[arrKey] > tot) cp[arrKey] = tot;
    if(cp[arrKey] < 1) cp[arrKey] = 1;
    let start = (cp[arrKey] - 1) * ITEMS_PER_PAGE;
    let end = start + ITEMS_PER_PAGE;
    b.innerHTML = `<div class="pag-container"><button class="pag-btn" onclick="${funcMudar}(-1)" ${cp[arrKey]===1?'disabled':''}>⬅️ Anterior</button><span class="pag-info">Pág ${cp[arrKey]} de ${tot}</span><button class="pag-btn" onclick="${funcMudar}(1)" ${cp[arrKey]===tot?'disabled':''}>Próxima ➡️</button></div>`;
    return lista.slice(start, end);
}

function mudarPagC(dir) { cp.co+=dir; renderConc(); }
function mudarPagV(dir) { cp.v+=dir; renderV(); }
function mudarPagCom(dir){ cp.c+=dir; renderC(); }
function mudarPagE(dir) { cp.e+=dir; renderE(); }
function mudarPagCl(dir){ cp.cl+=dir; renderCl(); }
function mudarPagR(dir) { cp.r+=dir; gerarR(false); }

function updDL(){
  const clients=DB.get(K.cl);
  ['vcl','ifcl'].forEach(id=>{const list=document.getElementById(id);list.replaceChildren(...clients.map(c=>new Option(c.nome,c.nome)));});
  ['if','v','ep'].forEach(prefix=>{
    const select=document.getElementById(prefix+'cliente-id');
    const selected=select.value;
    select.replaceChildren(new Option('Selecione um cadastro (opcional)',''),new Option('Cadastrar novo cliente','__new__'),...clients.map(c=>new Option(`${esc(c.nome)}${c.tel?' · '+c.tel:''}${c.email?' · '+c.email:''} · ${String(c.id).slice(-6)}`,c.id)));
    select.value=selected;
  });
}
async function copiarTexto(e,t){e.stopPropagation();try{await navigator.clipboard.writeText(t);toast('Copiado!');}catch{toast('Não foi possível copiar. Selecione o número manualmente.',true);}}
function initDragToScroll() {
  const slider = document.getElementById('kb'); let isDown=false,startX,scrollLeft;
  if(!slider) return;
  slider.onmousedown=e=>{ if(e.target.closest('.kd')||e.target.closest('.kch')||e.target.closest('button')||e.target.closest('input')||e.target.closest('select')||e.target.closest('.k-tel'))return; isDown=true; startX=e.pageX-slider.offsetLeft; scrollLeft=slider.scrollLeft; };
  slider.onmouseleave=()=>isDown=false; slider.onmouseup=()=>isDown=false;
  slider.onmousemove=e=>{ if(!isDown)return; e.preventDefault(); const x=e.pageX-slider.offsetLeft; slider.scrollLeft=scrollLeft-(x-startX)*1.5; };
}
document.querySelectorAll('.mo').forEach(m => { m.addEventListener('click', (e) => { if(e.target === m) CM(m.id); }); });
if(document.getElementById('vd')) document.getElementById('vd').value = hj();
if(document.getElementById('cd')) document.getElementById('cd').value = hj();

function autoFillTel(){
  const name=gv('ifc').trim(),select=document.getElementById('ifcliente-id');
  if(select.value==='__new__')return;
  const matches=DB.get(K.cl).filter(c=>c.nome===name);
  select.value=matches.length===1?matches[0].id:'';
  document.getElementById('ift').value=matches.length===1?(matches[0].tel||''):'';
}

// ── 4. NAVEGAÇÃO E DASHBOARD ──
function goTo(n){
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('nav a').forEach(a=>a.classList.remove('on'));
  document.getElementById('p'+n).classList.add('on');
  document.getElementById('n'+n).classList.add('on');
  updDL(); 
  if(n===0) buildDash(); if(n===1) atualizarKanbanEAlertas(); if(n===2) renderV(); if(n===3) renderC(); if(n===4) renderE(); if(n===5) renderCl(); if(n===6) { setRDates(); gerarR(true); }
}

let CHS={};
function buildDash(){
  const d=hj(),mes=d.slice(0,7);
  const vs=DB.get(K.v)||[],cs=DB.get(K.c)||[],ps=DB.get(K.p)||[],es=DB.get(K.e)||[];
  
  const vH=vs.filter(v=>v.data===d),cH=cs.filter(c=>c.data===d);
  const ent=vH.reduce((a,item)=>a+cents(item.total),0)/100,sai=cH.reduce((a,item)=>a+cents(item.valor),0)/100,sal=ent-sai;
  
  // DADOS TOTAIS (HISTÓRICO COMPLETO PARA O SALDO GERAL)
  const allVendas = vs.filter(v => v.categoria !== 'Ajuste de caixa').reduce((a,b)=>a+cents(b.total),0)/100;
  const allAjustesPos = vs.filter(v => v.categoria === 'Ajuste de caixa').reduce((a,b)=>a+cents(b.total),0)/100;
  const allCustos = cs.filter(c=>!['Retirada Pessoal','Pró-labore','Ajuste de caixa'].includes(c.categoria)).reduce((a,b)=>a+cents(b.valor),0)/100;
  const allRetiradas = cs.filter(c=>['Retirada Pessoal','Pró-labore'].includes(c.categoria)).reduce((a,b)=>a+cents(b.valor),0)/100;
  const allAjustesNeg = cs.filter(c => c.categoria === 'Ajuste de caixa').reduce((a,b)=>a+cents(b.valor),0)/100;

  const saldoGeral = (allVendas + allAjustesPos) - (allCustos + allRetiradas + allAjustesNeg);

  // LÓGICA DA GAVETA (TODO O DINHEIRO FÍSICO DO NEGÓCIO + AJUSTES EM DINHEIRO)
  const entDinheiro = vs.filter(v => v.pgto === 'Dinheiro').reduce((a,b)=>a+cents(b.total),0)/100;
  const saiDinheiro = cs.filter(c => c.pgto === 'Dinheiro').reduce((a,b)=>a+cents(b.valor),0)/100;
  const saldoDinheiro = entDinheiro - saiDinheiro;

  // DADOS DO MÊS ATUAL
  const vM=vs.filter(v=>String(v.data||'').startsWith(mes)), cM=cs.filter(c=>String(c.data||'').startsWith(mes));
  
  const fatM = vM.filter(v => v.categoria !== 'Ajuste de caixa').reduce((a,b)=>a+cents(b.total),0)/100;
  const custosM = cM.filter(c=>!['Retirada Pessoal','Pró-labore','Ajuste de caixa'].includes(c.categoria)).reduce((a,b)=>a+cents(b.valor),0)/100;
  const retiradasM = cM.filter(c=>['Retirada Pessoal','Pró-labore'].includes(c.categoria)).reduce((a,b)=>a+cents(b.valor),0)/100;
  const ajustesPosM = vM.filter(v => v.categoria === 'Ajuste de caixa').reduce((a,b)=>a+cents(b.total),0)/100;
  const ajustesNegM = cM.filter(c => c.categoria === 'Ajuste de caixa').reduce((a,b)=>a+cents(b.valor),0)/100;

  const lucroLiqM = fatM - custosM;
  const resultadoMes = (fatM + ajustesPosM) - (custosM + retiradasM + ajustesNegM);
  const saldoAcumuladoAnterior = saldoGeral - resultadoMes;

  // ATUALIZANDO O DOM
  sv('cxe',brl(ent));sv('cxeq',vH.length+' recebimentos');
  sv('cxs',brl(sai));sv('cxsq',cH.length+' despesas/retiradas');
  const se=document.getElementById('cxd');if(se){se.textContent=brl(sal);se.style.color=sal>=0?'var(--ok)':'var(--no)';}
  sv('cxm',brl(fatM));sv('cxmq',vM.filter(v=>v.categoria !== 'Ajuste de caixa').length+' vendas/sinais no mês');

  sv('dv',brl(fatM));sv('dvq',vM.filter(v=>v.categoria !== 'Ajuste de caixa').length+' vendas no mês');
  sv('ddin',brl(saldoDinheiro));sv('ddinq','saldo real em caixa');
  sv('dr',brl(retiradasM)); 
  
  const dl=document.getElementById('dl');if(dl){dl.textContent=brl(lucroLiqM);dl.style.color=lucroLiqM>=0?'var(--ok)':'var(--no)';}
  
  // PAINEL DE SALDO GERAL
  const dsr = document.getElementById('dsr'); if(dsr){ dsr.textContent = brl(saldoGeral); dsr.style.color = saldoGeral>=0?'var(--ok)':'var(--no)'; }
  const dsrAnt = document.getElementById('dsr-ant'); if(dsrAnt){ dsrAnt.innerHTML = `Acumulado até mês passado: <b style="color:${saldoAcumuladoAnterior>=0?'var(--ok)':'var(--no)'}">${brl(saldoAcumuladoAnterior)}</b>`; }
  const dsrMes = document.getElementById('dsr-mes'); if(dsrMes){ dsrMes.innerHTML = `Resultado deste mês: <b style="color:${resultadoMes>=0?'var(--ok)':'var(--no)'}">${brl(resultadoMes)}</b>`; }

  sv('dp',ps.filter(p=>!p.entregue).length);
  sv('de',es.length);
  
  const ms=[],lbM=[];
  for(let i=5;i>=0;i--){const mDt=new Date(new Date().getFullYear(),new Date().getMonth()-i,1);ms.push(mDt.toISOString().slice(0,7));lbM.push(mDt.toLocaleDateString('pt-BR',{month:'short'}));}
  if(CHS['ch1'])CHS['ch1'].destroy();
  const elCh1 = document.getElementById('ch1');
  if(elCh1) {
      CHS['ch1']=new Chart(elCh1.getContext('2d'),{type:'bar',data:{labels:lbM,datasets:[{label:'Vendas Líquidas',data:ms.map(m=>(DB.get(K.v)||[]).filter(v=>String(v.data||'').startsWith(m) && v.categoria !== 'Ajuste de caixa').reduce((a,item)=>a+cents(item.total),0)/100),backgroundColor:APP_CONFIG.tema.p,borderRadius:4},{label:'Custos do negócio',data:ms.map(m=>(DB.get(K.c)||[]).filter(c=>String(c.data||'').startsWith(m)&&!['Retirada Pessoal','Pró-labore','Ajuste de caixa'].includes(c.categoria)).reduce((a,item)=>a+cents(item.valor),0)/100),backgroundColor:APP_CONFIG.tema.chart[1],borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false}});
  }
  
  const cats={};vs.filter(v=>v.categoria!=='Ajuste de caixa').forEach(v=>{const c=v.categoria||'Outros';cats[c]=((cents(cats[c])+cents(v.total))/100);});
  if(CHS['ch2'])CHS['ch2'].destroy();
  const elCh2 = document.getElementById('ch2');
  if(elCh2) {
      CHS['ch2']=new Chart(elCh2.getContext('2d'),{type:'pie',data:{labels:Object.keys(cats),datasets:[{data:Object.values(cats),backgroundColor:APP_CONFIG.tema.chart}]},options:{responsive:true,maintainAspectRatio:false}});
  }
}

// ── 5. KANBAN E INTELIGÊNCIA FINANCEIRA ──
function atualizarKanbanEAlertas() { buildAlerts(); renderKB(); }

function buildAlerts(){
  const bar=document.getElementById('alerts'); if(!bar) return; bar.innerHTML='';
  const ps=DB.get(K.p)||[];
  const at=ps.filter(p=>!p.entregue&&isL(p.entrega));
  const hj2=ps.filter(p=>!p.entregue&&isT(p.entrega));
  const pp=ps.filter(p=>!p.pago&&Number(p.valor||0)>0);
  bar.style.display=(at.length||hj2.length||pp.length)?'flex':'none';
  const add=(tp,ic,msg,ft)=>{
    const d=document.createElement('div');d.className=`al ${tp}`;
    d.innerHTML=`<span>${ic}</span><span>${msg}</span><span style="margin-left:auto;">Filtrar ➔</span>`;
    d.onclick=()=>{activeFilter=ft;renderKB()}; bar.appendChild(d);
  };
  if(at.length)add('da','🚨',`${at.length} ATRASADOS`,'atraso');
  if(hj2.length)add('wa','📅',`${hj2.length} PARA HOJE`,'hoje');
  if(pp.length)add('in','💳',`${pp.length} PENDENTES PGTO`,'pagamento');
}

function destroyBoardSortables(){const board=document.getElementById('kb');board.sortableInstance?.destroy();board.sortableInstance=null;(board.cardSortables||[]).forEach(sortable=>sortable.destroy());board.cardSortables=[];}
function renderKB(){
  const board=document.getElementById('kb'); 
  if(!board) return;
  const cols=getCols(); const ps=DB.get(K.p)||[]; destroyBoardSortables();board.innerHTML='';
  const banner=document.getElementById('kb-filter-banner');
  kbQ=gv('kb-q').toLowerCase().trim(); 

  if(activeFilter){
    let t=activeFilter==='hoje'?'📅 HOJE':activeFilter==='atraso'?'🚨 ATRASADOS':'💳 PENDENTES PGTO';
    banner.innerHTML=`<span>Filtro Ativo: ${t}</span><button class="btn bd sm" onclick="activeFilter=null;atualizarKanbanEAlertas()">❌ Limpar</button>`;
    banner.style.display='flex';
  } else {
    if(banner) banner.style.display='none';
  }

  cols.forEach(col=>{
    let cards=ps.filter(p=>(p.colId||cols[0].id)===col.id);
    if(activeFilter==='hoje') cards=cards.filter(p=>!p.entregue&&isT(p.entrega));
    if(activeFilter==='atraso') cards=cards.filter(p=>!p.entregue&&isL(p.entrega));
    if(activeFilter==='pagamento') cards=cards.filter(p=>!p.pago&&Number(p.valor||0)>0);
    
    if(kbQ) cards=cards.filter(p=>String(p.cliente||'').toLowerCase().includes(kbQ)||String(p.desc||'').toLowerCase().includes(kbQ));

    const tot=cards.reduce((a,p)=>a+cents(p.valor),0)/100;
    const ce=document.createElement('div'); ce.className='kc'; ce.dataset.colId=col.id;
    ce.innerHTML=`<div class="kch"><span class="cn${!col.fixa?' ed':''}" ${!col.fixa?`data-rename-col="${esc(col.id)}"`:''}>${esc(col.nome)}</span><div class="cm2"><span class="cb">${cards.length}</span>${tot>0?`<span class="ct">${brl(tot)}</span>`:''} <button class="bc" style="${col.fixa?'display:none':''}" data-action="delete-column" data-id="${esc(col.id)}">✕</button></div></div>`;
    const body=document.createElement('div'); body.className='kcb'; body.dataset.colId=col.id;
    
    cards.forEach(p=>{
      const el=document.createElement('div'); el.className=`kd ${p.entregue?'eg':''} ${p.pago?'k-pago':''}`; el.dataset.id=p.id;
      const rest=subtractMoney(p.valor,p.sinal);
      const telH=p.tel?`<div class="k-tel" onmousedown="event.stopPropagation()" data-action="copy-phone" data-phone="${esc(p.tel)}">📱 ${esc(p.tel)}</div>`:'';
      el.innerHTML=`<div class="kt"><div style="display:flex;flex-direction:column;"><span class="kn">${esc(p.cliente)}</span>${telH}</div><span class="kv">${brl(p.valor)}</span></div><div class="kdc">${esc(p.desc)}</div><div class="kft"><span>${p.entrega?'📅 '+fd(p.entrega):''}</span><div>${p.pago?'<span class="tg2 t-pago">✅ Pago</span>':(rest>0?`<span class="tg2 pn">💳 ${brl(rest)}</span>`:'')}</div></div>`;
      el.onclick=event=>{if(!event.target.closest('[data-action],button,a'))abrModal(p.id);}; body.appendChild(el);
    });
    ce.appendChild(body); board.appendChild(ce);
  });
  const btn=document.createElement('button');btn.className='bnc';btn.innerHTML='+';btn.onclick=()=>{document.getElementById('ncn').value='';OM('mnc');};board.appendChild(btn);

  board.sortableInstance=new Sortable(board,{animation:150,draggable:'.kc',handle:'.kch',filter:'.bc',onEnd:async()=>{
    const ids=[...board.querySelectorAll('.kc')].map(el=>el.dataset.colId);
    await alterar(state=>{const cols=state[K.col].length?state[K.col]:defaultColumns();state[K.col]=ids.map(id=>cols.find(c=>c.id===id)).filter(Boolean);},'Ordem das colunas salva.');renderKB();
  }});
  board.cardSortables=[...document.querySelectorAll('.kcb')].map(el=>new Sortable(el,{group:'kanban',animation:150,onEnd:async event=>{
    const id=event.item.dataset.id,column=event.to.dataset.colId;
    await alterar(state=>{const order=state[K.p].find(p=>p.id===id);if(!order)invalid('Pedido não encontrado.');order.colId=column;},'Pedido movido.');renderKB();
  }}));
}

function filtKB(){ renderKB(); }
function stab(show,hide,el){
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('on'));el.classList.add('on');
  document.getElementById(show).style.display='block';document.getElementById(hide).style.display='none';
  if(show==='cs')renderConc();
}

function addCard(){
 return alterar(state=>{
  const name=required(gv('ifc'),'o cliente'), desc=required(gv('ifd'),'a descrição'),tel=gv('ift').trim();
  const total=money(gv('ifv'),'Valor total',true),deposit=money(gv('ifs'),'Sinal',true);
  if(deposit>total)invalid('O sinal não pode ser maior que o valor total.');
  const method=payment(gv('ifspg'),true), delivery=validDate(gv('ife'),true);
  const client=clientFor(state,name,tel,gv('ifcliente-id'));
  const saleId=deposit>0?'v_'+uid():null;
  if(saleId)state[K.v].unshift({id:saleId,cliente:client.nome,clienteId:client.id,produto:'Sinal - '+desc,categoria:'Vendas',qtd:1,totalBruto:deposit,total:calcLiq(deposit,method),pgto:method,data:hj()});
  state[K.p].unshift({id:uid(),colId:(state[K.col][0]||defaultColumns()[0]).id,cliente:client.nome,clienteId:client.id,desc,valor:total,sinal:deposit,tel,entrega:delivery,data:hj(),pago:false,entregue:false,sinalVId:saleId,restVId:null});
 },'Pedido adicionado!',()=>{
  ['ifc','ifd','ifv','ifs','ift','ife','ifcliente-id'].forEach(id=>document.getElementById(id).value='');
  CM('mnp');updDL();atualizarKanbanEAlertas();
 });
}

let actPed=null,edColId=null;
function abrModal(id){
  actPed=id; const p=DB.get(K.p).find(x=>x.id===id); if(!p) return;
  let num=p.tel?String(p.tel).replace(/\D/g,''):'';
  let wa=num.length>=10?`<a href="https://wa.me/55${num}" target="_blank" rel="noopener noreferrer" style="background:#25D366;color:#fff;padding:3px 10px;border-radius:10px;text-decoration:none;font-size:0.7rem;font-weight:bold;margin-left:10px;">💬 WhatsApp</a>`:'';
  document.getElementById('mpif').innerHTML=`<div style="font-weight:bold;font-size:1.05rem;color:var(--pd);margin-bottom:6px;display:flex;align-items:center;">${esc(p.cliente)} ${wa}</div><strong>Descrição:</strong> ${esc(p.desc)}`;
  sv('mptot',brl(p.valor)); sv('mpsin',brl(p.sinal)); sv('mprest',brl(subtractMoney(p.valor,p.sinal)));
  
  document.getElementById('mppg').checked=!!p.pago; document.getElementById('mpeg').checked=!!p.entregue;
  OM('mped');
}

function togF(f){
 return alterar(state=>{
  if(!['pago','entregue'].includes(f))invalid('Status inválido.');
  const p=state[K.p].find(p=>p.id===actPed);if(!p)invalid('Pedido não encontrado.');
  const checked=document.getElementById(f==='pago'?'mppg':'mpeg').checked;
  if(f==='pago'){
   if(checked&&!p.pago){
    const rest=subtractMoney(p.valor,p.sinal);
    if(rest>0){const method=payment(gv('mppg_met'),true);p.restVId='v_'+uid();state[K.v].unshift({id:p.restVId,cliente:p.cliente,clienteId:p.clienteId||null,produto:'Restante - '+p.desc,categoria:'Vendas',qtd:1,totalBruto:rest,total:calcLiq(rest,method),pgto:method,data:hj()});}
   }else if(!checked&&p.pago&&p.restVId){state[K.v]=state[K.v].filter(v=>v.id!==p.restVId);p.restVId=null;}
  }
  p[f]=checked;
 },'Status atualizado!',()=>{abrModal(actPed);atualizarKanbanEAlertas();});
}

function delPA(){
 const id=actPed;
 conf('Excluir pedido definitivamente?',()=>alterar(state=>{
  const p=state[K.p].find(p=>p.id===id);if(!p)invalid('Pedido não encontrado.');
  state[K.v]=state[K.v].filter(v=>v.id!==p.sinalVId&&v.id!==p.restVId);
  state[K.p]=state[K.p].filter(p=>p.id!==id);
 },'Pedido excluído.',()=>{CM('mped');atualizarKanbanEAlertas();}));
}

function editPA(){
  updDL();
  const p=DB.get(K.p).find(x=>x.id===actPed);if(!p)return;
  document.getElementById('epc').value=p.cliente;document.getElementById('ept').value=p.tel||'';document.getElementById('epe').value=p.entrega||'';document.getElementById('epv').value=p.valor;document.getElementById('eps').value=p.sinal||0;document.getElementById('epd').value=p.desc;
  
  document.getElementById('epcliente-id').value=p.clienteId||'';
  let sMet = 'PIX';
  if(p.sinalVId) {
      let v = (DB.get(K.v)||[]).find(x=>x.id===p.sinalVId);
      if(v) sMet = v.pgto;
  }
  document.getElementById('epspg').value = sMet;

  CM('mped');OM('mep');
}

function salvarEd(){
 return alterar(state=>{
  const p=state[K.p].find(p=>p.id===actPed);if(!p)invalid('Pedido não encontrado.');
  const name=required(gv('epc'),'o cliente'),desc=required(gv('epd'),'a descrição'),tel=gv('ept').trim();
  const deposit=money(gv('eps'),'Sinal',true),total=money(gv('epv'),'Valor total',true);
  if(deposit>total)invalid('O sinal não pode ser maior que o valor total.');
  const method=payment(gv('epspg'),true),delivery=validDate(gv('epe'),true),client=clientFor(state,name,tel,gv('epcliente-id'));
  if(p.sinalVId){const v=state[K.v].find(v=>v.id===p.sinalVId);if(!v)invalid('O recebimento vinculado não existe. Atualize o pedido antes de editar.');Object.assign(v,{totalBruto:deposit,total:calcLiq(deposit,method),cliente:client.nome,clienteId:client.id,produto:'Sinal - '+desc,pgto:method});}
  else if(deposit>0){p.sinalVId='v_'+uid();state[K.v].unshift({id:p.sinalVId,cliente:client.nome,clienteId:client.id,produto:'Sinal - '+desc,categoria:'Vendas',qtd:1,totalBruto:deposit,total:calcLiq(deposit,method),pgto:method,data:hj()});}
  if(p.restVId){const v=state[K.v].find(v=>v.id===p.restVId);if(!v)invalid('O recebimento vinculado não existe. Atualize o pedido antes de editar.');const rest=subtractMoney(total,deposit);Object.assign(v,{totalBruto:rest,total:calcLiq(rest,v.pgto),cliente:client.nome,clienteId:client.id,produto:'Restante - '+desc});}
  Object.assign(p,{cliente:client.nome,clienteId:client.id,tel,entrega:delivery,valor:total,sinal:deposit,desc});
 },'Pedido editado!',()=>{CM('mep');updDL();atualizarKanbanEAlertas();});
}

function criarCol(){return alterar(state=>{
 const name=required(gv('ncn'),'o nome da coluna');if(name.length>26)invalid('O nome da coluna deve ter até 26 caracteres.');
 if(!state[K.col].length)state[K.col]=defaultColumns();state[K.col].push({id:'c'+uid(),nome:name,fixa:false});
},'Coluna criada.',()=>{CM('mnc');atualizarKanbanEAlertas();});}
function abrRnc(id){edColId=id;const col=getCols().find(c=>c.id===id);document.getElementById('rcn').value=col?col.nome:'';OM('mrc');}
function renCol(){return alterar(state=>{
 const name=required(gv('rcn'),'o nome da coluna');if(name.length>26)invalid('O nome da coluna deve ter até 26 caracteres.');
 const col=state[K.col].find(c=>c.id===edColId);if(!col)invalid('Coluna não encontrada.');col.nome=name;
},'Coluna atualizada.',()=>{CM('mrc');atualizarKanbanEAlertas();});}
function delCol(id){conf('Excluir coluna?',()=>alterar(state=>{
 const col=state[K.col].find(c=>c.id===id);if(!col||col.fixa)invalid('Esta coluna não pode ser excluída.');
 if(state[K.p].some(p=>(p.colId||getCols()[0].id)===id))invalid('Mova os pedidos antes de excluir a coluna.');
 state[K.col]=state[K.col].filter(c=>c.id!==id);
},'Coluna excluída.',atualizarKanbanEAlertas));}

function abrirLV(){
  const p=DB.get(K.p).find(x=>x.id===actPed); if(!p) return;
  const sel=document.getElementById('lvest');
  sel.innerHTML=`<option value="">— Não abater —</option>`+(DB.get(K.e)||[]).map(e=>`<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join('');
  document.getElementById('lvqw').style.display='none';
  document.getElementById('lvq').value='1';
  CM('mped'); OM('mlv');
}

function confLV(){
 return alterar(state=>{
  const index=state[K.p].findIndex(p=>p.id===actPed);if(index===-1)invalid('Pedido não encontrado.');const ped=state[K.p][index];
  const stockId=gv('lvest');let deducted=0,stockBefore=null;
  if(stockId){
   deducted=quantity(gv('lvq'),'Quantidade a abater',1);
   const stock=state[K.e].find(e=>e.id===stockId);if(!stock)invalid('Item de estoque não encontrado.');
   stockBefore=quantity(stock.qtd,'Estoque atual');
   if(deducted>stockBefore)invalid('Estoque insuficiente. A quantidade solicitada não foi abatida.');
   stock.qtd=stockBefore-deducted;
  }
  // Keep the existing completion/payment policy. Changing it is a separate
  // commercial decision; stock checks always happen before any receipt.
  if(!ped.pago){const rest=subtractMoney(ped.valor,ped.sinal);if(rest>0){ped.restVId='v_'+uid();state[K.v].unshift({id:ped.restVId,cliente:ped.cliente,clienteId:ped.clienteId||null,produto:'Restante - '+ped.desc,categoria:'Vendas',qtd:1,totalBruto:rest,total:rest,pgto:'Dinheiro',data:hj()});}ped.pago=true;}
  state[K.co].unshift({id:uid(),cliente:ped.cliente,clienteId:ped.clienteId||null,desc:ped.desc,valor:ped.valor,dataConc:hj(),sinalVId:ped.sinalVId||null,restVId:ped.restVId||null,pedOriginal:clone(ped),estId:stockId||null,qtdEst:deducted,estoqueAntes:stockBefore});
  state[K.p].splice(index,1);
 },'Pedido finalizado e arquivado!',()=>{CM('mlv');atualizarKanbanEAlertas();});
}

function renderConc(){
  const b=gv('fc0').toLowerCase(); 
  let d=(DB.get(K.co)||[]).filter(c=>!b||c.cliente.toLowerCase().includes(b));
  d = pagList(d, 'cs-pag', 'mudarPagC', 'co');
  const tbc = document.getElementById('tbc');
  if(tbc) {
    tbc.innerHTML=d.length?d.map(c=>`<tr><td>${fd(c.dataConc)}</td><td><strong>${esc(c.cliente)}</strong></td><td>${esc(String(c.desc||'').slice(0,55))}</td><td style="color:var(--ok);font-weight:700">${brl(c.valor)}</td>
    <td><button class="btn bw sm" title="Desfazer e voltar ao Kanban" data-action="undo-order" data-id="${esc(c.id)}">↩️</button> <button class="btn bd sm" title="Apagar definitivamente" data-action="delete-completed" data-id="${esc(c.id)}">🗑️</button></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;">Nenhum concluído</td></tr>';
  }
}

function desfazerConc(id){
 conf('Desfazer conclusão? O pedido voltará para o Kanban.',()=>alterar(state=>{
  const index=state[K.co].findIndex(c=>c.id===id);if(index===-1)invalid('Registro não encontrado.');const item=state[K.co][index];
  const restored=item.pedOriginal?clone(item.pedOriginal):{id:uid(),colId:getCols()[0].id,cliente:item.cliente,clienteId:item.clienteId||null,desc:item.desc,valor:item.valor,sinal:0,tel:'',entrega:null,data:hj(),pago:true,entregue:false,sinalVId:item.sinalVId||null,restVId:item.restVId||null};
  if(state[K.p].some(p=>p.id===restored.id))invalid('Este pedido já está no Kanban.');
  reconcileReceipts(restored,state[K.v]);
  if(item.estId){const stock=state[K.e].find(e=>e.id===item.estId);if(!stock)invalid('O item de estoque foi excluído. Não é possível desfazer a baixa automaticamente.');const amount=quantity(item.qtdEst??0,'Quantidade anteriormente abatida');if(amount>0&&(item.estoqueAntes==null||amount>quantity(item.estoqueAntes,'Estoque anterior'))){invalid('Esta baixa antiga não possui comprovação da quantidade abatida. Confira o estoque antes de restaurar o pedido.');}stock.qtd=quantity(stock.qtd,'Estoque atual')+amount;if(!Number.isSafeInteger(stock.qtd))invalid('Quantidade de estoque fora do limite.');}
  state[K.p].unshift(restored);state[K.co].splice(index,1);
 },'Pedido restaurado para o Kanban!',()=>{renderConc();atualizarKanbanEAlertas();}));
}
function delConc(id){conf('Excluir registro permanentemente?',()=>alterar(state=>{state[K.co]=state[K.co].filter(c=>c.id!==id);},'Registro excluído.',renderConc));}
function reconcileReceipts(order,sales){
 if(order.sinalVId&&!sales.some(v=>v.id===order.sinalVId)){order.sinal=0;order.sinalVId=null;order.pago=false;}
 if(order.restVId&&!sales.some(v=>v.id===order.restVId)){order.restVId=null;order.pago=false;}
}

// ── 6. VENDAS MANUAIS ──
function calcV(){
 const quantity=Number(gv('vq')),unit=Number(gv('vu'));
 document.getElementById('vt').value=Number.isSafeInteger(quantity)&&quantity>0&&Number.isFinite(unit)&&unit>=0?(quantity*cents(unit)/100).toFixed(2):'';
}
function salvarV(){return alterar(state=>{
 const product=required(gv('vp'),'o produto ou serviço'),qty=quantity(gv('vq'),'Quantidade',1),unit=money(gv('vu'),'Valor unitário');
 const grossCents=qty*cents(unit);if(!Number.isSafeInteger(grossCents))invalid('O total da venda ultrapassa o limite permitido.');const gross=grossCents/100;
 const method=payment(gv('vpg')),category=choice(gv('vcat'),[...APP_CONFIG.categorias_vendas,'Ajuste de caixa']),date=validDate(gv('vd')||hj());
 const name=gv('vc').trim(),client=name?clientFor(state,name,'',gv('vcliente-id')):null;
 state[K.v].unshift({id:uid(),cliente:client?.nome||'',clienteId:client?.id||null,produto:product,categoria:category,qtd:qty,totalBruto:gross,total:calcLiq(gross,method),pgto:method,data:date});
},'Venda salva!',()=>{limV();updDL();renderV();});}

function limV(){document.getElementById('vcliente-id').value='';document.getElementById('vp').value='';document.getElementById('vt').value='';document.getElementById('vc').value='';document.getElementById('vu').value='';document.getElementById('vq').value='1';}

function renderV(){
  const b=gv('fvb').toLowerCase(); 
  let d=(DB.get(K.v)||[]).filter(v=>!b||String(v.cliente||'').toLowerCase().includes(b)||String(v.produto||'').toLowerCase().includes(b));
  d = pagList(d, 'v-pag', 'mudarPagV', 'v');
  const tbv = document.getElementById('tbv');
  if(tbv) {
    tbv.innerHTML=d.length?d.map(v=>`<tr><td>${fd(v.data)}</td><td>${esc(v.cliente)}</td><td>${esc(v.produto)}</td><td>${esc(v.categoria||'-')}</td><td>${esc(v.qtd||1)}</td><td><span class="bj p">${esc(v.pgto||'-')}</span></td><td><b>${(v.totalBruto && v.totalBruto>v.total) ? brlLq(v.totalBruto, v.total) : brl(v.total)}</b></td><td><button class="btn bd sm" data-action="delete-sale" data-id="${esc(v.id)}">🗑️</button></td></tr>`).join(''):'<tr><td colspan="8" style="text-align:center;">Nenhuma venda encontrada</td></tr>';
  }
}

function delV(id){conf('Excluir venda?',()=>alterar(state=>{
 state[K.v]=state[K.v].filter(v=>v.id!==id);
 const detach=order=>{
  if(order.sinalVId===id){order.sinal=0;order.sinalVId=null;order.pago=false;}
  if(order.restVId===id){order.restVId=null;order.pago=false;}
 };
 state[K.p].forEach(detach);
 state[K.co].forEach(item=>{detach(item);if(item.pedOriginal)detach(item.pedOriginal);});
},'Venda excluída.',()=>{renderV();atualizarKanbanEAlertas();}));}

// ── 7. COMPRAS E DESPESAS ──
function salvarC(){return alterar(state=>{
 const description=required(gv('cf'),'a descrição'),value=money(gv('cv'),'Valor');if(value===0)invalid('Informe uma despesa maior que zero.');
 const category=choice(gv('ccat'),[...APP_CONFIG.categorias_despesas,'Ajuste de caixa','Retirada Pessoal','Pró-labore']),method=choice(gv('cpg'),APP_CONFIG.pagamentos_compras),date=validDate(gv('cd')||hj());
 state[K.c].unshift({id:uid(),fornecedor:description,categoria:category,valor:value,pgto:method,data:date});
},'Lançamento salvo!',()=>{limC();renderC();});}

function limC(){document.getElementById('cf').value='';document.getElementById('cv').value='';}
function renderC(){
  const b=gv('fcb').toLowerCase(); 
  let d=(DB.get(K.c)||[]).filter(c=>!b||String(c.fornecedor||'').toLowerCase().includes(b));
  d = pagList(d, 'c-pag', 'mudarPagCom', 'c');
  const tbc2 = document.getElementById('tbc2');
  if(tbc2) {
    tbc2.innerHTML=d.length?d.map(c=>`<tr><td>${fd(c.data)}</td><td>${esc(c.fornecedor)}</td><td>${esc(c.categoria)}</td><td style="color:var(--no);font-weight:700">${brl(c.valor)}</td><td>${esc(c.pgto||'-')}</td><td><button class="btn bd sm" data-action="delete-expense" data-id="${esc(c.id)}">🗑️</button></td></tr>`).join(''):'<tr><td colspan="6" style="text-align:center;">Nenhum lançamento</td></tr>';
  }
}
function delC(id){conf('Excluir lançamento?',()=>alterar(state=>{state[K.c]=state[K.c].filter(x=>x.id!==id);},'Lançamento excluído.',renderC));}

// ── 8. ESTOQUE ──
function salvarE(){return alterar(state=>{
 const name=required(gv('en'),'o nome do item'),qty=quantity(gv('eq'),'Quantidade'),min=quantity(gv('em'),'Quantidade mínima');
 const cost=money(gv('ec'),'Custo',true),price=money(gv('ep2'),'Preço',true),category=choice(gv('ecat'),APP_CONFIG.categorias_estoque);
 state[K.e].unshift({id:uid(),nome:name,categoria:category,qtd:qty,min,custo:cost,preco:price});
},'Item salvo no estoque!',()=>{limE();renderE();});}

function limE(){document.getElementById('en').value='';document.getElementById('eq').value='0';document.getElementById('ec').value='';document.getElementById('ep2').value='';}
function renderE(){
  const b=gv('feb').toLowerCase(); 
  let d=(DB.get(K.e)||[]).filter(e=>!b||String(e.nome||'').toLowerCase().includes(b));
  d = pagList(d, 'e-pag', 'mudarPagE', 'e');
  const tbe = document.getElementById('tbe');
  if(tbe) {
    tbe.innerHTML=d.length?d.map(e=>`<tr><td><strong>${esc(e.nome)}</strong></td><td>${esc(e.categoria||'-')}</td><td style="${e.qtd<=e.min?'color:var(--no);font-weight:700':''}">${esc(e.qtd)}</td><td>${esc(e.min)}</td><td>${brl(e.custo)}</td><td>${brl(e.preco)}</td><td><button class="btn bd sm" data-action="delete-stock" data-id="${esc(e.id)}">🗑️</button></td></tr>`).join(''):'<tr><td colspan="7" style="text-align:center;">Nenhum item</td></tr>';
  }
}
function delE(id){conf('Excluir item?',()=>alterar(state=>{
 if(state[K.co].some(item=>item.estId===id))invalid('Este item possui baixas vinculadas a pedidos arquivados e não pode ser excluído.');
 state[K.e]=state[K.e].filter(x=>x.id!==id);
},'Item excluído.',renderE));}

// ── 9. CLIENTES ──
function salvarCl(){return alterar(state=>{
 const name=required(gv('cln'),'o nome do cliente'),email=gv('cle').trim();
 if(email&&!validEmail(email))invalid('Informe um e-mail válido.');
 const homonyms=state[K.cl].filter(c=>c.nome===name);if(homonyms.length===1)linkLegacyClient(state,homonyms[0]);
 state[K.cl].unshift({id:uid(),nome:name,tel:gv('clt').trim(),cidade:gv('clc').trim(),email});
},'Cliente salvo!',()=>{limCl();updDL();renderCl();});}

function limCl(){document.getElementById('cle').value='';document.getElementById('cln').value='';document.getElementById('clt').value='';document.getElementById('clc').value='';}
function renderCl(){
  const b=gv('fclb').toLowerCase();
  let d=(DB.get(K.cl)||[]).filter(c=>!b||String(c.nome||'').toLowerCase().includes(b)||(c.tel&&String(c.tel).includes(b)));
  d = pagList(d, 'cl-pag', 'mudarPagCl', 'cl');
  const tbcl = document.getElementById('tbcl');
  if(tbcl) {
    tbcl.innerHTML=d.length?d.map(c=>`<tr><td><strong>${esc(c.nome)}</strong></td><td>${esc(c.tel||'-')}</td><td>${esc(c.email||'-')}</td><td>${esc(c.cidade||'-')}</td><td><button class="btn bp sm" data-action="client-history" data-id="${esc(c.id)}">👁️ Histórico</button> <button class="btn bd sm" data-action="delete-client" data-id="${esc(c.id)}">🗑️</button></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;">Nenhum cliente encontrado</td></tr>';
  }
}
function delCl(id){conf('Excluir cliente permanentemente?',()=>alterar(state=>{
 const client=state[K.cl].find(c=>c.id===id);if(!client)invalid('Cliente não encontrado.');
 // Preserve unambiguous legacy associations so a new homonym cannot inherit them.
 if(state[K.cl].filter(c=>c.nome===client.nome).length===1){
  const link=record=>{if(!record.clienteId&&record.cliente===client.nome)record.clienteId=id;};
  state[K.p].forEach(link);state[K.v].forEach(link);state[K.co].forEach(item=>{link(item);if(item.pedOriginal)link(item.pedOriginal);});
 }
 state[K.cl]=state[K.cl].filter(c=>c.id!==id);
},'Cliente excluído.',()=>{updDL();renderCl();}));}
function verHist(id){
 const client=DB.get(K.cl).find(c=>c.id===id);if(!client)return;
 document.getElementById('mhctt').textContent='Histórico: '+client.nome;
 const unique=DB.get(K.cl).filter(c=>c.nome===client.nome).length===1;
 const belongs=record=>record.clienteId?record.clienteId===id:unique&&record.cliente===client.nome;
 const orders=DB.get(K.p).filter(belongs).map(p=>({...p,st:'Em aberto'}));
 const completed=DB.get(K.co).filter(belongs).map(p=>({...p,st:'Concluído',data:p.dataConc}));
 const history=[...orders,...completed].sort((a,b)=>String(b.data||'').localeCompare(String(a.data||'')));
 document.getElementById('history-warning').hidden=unique;
 document.getElementById('tbhc').innerHTML=history.length?history.map(x=>`<tr><td>${fd(x.data)}</td><td>${esc(String(x.desc||'').slice(0,40))}</td><td>${brl(x.valor)}</td><td>${esc(x.st)}</td></tr>`).join(''):'<tr><td colspan="4">Nenhum pedido identificado para este cliente.</td></tr>';
 OM('mhc');
}

// ── 10. RELATÓRIOS FINANCEIROS ──
function setRDates(){const d=new Date();const y=d.getFullYear(),m=(d.getMonth()+1).toString().padStart(2,'0');document.getElementById('rde').value=`${y}-${m}-01`;document.getElementById('rat').value=hj();}
function gerarR(reset = true){
  if(reset) cp.r = 1;
  const de=gv('rde'),at=gv('rat'); if(!de||!at)return;
  try{validDate(de);validDate(at);if(de>at)invalid('A data inicial deve ser anterior ou igual à data final.');}catch(error){toast(error.userMessage||'Informe datas válidas.',true);return;}
  const vs=(DB.get(K.v)||[]).filter(v=>v.data>=de&&v.data<=at);
  const cs=(DB.get(K.c)||[]).filter(c=>c.data>=de&&c.data<=at);
  
  const fat = vs.filter(v => v.categoria !== 'Ajuste de caixa').reduce((a,b)=>a+cents(b.total),0)/100;
  const custosLoja = cs.filter(c=>!['Retirada Pessoal','Pró-labore', 'Ajuste de caixa'].includes(c.categoria)).reduce((a,b)=>a+cents(b.valor),0)/100;
  const retiradas = cs.filter(c=>['Retirada Pessoal','Pró-labore'].includes(c.categoria)).reduce((a,b)=>a+cents(b.valor),0)/100;
  
  const ajustesPos = vs.filter(v => v.categoria === 'Ajuste de caixa').reduce((a,b)=>a+cents(b.total),0)/100;
  const ajustesNeg = cs.filter(c => c.categoria === 'Ajuste de caixa').reduce((a,b)=>a+cents(b.valor),0)/100;

  const lucroNegocio = fat - custosLoja;
  const saldoFinal = (lucroNegocio + ajustesPos) - (retiradas + ajustesNeg);

  sv('rrv',brl(fat)); sv('rrc',brl(custosLoja)); sv('rrr',brl(retiradas)); sv('rrl',brl(lucroNegocio));
  const sEl=document.getElementById('rrs'); if(sEl) { sEl.textContent=brl(saldoFinal); sEl.style.color=saldoFinal>=0?'var(--ok)':'var(--no)'; }

  let movs=[...vs.map(x=>({d:x.data,t:'Venda',desc:x.produto,v:x.total,b:x.totalBruto,s:1,pg:x.pgto, cat:x.categoria})),...cs.map(x=>({d:x.data,t:x.categoria,desc:x.fornecedor,v:x.valor,b:x.valor,s:-1,pg:x.pgto, cat:x.categoria}))].sort((a,b)=>b.d.localeCompare(a.d));
  
  movs = pagList(movs, 'r-pag', 'mudarPagR', 'r');
  const tbrv = document.getElementById('tbrv');
  if(tbrv) {
    tbrv.innerHTML=movs.length?movs.map(m=>`<tr><td>${fd(m.d)}</td><td><span class="bj ${m.s>0?'g':((m.t||'').includes('Retirada')||(m.t||'').includes('Pró-labore')?'o':'r')}">${esc(m.cat==='Ajuste de caixa'?'Ajuste de Caixa':m.t||'Geral')}</span></td><td>${esc(m.desc||'-')}</td><td>${esc(m.pg||'-')}</td><td style="font-weight:700;color:${m.s>0?'var(--ok)':'var(--no)'}">${m.s>0?'+':'-'} ${(m.b&&m.b>m.v)?brlLq(m.b,m.v):brl(m.v)}</td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;">Sem dados no período</td></tr>';
  }
}


// Record IDs and names are data, never inline JavaScript.
document.addEventListener('click',event=>{
 const target=event.target.closest('[data-action]');if(!target)return;
 const actions={'delete-sale':delV,'delete-expense':delC,'delete-stock':delE,'undo-order':desfazerConc,'delete-completed':delConc,'delete-client':delCl,'client-history':verHist,'delete-column':delCol};
 if(target.dataset.action==='copy-phone'){event.stopPropagation();copiarTexto(event,target.dataset.phone);return;}
 actions[target.dataset.action]?.(target.dataset.id);
});
document.addEventListener('dblclick',event=>{const target=event.target.closest('[data-rename-col]');if(target)abrRnc(target.dataset.renameCol);});
auth.onAuthStateChanged(user=>{
 if(user) iniciarApp();
 else {clearSession();document.getElementById('loader').classList.add('off');document.getElementById('app-container').style.display='none';document.getElementById('login-screen').style.display='flex';}
});

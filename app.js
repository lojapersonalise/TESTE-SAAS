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
  document.title = APP_CONFIG.nome_sistema;

  const setOpts = (id, arr) => { const el = document.getElementById(id); if(el) el.innerHTML = arr.map(i => `<option>${i}</option>`).join(''); };
  
  // Injeta "Ajuste de caixa" nas Vendas
  let vcatOpts = APP_CONFIG.categorias_vendas.map(i => `<option>${i}</option>`).join('');
  vcatOpts += `<option style="color:var(--in); font-weight:bold;">Ajuste de caixa</option>`;
  const elVcat = document.getElementById('vcat');
  if(elVcat) elVcat.innerHTML = vcatOpts;

  setOpts('ecat', APP_CONFIG.categorias_estoque);
  
  // Injeta "Ajuste de caixa", "Retirada" e "Pró-labore" nas Compras
  let ccatOpts = APP_CONFIG.categorias_despesas.map(i => `<option>${i}</option>`).join('');
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

auth.onAuthStateChanged(user => {
  if (user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    iniciarApp();
  } else {
    document.getElementById('loader').classList.add('off');
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  }
});

function fazerLogin() {
  const email = document.getElementById('log-email').value;
  const pass = document.getElementById('log-pass').value;
  const err = document.getElementById('login-error');
  err.style.display = 'none';
  if(!email || !pass) { err.textContent = "Preencha e-mail e senha."; err.style.display = 'block'; return; }
  auth.signInWithEmailAndPassword(email, pass).catch(e => {
    err.textContent = "Erro: E-mail ou senha incorretos.";
    err.style.display = 'block';
  });
}
function fazerLogout() { auth.signOut(); }

const K = {p:'pedidos', co:'concluidos', col:'colunas', v:'vendas', c:'compras', e:'estoque', cl:'clientes'};
let MEM = { [K.p]:[], [K.co]:[], [K.col]:[], [K.v]:[], [K.c]:[], [K.e]:[], [K.cl]:[] };

const ITEMS_PER_PAGE = 5;
let cp = { co:1, v:1, c:1, e:1, cl:1, r:1 }; 
let activeFilter = null; 
let kbQ = '';

const DB = {
  get: k => MEM[k] || [],
  set: (k, v) => {
    MEM[k] = v;
    if(auth.currentUser) {
      fbDB.collection('banco_personalise').doc(k).set({ lista: v }).catch(e => {
          toast("Aviso: Falha ao salvar na nuvem.", true);
      });
    }
  }
};

function getCols(){
  const c = DB.get(K.col);
  if(c && c.length) return c;
  const d = [{id:'c0',nome:'Novo Pedido',fixa:true}, {id:'c1',nome:'Produção',fixa:false}];
  DB.set(K.col, d);
  return d;
}

let firstLoad = true;
async function iniciarApp() {
  document.getElementById('loader').classList.remove('off'); 
  let loaded = 0;
  const keys = Object.values(K);
  
  keys.forEach(k => {
    fbDB.collection('banco_personalise').doc(k).onSnapshot((docSnap) => {
      if(docSnap.exists) {
          MEM[k] = docSnap.data().lista || [];
      } else {
          if(k === K.col) {
              MEM[k] = [{id:'c0',nome:'Novo Pedido',fixa:true}, {id:'c1',nome:'Produção',fixa:false}];
              if(auth.currentUser) fbDB.collection('banco_personalise').doc(k).set({ lista: MEM[k] });
          } else {
              MEM[k] = [];
          }
      }
      
      if(firstLoad) {
          loaded++;
          if(loaded === keys.length) {
              updDL(); 
              document.getElementById('loader').classList.add('off');
              goTo(1); 
              initDragToScroll(); 
              toast("✅ Conectado com sucesso!");
              firstLoad = false;
          }
      } else {
          if (!docSnap.metadata.hasPendingWrites) atualizarTelaAtual();
      }
    }, (erro) => {
      if(firstLoad) document.getElementById('loader').innerHTML = `<h2 style="color:var(--no)">⚠️ Erro de Permissão</h2>`;
    });
  });
}

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
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2);
const brl=v=>'R$ '+Number(v||0).toFixed(2).replace('.',',');
const hj=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10);};
function fd(d){if(!d)return'–';const[y,m,day]=d.split('-');return`${day}/${m}/${y}`;}
const isL=d=>d&&d<hj();
const isT=d=>d===hj();
function gv(id){const e=document.getElementById(id);return e?e.value:''}
function sv(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function toast(m,e=false){const t=document.getElementById('toast');t.textContent=m;t.style.background=e?'var(--no)':'var(--pd)';t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2700);}
function CM(id){document.getElementById(id).classList.remove('on')}
function OM(id){document.getElementById(id).classList.add('on')}
function conf(m,cb){document.getElementById('cfm').textContent=m;OM('mcf');document.getElementById('cfo').onclick=()=>{cb();CM('mcf')}}

function calcLiq(val, pgto) {
    let v = Number(val);
    if(pgto === 'Débito') return v * (1 - APP_CONFIG.taxas.debito / 100);       
    if(pgto === 'Crédito') return v * (1 - APP_CONFIG.taxas.credito / 100);     
    if(pgto === 'Compra Online') return v * (1 - APP_CONFIG.taxas.online / 100);
    return v;
}

function brlLq(bruto, liq) {
    if(bruto > liq) return `<del style="color:#999;font-size:0.7rem">${brl(bruto)}</del><br><span style="color:var(--ok)">${brl(liq)}</span>`;
    return brl(liq);
}

function pagList(lista, idPag, funcMudar, arrKey) {
    let b = document.getElementById(idPag);
    if(!b) return lista;
    if(lista.length <= ITEMS_PER_PAGE) { b.innerHTML = ''; return lista; }
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
    const cls=DB.get(K.cl) || [];
    ['vcl','ifcl'].forEach(id=>{
        const d=document.getElementById(id);
        if(d) d.innerHTML=cls.map(c=>`<option value="${c.nome}">`).join('');
    });
}
function copiarTexto(e,t){ e.stopPropagation(); navigator.clipboard.writeText(t).then(()=>toast('📋 Copiado!')) }
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

function autoFillTel() {
    const nomeDigitado = gv('ifc').trim().toLowerCase();
    if (!nomeDigitado) { document.getElementById('ift').value = ''; return; } 
    const cls = DB.get(K.cl) || [];
    const ex = cls.find(c => c.nome.toLowerCase() === nomeDigitado);
    if (ex && ex.tel) { document.getElementById('ift').value = ex.tel; }
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
  const ent=vH.reduce((a,v)=>a+Number(v.total||0),0),sai=cH.reduce((a,c)=>a+Number(c.valor||0),0),sal=ent-sai;
  
  // DADOS TOTAIS (HISTÓRICO COMPLETO PARA O SALDO GERAL)
  const allVendas = vs.filter(v => v.categoria !== 'Ajuste de caixa').reduce((a,b)=>a+Number(b.total),0);
  const allAjustesPos = vs.filter(v => v.categoria === 'Ajuste de caixa').reduce((a,b)=>a+Number(b.total),0);
  const allCustos = cs.filter(c=>!['Retirada Pessoal','Pró-labore','Ajuste de caixa'].includes(c.categoria)).reduce((a,b)=>a+Number(b.valor),0);
  const allRetiradas = cs.filter(c=>['Retirada Pessoal','Pró-labore'].includes(c.categoria)).reduce((a,b)=>a+Number(b.valor),0);
  const allAjustesNeg = cs.filter(c => c.categoria === 'Ajuste de caixa').reduce((a,b)=>a+Number(b.valor),0);

  const saldoGeral = (allVendas + allAjustesPos) - (allCustos + allRetiradas + allAjustesNeg);

  // LÓGICA DA GAVETA (TODO O DINHEIRO FÍSICO DA LOJA + AJUSTES EM DINHEIRO)
  const entDinheiro = vs.filter(v => v.pgto === 'Dinheiro').reduce((a,b) => a + Number(b.total), 0);
  const saiDinheiro = cs.filter(c => c.pgto === 'Dinheiro').reduce((a,b) => a + Number(b.valor), 0);
  const saldoDinheiro = entDinheiro - saiDinheiro;

  // DADOS DO MÊS ATUAL
  const vM=vs.filter(v=>v.data.startsWith(mes)), cM=cs.filter(c=>c.data.startsWith(mes));
  
  const fatM = vM.filter(v => v.categoria !== 'Ajuste de caixa').reduce((a,b)=>a+Number(b.total),0);
  const custosM = cM.filter(c=>!['Retirada Pessoal','Pró-labore','Ajuste de caixa'].includes(c.categoria)).reduce((a,b)=>a+Number(b.valor),0);
  const retiradasM = cM.filter(c=>['Retirada Pessoal','Pró-labore'].includes(c.categoria)).reduce((a,b)=>a+Number(b.valor),0);
  const ajustesPosM = vM.filter(v => v.categoria === 'Ajuste de caixa').reduce((a,b)=>a+Number(b.total),0);
  const ajustesNegM = cM.filter(c => c.categoria === 'Ajuste de caixa').reduce((a,b)=>a+Number(b.valor),0);

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
      CHS['ch1']=new Chart(elCh1.getContext('2d'),{type:'bar',data:{labels:lbM,datasets:[{label:'Vendas Líquidas',data:ms.map(m=>(DB.get(K.v)||[]).filter(v=>v.data.startsWith(m) && v.categoria !== 'Ajuste de caixa').reduce((a,v)=>a+Number(v.total||0),0)),backgroundColor:APP_CONFIG.tema.p,borderRadius:4},{label:'Custos Loja',data:ms.map(m=>(DB.get(K.c)||[]).filter(c=>c.data.startsWith(m)&&!['Retirada Pessoal','Pró-labore','Ajuste de caixa'].includes(c.categoria)).reduce((a,c)=>a+Number(c.valor||0),0)),backgroundColor:'#c62828',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false}});
  }
  
  const cats={};vs.filter(v=>v.categoria!=='Ajuste de caixa').forEach(v=>{const c=v.categoria||'Outros';cats[c]=(cats[c]||0)+Number(v.total||0);});
  if(CHS['ch2'])CHS['ch2'].destroy();
  const elCh2 = document.getElementById('ch2');
  if(elCh2) {
      CHS['ch2']=new Chart(elCh2.getContext('2d'),{type:'pie',data:{labels:Object.keys(cats),datasets:[{data:Object.values(cats),backgroundColor:[APP_CONFIG.tema.p, APP_CONFIG.tema.pd, APP_CONFIG.tema.pl, APP_CONFIG.tema.bor, '#c9a0e0','#3f51b5']}]},options:{responsive:true,maintainAspectRatio:false}});
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

function renderKB(){
  const board=document.getElementById('kb'); 
  if(!board) return;
  const cols=getCols(); const ps=DB.get(K.p)||[]; board.innerHTML='';
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
    
    if(kbQ) cards=cards.filter(p=>p.cliente.toLowerCase().includes(kbQ)||p.desc.toLowerCase().includes(kbQ));

    const tot=cards.reduce((a,p)=>a+Number(p.valor||0),0);
    const ce=document.createElement('div'); ce.className='kc'; ce.dataset.colId=col.id;
    ce.innerHTML=`<div class="kch"><span class="cn${!col.fixa?' ed':''}" ${!col.fixa?`ondblclick="abrRnc('${col.id}')"`:''}>${col.nome}</span><div class="cm2"><span class="cb">${cards.length}</span>${tot>0?`<span class="ct">${brl(tot)}</span>`:''} <button class="bc" style="${col.fixa?'display:none':''}" onclick="delCol('${col.id}')">✕</button></div></div>`;
    const body=document.createElement('div'); body.className='kcb'; body.dataset.colId=col.id;
    
    cards.forEach(p=>{
      const el=document.createElement('div'); el.className=`kd ${p.entregue?'eg':''} ${p.pago?'k-pago':''}`; el.dataset.id=p.id;
      const rest=Number(p.valor||0)-Number(p.sinal||0);
      const telH=p.tel?`<div class="k-tel" onmousedown="event.stopPropagation()" onclick="copiarTexto(event,'${p.tel}')">📱 ${p.tel}</div>`:'';
      el.innerHTML=`<div class="kt"><div style="display:flex;flex-direction:column;"><span class="kn">${p.cliente}</span>${telH}</div><span class="kv">${brl(p.valor)}</span></div><div class="kdc">${p.desc}</div><div class="kft"><span>${p.entrega?'📅 '+fd(p.entrega):''}</span><div>${p.pago?'<span class="tg2 t-pago">✅ Pago</span>':(rest>0?`<span class="tg2 pn">💳 ${brl(rest)}</span>`:'')}</div></div>`;
      el.onclick=()=>abrModal(p.id); body.appendChild(el);
    });
    ce.appendChild(body); board.appendChild(ce);
  });
  const btn=document.createElement('button');btn.className='bnc';btn.innerHTML='+';btn.onclick=()=>{document.getElementById('ncn').value='';OM('mnc');};board.appendChild(btn);

  new Sortable(board,{animation:150,draggable:'.kc',handle:'.kch',filter:'.bc',ghostClass:'sortable-ghost',onEnd:evt=>{
    const ids=Array.from(board.querySelectorAll('.kc')).map(el=>el.dataset.colId);
    const old=getCols(); const nw=ids.map(id=>old.find(c=>c.id===id)).filter(Boolean); DB.set(K.col,nw);
  }});
  document.querySelectorAll('.kcb').forEach(el=>new Sortable(el,{group:'kanban',animation:150,ghostClass:'sortable-ghost',onEnd:evt=>{
    const pId=evt.item.dataset.id; const toId=evt.to.dataset.colId; const ps=DB.get(K.p); const i=ps.findIndex(p=>p.id===pId);
    if(i!==-1&&ps[i].colId!==toId){ps[i].colId=toId; DB.set(K.p,ps)}
  }}));
}

function filtKB(){ renderKB(); }
function stab(show,hide,el){
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('on'));el.classList.add('on');
  document.getElementById(show).style.display='block';document.getElementById(hide).style.display='none';
  if(show==='cs')renderConc();
}

function addCard(){
  let cli=gv('ifc').trim(), desc=gv('ifd').trim(), tel=gv('ift').trim();
  let valTotal = Number(gv('ifv')||0), sinalVal = Number(gv('ifs')||0);
  let sinalPgto = gv('ifspg');
  if(!cli||!desc) return toast("Preencha cliente e descrição!", true);
  
  const cls=DB.get(K.cl)||[]; let cleanTel=tel.replace(/\D/g,'');
  let ex=cleanTel?cls.find(c=>c.tel&&c.tel.replace(/\D/g,'')===cleanTel):cls.find(c=>c.nome.toLowerCase()===cli.toLowerCase());
  if(ex) cli=ex.nome;
  else { cls.unshift({id:uid(),nome:cli,tel:tel,cidade:''}); DB.set(K.cl,cls); updDL(); }
  
  let sVId = null;
  if(sinalVal > 0) {
      sVId = 'v_' + uid();
      let liq = calcLiq(sinalVal, sinalPgto);
      const vs = DB.get(K.v) || [];
      vs.unshift({id: sVId, cliente: cli, produto: 'Sinal - ' + desc, categoria: 'Vendas', qtd: 1, totalBruto: sinalVal, total: liq, pgto: sinalPgto, data: hj()});
      DB.set(K.v, vs);
  }

  const ps=DB.get(K.p)||[]; 
  ps.unshift({
      id:uid(), colId:getCols()[0].id, cliente:cli, desc:desc, valor:valTotal, sinal:sinalVal, tel:tel, 
      entrega:gv('ife') || null, data:hj(), pago:false, entregue:false, sinalVId: sVId || null, restVId: null
  });
  DB.set(K.p,ps);
  
  document.getElementById('ifc').value='';document.getElementById('ifd').value='';document.getElementById('ifv').value='';document.getElementById('ifs').value='';document.getElementById('ift').value='';document.getElementById('ife').value='';
  CM('mnp'); atualizarKanbanEAlertas(); toast("Pedido Adicionado!");
}

let actPed=null,edColId=null;
function abrModal(id){
  actPed=id; const p=DB.get(K.p).find(x=>x.id===id); if(!p) return;
  let num=p.tel?p.tel.replace(/\D/g,''):'';
  let wa=num.length>=10?`<a href="https://wa.me/55${num}" target="_blank" style="background:#25D366;color:#fff;padding:3px 10px;border-radius:10px;text-decoration:none;font-size:0.7rem;font-weight:bold;margin-left:10px;">💬 WhatsApp</a>`:'';
  document.getElementById('mpif').innerHTML=`<div style="font-weight:bold;font-size:1.05rem;color:var(--pd);margin-bottom:6px;display:flex;align-items:center;">${p.cliente} ${wa}</div><strong>Descrição:</strong> ${p.desc}`;
  sv('mptot',brl(p.valor)); sv('mpsin',brl(p.sinal)); sv('mprest',brl(Number(p.valor)-Number(p.sinal)));
  
  document.getElementById('mppg').checked=!!p.pago; document.getElementById('mpeg').checked=!!p.entregue;
  OM('mped');
}

function togF(f){
  const ps=DB.get(K.p); const i=ps.findIndex(p=>p.id===actPed); if(i===-1)return;
  const isC=document.getElementById(f==='pago'?'mppg':'mpeg').checked;
  let p = ps[i];
  
  if(f === 'pago') {
      if(isC && !p.pago) {
          let restB = Number(p.valor||0) - Number(p.sinal||0);
          if(restB > 0) {
              let rId = 'v_' + uid();
              let pgtoMetodo = gv('mppg_met');
              let restL = calcLiq(restB, pgtoMetodo);
              const vs = DB.get(K.v) || [];
              vs.unshift({id: rId, cliente: p.cliente, produto: 'Restante - ' + p.desc, categoria: 'Vendas', qtd: 1, totalBruto: restB, total: restL, pgto: pgtoMetodo, data: hj()});
              DB.set(K.v, vs);
              p.restVId = rId;
          }
      } else if (!isC && p.pago) {
          if(p.restVId) {
              let vs = DB.get(K.v) || [];
              vs = vs.filter(v => v.id !== p.restVId);
              DB.set(K.v, vs);
              p.restVId = null;
          }
      }
  }

  p[f]=isC; DB.set(K.p,ps); abrModal(actPed); atualizarKanbanEAlertas();
  if(f==='pago'&&activeFilter==='pagamento'&&isC) toast('Pago! (Ocultado dos devedores)');
  else if(f==='entregue'&&(activeFilter==='hoje'||activeFilter==='atraso')&&isC) toast('Entregue! (Ocultado das pendências)');
  else toast('Status atualizado!');
}

function delPA(){
    CM('mped');
    conf('Excluir pedido definitivamente?',()=>{
        const ps=DB.get(K.p); const p=ps.find(x=>x.id===actPed);
        if(p) {
            let vs = DB.get(K.v) || [];
            if(p.sinalVId) vs = vs.filter(v => v.id !== p.sinalVId);
            if(p.restVId) vs = vs.filter(v => v.id !== p.restVId);
            DB.set(K.v, vs);
        }
        DB.set(K.p,DB.get(K.p).filter(p=>p.id!==actPed));
        atualizarKanbanEAlertas(); toast('Excluído!');
    });
}

function editPA(){
  const p=DB.get(K.p).find(x=>x.id===actPed);if(!p)return;
  document.getElementById('epc').value=p.cliente;document.getElementById('ept').value=p.tel||'';document.getElementById('epe').value=p.entrega||'';document.getElementById('epv').value=p.valor;document.getElementById('eps').value=p.sinal||0;document.getElementById('epd').value=p.desc;
  
  let sMet = 'PIX';
  if(p.sinalVId) {
      let v = (DB.get(K.v)||[]).find(x=>x.id===p.sinalVId);
      if(v) sMet = v.pgto;
  }
  document.getElementById('epspg').value = sMet;

  CM('mped');OM('mep');
}

function salvarEd(){
  const cli=gv('epc').trim(),desc=gv('epd').trim();if(!cli||!desc)return toast('Preencha os campos!',true);
  const ps=DB.get(K.p);const i=ps.findIndex(p=>p.id===actPed);if(i===-1)return;
  let p = ps[i];
  let novoSinalB = Number(gv('eps')||0);
  let novoValor = Number(gv('epv')||0);
  let sinalPgto = gv('epspg');
  let novoSinalL = calcLiq(novoSinalB, sinalPgto);
  
  let vs = DB.get(K.v) || [];
  if(p.sinalVId) {
      let vi = vs.findIndex(v => v.id === p.sinalVId);
      if(vi !== -1) { vs[vi].totalBruto = novoSinalB; vs[vi].total = novoSinalL; vs[vi].cliente = cli; vs[vi].produto = 'Sinal - ' + desc; vs[vi].pgto = sinalPgto; }
  } else if (novoSinalB > 0) {
      p.sinalVId = 'v_' + uid();
      vs.unshift({id: p.sinalVId, cliente: cli, produto: 'Sinal - ' + desc, categoria: 'Vendas', qtd: 1, totalBruto: novoSinalB, total: novoSinalL, pgto: sinalPgto, data: hj()});
  }
  
  if(p.restVId) {
      let vi = vs.findIndex(v => v.id === p.restVId);
      if(vi !== -1) { 
          let calcRestB = novoValor - novoSinalB;
          vs[vi].totalBruto = calcRestB; 
          vs[vi].total = calcLiq(calcRestB, vs[vi].pgto); 
          vs[vi].cliente = cli; vs[vi].produto = 'Restante - ' + desc; 
      }
  }
  DB.set(K.v, vs);

  ps[i]={...p,cliente:cli,tel:gv('ept').trim(),entrega:gv('epe')||null,valor:novoValor,sinal:novoSinalB,desc};
  DB.set(K.p,ps);CM('mep');atualizarKanbanEAlertas();toast('Editado!');
}

function criarCol(){const n=gv('ncn').trim();if(n){const c=getCols();c.push({id:'c'+uid(),nome:n,fixa:false});DB.set(K.col,c);CM('mnc');atualizarKanbanEAlertas();}}
function abrRnc(id){edColId=id;const col=getCols().find(c=>c.id===id);document.getElementById('rcn').value=col?col.nome:'';OM('mrc');}
function renCol(){const n=gv('rcn').trim();if(n&&edColId){const c=getCols();const i=c.findIndex(x=>x.id===edColId);if(i!==-1)c[i].nome=n;DB.set(K.col,c);CM('mrc');atualizarKanbanEAlertas();}}
function delCol(id){if(DB.get(K.p).some(p=>(p.colId||getCols()[0].id)===id))return toast('Mova os pedidos antes!',true);conf('Excluir coluna?',()=>{DB.set(K.col,getCols().filter(c=>c.id!==id));atualizarKanbanEAlertas();});}

function abrirLV(){
  const p=DB.get(K.p).find(x=>x.id===actPed); if(!p) return;
  const sel=document.getElementById('lvest');
  sel.innerHTML=`<option value="">— Não abater —</option>`+(DB.get(K.e)||[]).map(e=>`<option value="${e.id}">${e.nome}</option>`).join('');
  document.getElementById('lvqw').style.display='none';
  document.getElementById('lvq').value='1';
  CM('mped'); OM('mlv');
}

function confLV(){
  const ps=DB.get(K.p); const i=ps.findIndex(p=>p.id===actPed); if(i===-1)return; const ped=ps[i];
  
  if(!ped.pago) {
     let restB = Number(ped.valor||0) - Number(ped.sinal||0);
     if(restB > 0) {
         ped.restVId = 'v_' + uid();
         let restL = restB; 
         const vs = DB.get(K.v) || [];
         vs.unshift({id: ped.restVId, cliente: ped.cliente, produto: 'Restante - ' + ped.desc, categoria: 'Vendas', qtd: 1, totalBruto: restB, total: restL, pgto: 'Dinheiro', data: hj()});
         DB.set(K.v, vs);
     }
     ped.pago = true;
  }

  const estId=gv('lvest'); let qtdAbatida = 0;
  if(estId){
      qtdAbatida = Number(gv('lvq')||1);
      const es=DB.get(K.e);const ei=es.findIndex(e=>e.id===estId);
      if(ei!==-1){es[ei].qtd=Math.max(0,es[ei].qtd-qtdAbatida);DB.set(K.e,es);}
  }
  
  const co=DB.get(K.co)||[]; 
  co.unshift({
      id:uid(),cliente:ped.cliente,desc:ped.desc,valor:ped.valor,dataConc:hj(), 
      sinalVId: ped.sinalVId || null, restVId: ped.restVId || null, 
      pedOriginal: ped, estId: estId || null, qtdEst: qtdAbatida || 0
  });
  
  DB.set(K.co,co); ps.splice(i,1); DB.set(K.p,ps); CM('mlv'); atualizarKanbanEAlertas(); toast("✅ Pedido Finalizado e Arquivado!");
}

function renderConc(){
  const b=gv('fc0').toLowerCase(); 
  let d=(DB.get(K.co)||[]).filter(c=>!b||c.cliente.toLowerCase().includes(b));
  d = pagList(d, 'cs-pag', 'mudarPagC', 'co');
  const tbc = document.getElementById('tbc');
  if(tbc) {
    tbc.innerHTML=d.length?d.map(c=>`<tr><td>${fd(c.dataConc)}</td><td><strong>${c.cliente}</strong></td><td>${(c.desc||'').slice(0,55)}</td><td style="color:var(--ok);font-weight:700">${brl(c.valor)}</td>
    <td><button class="btn bw sm" title="Desfazer e voltar ao Kanban" onclick="desfazerConc('${c.id}')">↩️</button> <button class="btn bd sm" title="Apagar definitivamente" onclick="delConc('${c.id}')">🗑️</button></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;">Nenhum concluído</td></tr>';
  }
}

function desfazerConc(id) {
    conf('Desfazer conclusão? O pedido voltará para o Kanban.', () => {
        const co = DB.get(K.co) || [];
        const idx = co.findIndex(c => c.id === id);
        if (idx === -1) return;
        const item = co[idx];
        
        const ps = DB.get(K.p) || [];
        if(item.pedOriginal) { ps.unshift(item.pedOriginal); } 
        else { ps.unshift({id: uid(), colId: getCols()[0].id, cliente: item.cliente, desc: item.desc, valor: item.valor, sinal: 0, tel: '', entrega: null, data: hj(), pago: true, entregue: false, sinalVId: null, restVId: null}); }
        DB.set(K.p, ps);
        
        if(item.estId) {
            let es = DB.get(K.e) || []; let ei = es.findIndex(e => e.id === item.estId);
            if(ei !== -1) { es[ei].qtd += (item.qtdEst || 1); DB.set(K.e, es); }
        }
        
        co.splice(idx, 1); DB.set(K.co, co); renderConc(); toast('✅ Restaurado para o Kanban!');
    });
}

function delConc(id){conf('Excluir registro permanentemente?',()=>{DB.set(K.co,DB.get(K.co).filter(x=>x.id!==id));renderConc();toast('Excluído!');});}

// ── 6. VENDAS MANUAIS ──
function calcV(){document.getElementById('vt').value=(Number(gv('vu')||0)*Number(gv('vq')||1)).toFixed(2);}
function salvarV(){
  const p=gv('vp').trim();if(!p)return toast('Preencha o produto!',true);
  const vs=DB.get(K.v)||[];
  let bruto = Number(gv('vt')||0); let pg = gv('vpg');
  let liq = calcLiq(bruto, pg);
  vs.unshift({id:uid(),cliente:gv('vc').trim(),produto:p,categoria:gv('vcat'),qtd:Number(gv('vq')||1),totalBruto:bruto, total:liq, pgto:pg, data:gv('vd')||hj()});
  DB.set(K.v,vs); limV(); renderV(); toast('Venda salva!');
}
function limV(){document.getElementById('vp').value='';document.getElementById('vt').value='';document.getElementById('vc').value='';document.getElementById('vu').value='';document.getElementById('vq').value='1';}

function renderV(){
  const b=gv('fvb').toLowerCase(); 
  let d=(DB.get(K.v)||[]).filter(v=>!b||v.cliente.toLowerCase().includes(b)||v.produto.toLowerCase().includes(b));
  d = pagList(d, 'v-pag', 'mudarPagV', 'v');
  const tbv = document.getElementById('tbv');
  if(tbv) {
    tbv.innerHTML=d.length?d.map(v=>`<tr><td>${fd(v.data)}</td><td>${v.cliente}</td><td>${v.produto}</td><td>${v.categoria||'-'}</td><td>${v.qtd||1}</td><td><span class="bj p">${v.pgto||'-'}</span></td><td><b>${(v.totalBruto && v.totalBruto>v.total) ? brlLq(v.totalBruto, v.total) : brl(v.total)}</b></td><td><button class="btn bd sm" onclick="delV('${v.id}')">🗑️</button></td></tr>`).join(''):'<tr><td colspan="8" style="text-align:center;">Nenhuma venda encontrada</td></tr>';
  }
}

function delV(id){
    conf('Excluir venda?',()=>{
        let ps = DB.get(K.p) || [];
        let mod = false;
        ps.forEach(p => {
            if(p.sinalVId === id) { p.sinal = 0; p.sinalVId = null; mod = true; }
            if(p.restVId === id) { p.pago = false; p.restVId = null; mod = true; }
        });
        if(mod) { DB.set(K.p, ps); atualizarKanbanEAlertas(); }

        DB.set(K.v,DB.get(K.v).filter(x=>x.id!==id));
        renderV(); toast('Venda excluída!');
    });
}

// ── 7. COMPRAS E DESPESAS ──
function salvarC(){
  const f=gv('cf').trim();if(!f)return toast('Descrição obrigatória!',true);
  const cs=DB.get(K.c)||[];
  cs.unshift({id:uid(),fornecedor:f,categoria:gv('ccat'),valor:Number(gv('cv')||0),pgto:gv('cpg'),data:gv('cd')||hj()});
  DB.set(K.c,cs); limC(); renderC(); toast('Lançamento salvo!');
}
function limC(){document.getElementById('cf').value='';document.getElementById('cv').value='';}
function renderC(){
  const b=gv('fcb').toLowerCase(); 
  let d=(DB.get(K.c)||[]).filter(c=>!b||c.fornecedor.toLowerCase().includes(b));
  d = pagList(d, 'c-pag', 'mudarPagCom', 'c');
  const tbc2 = document.getElementById('tbc2');
  if(tbc2) {
    tbc2.innerHTML=d.length?d.map(c=>`<tr><td>${fd(c.data)}</td><td>${c.fornecedor}</td><td>${c.categoria}</td><td style="color:var(--no);font-weight:700">${brl(c.valor)}</td><td>${c.pgto||'-'}</td><td><button class="btn bd sm" onclick="delC('${c.id}')">🗑️</button></td></tr>`).join(''):'<tr><td colspan="6" style="text-align:center;">Nenhum lançamento</td></tr>';
  }
}
function delC(id){conf('Excluir lançamento?',()=>{DB.set(K.c,DB.get(K.c).filter(x=>x.id!==id));renderC();});}

// ── 8. ESTOQUE ──
function salvarE(){
  const n=gv('en').trim();if(!n)return toast('Item obrigatório!',true);
  const es=DB.get(K.e)||[];
  es.unshift({id:uid(),nome:n,categoria:gv('ecat'),qtd:Number(gv('eq')||0),min:Number(gv('em')||0),custo:Number(gv('ec')||0),preco:Number(gv('ep2')||0)});
  DB.set(K.e,es); limE(); renderE(); toast('Item salvo no estoque!');
}
function limE(){document.getElementById('en').value='';document.getElementById('eq').value='0';document.getElementById('ec').value='';document.getElementById('ep2').value='';}
function renderE(){
  const b=gv('feb').toLowerCase(); 
  let d=(DB.get(K.e)||[]).filter(e=>!b||e.nome.toLowerCase().includes(b));
  d = pagList(d, 'e-pag', 'mudarPagE', 'e');
  const tbe = document.getElementById('tbe');
  if(tbe) {
    tbe.innerHTML=d.length?d.map(e=>`<tr><td><strong>${e.nome}</strong></td><td>${e.categoria||'-'}</td><td style="${e.qtd<=e.min?'color:var(--no);font-weight:700':''}">${e.qtd}</td><td>${e.min}</td><td>${brl(e.custo)}</td><td>${brl(e.preco)}</td><td><button class="btn bd sm" onclick="delE('${e.id}')">🗑️</button></td></tr>`).join(''):'<tr><td colspan="7" style="text-align:center;">Nenhum item</td></tr>';
  }
}
function delE(id){conf('Excluir item?',()=>{DB.set(K.e,DB.get(K.e).filter(x=>x.id!==id));renderE();});}

// ── 9. CLIENTES ──
function salvarCl(){
  const n=gv('cln').trim();if(!n)return toast('Nome obrigatório!',true);
  const cls=DB.get(K.cl)||[];
  cls.unshift({id:uid(),nome:n,tel:gv('clt').trim(),cidade:gv('clc').trim()});
  DB.set(K.cl,cls); limCl(); renderCl(); toast('Cliente salvo!');
}
function limCl(){document.getElementById('cln').value='';document.getElementById('clt').value='';document.getElementById('clc').value='';}
function renderCl(){
  const b=gv('fclb').toLowerCase();
  let d=(DB.get(K.cl)||[]).filter(c=>!b||c.nome.toLowerCase().includes(b)||(c.tel&&c.tel.includes(b)));
  d = pagList(d, 'cl-pag', 'mudarPagCl', 'cl');
  const tbcl = document.getElementById('tbcl');
  if(tbcl) {
    tbcl.innerHTML=d.length?d.map(c=>`<tr><td><strong>${c.nome}</strong></td><td>${c.tel||'-'}</td><td>${c.cidade||'-'}</td><td><button class="btn bp sm" onclick="verHist('${c.nome}')">👁️ Histórico</button> <button class="btn bd sm" onclick="delCl('${c.id}')">🗑️</button></td></tr>`).join(''):'<tr><td colspan="4" style="text-align:center;">Nenhum cliente encontrado</td></tr>';
  }
}
function delCl(id){conf('Excluir cliente permanentemente?',()=>{DB.set(K.cl,DB.get(K.cl).filter(x=>x.id!==id));renderCl();});}
function verHist(nome){
  document.getElementById('mhctt').textContent=`👁️ Histórico: ${nome}`;
  const ps=(DB.get(K.p)||[]).filter(p=>p.cliente===nome).map(x=>({...x,st:'Em Aberto'}));
  const co=(DB.get(K.co)||[]).filter(c=>c.cliente===nome).map(x=>({...x,st:'Concluído',data:x.dataConc}));
  const h=[...ps,...co].sort((a,b)=>b.data.localeCompare(a.data));
  document.getElementById('tbhc').innerHTML=h.length?h.map(x=>`<tr><td>${fd(x.data)}</td><td>${(x.desc||'').slice(0,40)}...</td><td style="font-weight:700">${brl(x.valor)}</td><td><span class="bj ${x.st==='Concluído'?'g':'o'}">${x.st}</span></td></tr>`).join(''):'<tr><td colspan="4" style="text-align:center;">Nenhum pedido registrado para este cliente.</td></tr>';
  OM('mhc');
}

// ── 10. RELATÓRIOS FINANCEIROS ──
function setRDates(){const d=new Date();const y=d.getFullYear(),m=(d.getMonth()+1).toString().padStart(2,'0');document.getElementById('rde').value=`${y}-${m}-01`;document.getElementById('rat').value=hj();}
function gerarR(reset = true){
  if(reset) cp.r = 1;
  const de=gv('rde'),at=gv('rat'); if(!de||!at) return;
  const vs=(DB.get(K.v)||[]).filter(v=>v.data>=de&&v.data<=at);
  const cs=(DB.get(K.c)||[]).filter(c=>c.data>=de&&c.data<=at);
  
  const fat = vs.filter(v => v.categoria !== 'Ajuste de caixa').reduce((a,b)=>a+Number(b.total),0); 
  const custosLoja = cs.filter(c=>!['Retirada Pessoal','Pró-labore', 'Ajuste de caixa'].includes(c.categoria)).reduce((a,b)=>a+Number(b.valor),0);
  const retiradas = cs.filter(c=>['Retirada Pessoal','Pró-labore'].includes(c.categoria)).reduce((a,b)=>a+Number(b.valor),0);
  
  const ajustesPos = vs.filter(v => v.categoria === 'Ajuste de caixa').reduce((a,b)=>a+Number(b.total),0);
  const ajustesNeg = cs.filter(c => c.categoria === 'Ajuste de caixa').reduce((a,b)=>a+Number(b.valor),0);

  const lucroNegocio = fat - custosLoja;
  const saldoFinal = (lucroNegocio + ajustesPos) - (retiradas + ajustesNeg);

  sv('rrv',brl(fat)); sv('rrc',brl(custosLoja)); sv('rrr',brl(retiradas)); sv('rrl',brl(lucroNegocio));
  const sEl=document.getElementById('rrs'); if(sEl) { sEl.textContent=brl(saldoFinal); sEl.style.color=saldoFinal>=0?'var(--ok)':'var(--no)'; }

  let movs=[...vs.map(x=>({d:x.data,t:'Venda',desc:x.produto,v:x.total,b:x.totalBruto,s:1,pg:x.pgto, cat:x.categoria})),...cs.map(x=>({d:x.data,t:x.categoria,desc:x.fornecedor,v:x.valor,b:x.valor,s:-1,pg:x.pgto, cat:x.categoria}))].sort((a,b)=>b.d.localeCompare(a.d));
  
  movs = pagList(movs, 'r-pag', 'mudarPagR', 'r');
  const tbrv = document.getElementById('tbrv');
  if(tbrv) {
    tbrv.innerHTML=movs.length?movs.map(m=>`<tr><td>${fd(m.d)}</td><td><span class="bj ${m.s>0?'g':((m.t||'').includes('Retirada')||(m.t||'').includes('Pró-labore')?'o':'r')}">${m.cat === 'Ajuste de caixa' ? 'Ajuste de Caixa' : (m.t||'Geral')}</span><br><small style="color:var(--tl)">${m.pg||''}</small></td><td>${m.desc||'-'}</td><td style="font-weight:700; color:${m.s>0?'var(--ok)':'var(--no)'}">${m.s>0?'+':'-'} ${(m.b && m.b > m.v) ? brlLq(m.b, m.v) : brl(m.v)}</td></tr>`).join(''):'<tr><td colspan="4" style="text-align:center;">Sem dados no período</td></tr>';
  }
}

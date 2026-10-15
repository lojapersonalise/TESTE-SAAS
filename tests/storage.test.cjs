const {test}=require('node:test');const assert=require('node:assert/strict');const Storage=require('../storage.js');
const empty=()=>Object.fromEntries(Storage.KEYS.map(k=>[k,[]]));
const ranks=state=>Object.fromEntries(Storage.KEYS.map(k=>[k,new Map(state[k].map((r,i)=>[r.id,i*1024]))]));
test('canonical fingerprints ignore object field order but preserve record order',async()=>{
 const a=empty(),b=empty();a.vendas=[{id:'a',total:1}];b.vendas=[{total:1,id:'a'}];assert.equal(await Storage.digest(a),await Storage.digest(b));b.vendas.push({id:'b'});assert.notEqual(await Storage.digest(a),await Storage.digest(b));
});
test('duplicate or missing IDs fail before migration or writes',()=>{const state=empty();state.clientes=[{id:'a'},{id:'a'}];assert.throws(()=>Storage.validateState(state),/duplicado/);state.clientes=[{}];assert.throws(()=>Storage.validateState(state),/identificador/);});
test('inserts, deletes, updates and middle inserts touch only affected documents',()=>{
 const before=empty();before.vendas=[{id:'a',total:1},{id:'b',total:2},{id:'c',total:3}];const after=JSON.parse(JSON.stringify(before));after.vendas=[{id:'first'},{id:'a',total:10},{id:'middle'},{id:'c',total:3}];const plan=Storage.planRecords(before,after,ranks(before));assert.equal(plan.operations.length,4);assert.equal(plan.operations.filter(x=>x.id==='c').length,0);assert.equal(plan.operations.filter(x=>x.remove).length,1);
 const order=after.vendas.map(r=>plan.ranks.vendas.get(r.id));assert.ok(order.every((v,i)=>i===0||v>order[i-1]));
});
test('column reordering is preserved and excessive atomic changes fail without splitting',()=>{
 const before=empty();before.colunas=[{id:'a'},{id:'b'},{id:'c'}];const after=structuredClone(before);after.colunas.reverse();const plan=Storage.planRecords(before,after,ranks(before));assert.ok(plan.ranks.colunas.get('c')<plan.ranks.colunas.get('b'));
 after.vendas=Array.from({length:451},(_,i)=>({id:'v'+i}));assert.throws(()=>Storage.planRecords(before,after,ranks(before)),/muitos registros/);
});

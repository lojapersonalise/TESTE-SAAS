'use strict';
firebase.initializeApp(FIREBASE_CONFIG);
const migrationAuth=firebase.auth();
const migrationStore=OrganiFinStorage.create(firebase.firestore(),FIREBASE_CONFIG.projectId);
const OWNER_UID='OJqtwDYPETUWegYndXmSnRiyNXR2';
let migrationBusy=false,migrationBackup=null;
const migrationStatus=message=>document.getElementById('migration-status').textContent=message;
function migrationOwner(){if(migrationAuth.currentUser?.uid!==OWNER_UID)throw Error('Entre com o usuário proprietário autorizado.');}
async function migrationAction(fn){
 if(migrationBusy)return;migrationBusy=true;
 const controls=[...document.querySelectorAll('button,input')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
 try{migrationOwner();await fn();}
 catch(error){migrationStatus(error.userMessage||(error.code==='permission-denied'?'Acesso recusado. Publique primeiro as regras firestore.rules no projeto correto e entre com o proprietário.':'Não foi possível concluir. Seus dados antigos foram preservados. Verifique a conexão e tente novamente.'));}
 finally{migrationBusy=false;controls.forEach(([el,disabled])=>el.disabled=disabled);}
}
async function inspectMigration(){
 const info=await migrationStore.info(false);
 migrationStatus(info.mode==='legacy'?'Regras acessíveis. Banco antigo ativo; pronto para exportar e guardar o backup.':info.mode==='migrating'?'Atualização incompleta. Os lançamentos estão bloqueados. Selecione o mesmo backup para retomar ou cancele para manter o banco antigo.':'Banco atualizado e ativo. A migração não precisa ser executada novamente.');
}
migrationAuth.onAuthStateChanged(user=>{
 document.getElementById('migration-password').value='';migrationBackup=null;document.getElementById('migration-file').value='';document.getElementById('migration-confirm').checked=false;
 document.getElementById('migration-login').hidden=!!user;
 document.getElementById('migration-owner').hidden=user?.uid!==OWNER_UID;
 if(!user)migrationStatus('Entre com o usuário proprietário do projeto.');
 else if(user.uid!==OWNER_UID){document.getElementById('migration-login').hidden=false;migrationStatus('Este usuário não é o proprietário autorizado. Entre com a conta correta.');}
 else{document.getElementById('migration-project').textContent='Projeto: '+FIREBASE_CONFIG.projectId;void migrationAction(inspectMigration);}
});
document.getElementById('migration-signin').onclick=async()=>{
 const button=document.getElementById('migration-signin');button.disabled=true;
 try{await migrationAuth.signInWithEmailAndPassword(document.getElementById('migration-email').value.trim(),document.getElementById('migration-password').value);}
 catch{migrationStatus('Não foi possível entrar. Confira a conta e a conexão.');}
 finally{button.disabled=false;}
};
document.getElementById('migration-signout').onclick=()=>migrationAuth.signOut();
document.getElementById('migration-inspect').onclick=()=>migrationAction(inspectMigration);
document.getElementById('migration-export').onclick=()=>migrationAction(async()=>{
 migrationStatus('Exportando um backup consistente...');
 const value=await migrationStore.backup();
 const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='organifin-'+new Date().toISOString().replace(/[:.]/g,'-')+'.organifin-backup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 migrationStatus('Backup exportado. Guarde o arquivo e depois selecione-o abaixo. Registros: '+JSON.stringify(value.counts));
});
document.getElementById('migration-file').onchange=()=>migrationAction(async()=>{
 migrationBackup=null;const file=document.getElementById('migration-file').files[0];if(!file)return;
 if(file.size>100*1024*1024)throw Error('Backup muito grande.');
 const value=JSON.parse(await file.text());migrationBackup=await migrationStore.checkBackup(value);
 migrationStatus('Backup íntegro deste projeto. Registros: '+JSON.stringify(migrationBackup.counts));
});
document.getElementById('migration-run').onclick=()=>migrationAction(async()=>{
 if(!migrationBackup||!document.getElementById('migration-confirm').checked){migrationStatus('Selecione o backup salvo e confirme que o guardou e pausou os lançamentos.');return;}
 migrationStatus('Conferindo o backup e pausando as gravações do banco antigo...');
 const control=await migrationStore.beginMigration(migrationBackup);
 await migrationStore.copyMigration(control,migrationBackup,(done,total)=>migrationStatus('Copiando registros: '+done+' de '+total+'. Não feche esta página.'));
 migrationStatus('Conferindo todos os registros antes da ativação...');
 await migrationStore.finishMigration(control,migrationBackup);
 migrationStatus('Atualização concluída e conferida. As listas antigas foram preservadas. Atualize a página do sistema em todos os dispositivos antes de voltar a fazer lançamentos.');
});
document.getElementById('migration-cancel').onclick=()=>migrationAction(async()=>{
 if(!window.confirm('Cancelar a atualização incompleta e reabrir o banco antigo? Nenhum registro antigo será excluído.'))return;
 await migrationStore.cancelMigration();migrationStatus('Atualização incompleta cancelada. O banco antigo está disponível. A cópia incompleta permanece inativa e não é utilizada pelo sistema.');
});
window.addEventListener('beforeunload',event=>{if(migrationBusy){event.preventDefault();event.returnValue='';}});

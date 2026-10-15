// Browser-only deterministic test double. No real Firebase credentials or data.
(() => {
  const copy = value => JSON.parse(JSON.stringify(value));
  const state = window.__seed || {};
  const listeners = new Map();
  const fake = window.__fake = {
    state, attempts: [], commits: [], resetRequests: [], failNext: false,
    hold: false, release: null, authCallback: null,
    listeners: () => [...listeners.values()].reduce((sum,list) => sum+list.size,0),
    emit(key) {
      for (const cb of listeners.get(key) || []) cb({exists:Object.hasOwn(state,key),data:()=>copy(state[key]),metadata:{fromCache:false,hasPendingWrites:false}});
    },
    async signOut() {fake.auth.currentUser=null;fake.authCallback(null);},
    async signIn(uid='test-user') {fake.auth.currentUser={uid};fake.authCallback(fake.auth.currentUser);}
  };
  fake.auth = {
    currentUser: window.__loggedOut ? null : {uid:'test-user'},
    onAuthStateChanged(cb) {fake.authCallback=cb;setTimeout(()=>cb(this.currentUser),0);return ()=>{};},
    signInWithEmailAndPassword: () => fake.signIn(), signOut: () => fake.signOut(),
    async sendPasswordResetEmail(email) {fake.resetRequests.push(email);if(fake.resetError)throw {code:fake.resetError};}
  };
  const database = {
    collection(name) {
      if(name!=='banco_personalise')throw Error('Unexpected collection');
      return {doc(key) {return {key,onSnapshot(options,cb) {
        if(!listeners.has(key))listeners.set(key,new Set());
        listeners.get(key).add(cb);
        setTimeout(()=>{if(listeners.get(key).has(cb))fake.emit(key);},0);
        return ()=>listeners.get(key).delete(cb);
      }}}};
    },
    batch() {
      const writes=[];
      return {
        set(ref,data) {writes.push({key:ref.key,data:copy(data)});},
        async commit() {
          fake.attempts.push(copy(writes));
          if(fake.hold)await new Promise(resolve=>fake.release=resolve);
          if(fake.failNext){fake.failNext=false;throw {code:'permission-denied'};}
          writes.forEach(write=>state[write.key]=write.data);
          fake.commits.push(copy(writes));
          writes.forEach(write=>fake.emit(write.key));
        }
      };
    }
  };
  fake.firebase = {initializeApp() {},firestore:()=>database,auth:()=>fake.auth};
})();

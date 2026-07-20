const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gen-lang-client-0809048670' });
admin.firestore().collection('users').get().then(s => {
  console.log(JSON.stringify(s.docs.map(d=>({id:d.id, data:d.data()})), null, 2));
}).catch(console.error);

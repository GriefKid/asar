// Shared Firebase helpers — included in all pages via CDN compat SDK
(function() {
  window.getFirebaseConfig = function() {
    try { const s = localStorage.getItem('asar-firebase-config'); return s ? JSON.parse(s) : null; } catch { return null; }
  };

  window.initFirebase = function() {
    if (window._fbApp) return true;
    const config = getFirebaseConfig();
    if (!config || !config.apiKey) return false;
    try {
      if (!firebase.apps.length) window._fbApp = firebase.initializeApp(config);
      else window._fbApp = firebase.app();
      window._fbAuth = firebase.auth();
      window._fbDb = firebase.firestore();
      window._fbAuth.onAuthStateChanged(function(user) {
        window._currentUser = user;
        if (typeof window.onFirebaseAuthChange === 'function') window.onFirebaseAuthChange(user);
      });
      return true;
    } catch(e) { console.error('Firebase init error:', e); return false; }
  };

  window.getUID = function() { return window._currentUser && window._currentUser.uid || null; };
  window.isFirebaseReady = function() { return !!(window._fbDb); };

  window.sanitizeKey = function(str) {
    return (str || '').toLowerCase().replace(/[\s\./\\#$\[\]]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 100) || 'unknown';
  };

  window.communityKey = function(type, title, artist) {
    return type + '__' + sanitizeKey(title) + (artist ? '__' + sanitizeKey(artist) : '');
  };

  window.writeCommunityRating = async function(type, title, cover, rating, artist) {
    const db = window._fbDb;
    const uid = getUID();
    if (!db || !uid || !title) return;
    const key = communityKey(type, title, artist);
    const docRef = db.collection('community').doc(key);
    try {
      await db.runTransaction(async function(tx) {
        const doc = await tx.get(docRef);
        const d = doc.exists ? doc.data() : { type, title, cover: '', artist: artist||'', votes: {}, avg: 0, count: 0 };
        if (rating === 0) delete d.votes[uid];
        else d.votes[uid] = rating;
        const vals = Object.values(d.votes);
        d.count = vals.length;
        d.avg = vals.length > 0 ? vals.reduce(function(a,b){return a+b;},0)/vals.length : 0;
        if (cover) d.cover = cover;
        if (artist) d.artist = artist;
        d.title = title; d.type = type;
        tx.set(docRef, d);
      });
    } catch(e) { console.error('writeCommunityRating failed:', e); }
  };
})();

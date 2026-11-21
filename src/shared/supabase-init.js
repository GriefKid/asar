// Shared Supabase helpers — replaces firebase-init.js
// Requires @supabase/supabase-js UMD loaded before this file

(function() {
  window._sb = null;
  window._currentUser = null;

  // Default config — pre-configured for اثر
  var _DEFAULT_CFG = {
    url: 'https://yejayyntjxxncpvcevzl.supabase.co',
    anonKey: 'sb_publishable_3xwD6HdcXm8PrLgmcHtGyw_s8pciLHw'
  };

  window.getSupabaseConfig = function() {
    try {
      const s = localStorage.getItem('asar-supabase-config');
      return s ? JSON.parse(s) : _DEFAULT_CFG;
    } catch { return _DEFAULT_CFG; }
  };

  window.initFirebase = window.initSupabase = function() {
    if (window._sb) return true;
    const cfg = getSupabaseConfig();
    if (!cfg || !cfg.url || !cfg.anonKey) return false;
    try {
      window._sb = supabase.createClient(cfg.url, cfg.anonKey);
      window._sb.auth.onAuthStateChange(function(_event, session) {
        window._currentUser = session ? session.user : null;
        if (typeof window.onFirebaseAuthChange === 'function') window.onFirebaseAuthChange(window._currentUser);
      });
      // Restore existing session
      window._sb.auth.getSession().then(function(res) {
        window._currentUser = res.data.session ? res.data.session.user : null;
        if (typeof window.onFirebaseAuthChange === 'function') window.onFirebaseAuthChange(window._currentUser);
      });
      return true;
    } catch(e) { console.error('Supabase init error:', e); return false; }
  };

  window.getUID = function() { return window._currentUser ? window._currentUser.id : null; };
  window.isFirebaseReady = function() { return !!(window._sb); };

  window.sanitizeKey = function(str) {
    return (str || '').toLowerCase().replace(/[\s\./\\#$\[\]]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 100) || 'unknown';
  };

  window.communityKey = function(type, title, artist) {
    return type + '__' + sanitizeKey(title) + (artist ? '__' + sanitizeKey(artist) : '');
  };

  window.writeCommunityRating = async function(type, title, cover, rating, artist) {
    const sb = window._sb;
    const uid = getUID();
    if (!sb || !uid || !title) return;
    const key = communityKey(type, title, artist);
    try {
      // Get existing
      const { data: existing } = await sb.from('community').select('votes').eq('key', key).maybeSingle();
      const votes = (existing && existing.votes) ? existing.votes : {};
      if (rating === 0) delete votes[uid]; else votes[uid] = rating;
      const vals = Object.values(votes).filter(v => v > 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      await sb.from('community').upsert({
        key, type, title,
        artist: artist || '',
        cover: cover || '',
        votes, avg,
        count: vals.length
      }, { onConflict: 'key' });
    } catch(e) { console.error('writeCommunityRating failed:', e); }
  };
})();

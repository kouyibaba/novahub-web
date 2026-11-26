(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovaVod = api;
})(typeof window === 'object' ? window : globalThis, function() {
  const fields = ['name','year','typeName','lang','season'];
  function compatible(a,b) {
    return fields.every(k => a[k] && b[k] && String(a[k]).trim().toLowerCase() === String(b[k]).trim().toLowerCase());
  }
  const episodeIndex = (eps,label) => eps.findIndex(e => String(e.name).trim() === String(label).trim());
  function create(request) {
    let generation=0;
    return {
      cancel() { generation++; },
      async search(q, publish) {
        const mine=++generation;
        try { const value=await request(q); if(mine===generation) publish(value); return mine===generation; }
        catch(e) { if(mine===generation) throw e; return false; }
      },
    };
  }
  return {create, compatible, episodeIndex};
});

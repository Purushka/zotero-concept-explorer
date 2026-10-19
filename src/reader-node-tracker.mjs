// Use Zotero's Gecko dead-wrapper guard before touching retained Reader DOM.
// A PDF close destroys its document even while the plugin keeps a reference.
export function createReaderNodeTracker({isDeadWrapper}) {
  const nodes=new Set();
  function connected(node) {
    try { return !isDeadWrapper(node) && node.isConnected; }
    catch { return false; } // The document can be destroyed during this check.
  }
  function prune() {
    for (const node of nodes) if (!connected(node)) nodes.delete(node);
  }
  return {
    track(node) {
      prune();
      // Reader hooks create buttons before append(); a new detached node is valid.
      nodes.add(node);
    },
    forEach(visitor) {prune();for(const node of nodes)visitor(node);},
    removeAll() {
      for (const node of nodes) {
        try { if (!isDeadWrapper(node)) node.remove(); }
        catch { /* A closed Reader must not prevent cleanup of live Readers. */ }
      }
      nodes.clear();
    },
    get size() { return nodes.size; }
  };
}

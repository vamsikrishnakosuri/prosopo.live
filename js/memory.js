// PROSOPO's memory of the user — lives ONLY in this browser's localStorage.
// Nothing ever reaches a server or database: clearing browser data (or the
// "forget" button) erases it completely.

const KEY = "prosopo_memory_v1";

export const personaMemory = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { facts: [], lastSeen: 0 };
    } catch {
      return { facts: [], lastSeen: 0 };
    }
  },

  save(m) {
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
  },

  addFact(text) {
    const fact = text.trim().slice(0, 160);
    if (!fact) return;
    const m = this.load();
    const lower = fact.toLowerCase();
    if (m.facts.some((f) => f.toLowerCase() === lower)) return;
    m.facts.push(fact);
    m.facts = m.facts.slice(-40); // keep the most recent 40 facts
    this.save(m);
  },

  touch() {
    const m = this.load();
    m.lastSeen = Date.now();
    this.save(m);
  },

  clear() {
    try { localStorage.removeItem(KEY); } catch { /* fine */ }
  },

  // short display name if one was remembered ("Name: Vamsi")
  name() {
    const m = this.load();
    for (const f of m.facts) {
      const match = f.match(/^name\s*[:\-]?\s*(.+)$/i) || f.match(/name is\s+(.+)$/i);
      if (match) return match[1].trim().split(/\s+/)[0].replace(/[,.;:!]+$/, "");
    }
    return null;
  },

  // text block injected into the system prompt (null when empty)
  summary() {
    const m = this.load();
    if (!m.facts.length && !m.lastSeen) return null;
    const lines = [];
    if (m.lastSeen) {
      const days = Math.floor((Date.now() - m.lastSeen) / 86400000);
      lines.push(days <= 0 ? "You last talked earlier today." :
        days === 1 ? "You last talked yesterday." : `You last talked ${days} days ago.`);
    }
    for (const f of m.facts) lines.push(`- ${f}`);
    return lines.join("\n");
  },
};

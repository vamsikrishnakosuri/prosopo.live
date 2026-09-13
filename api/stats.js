// GET /api/stats        -> { users } (read only)
// GET /api/stats?hit=1  -> increments once (client sends hit on first visit
//                          per browser) and returns the new count.
// The counter holds a single anonymous number — no visitor data of any kind.
// Proxied server-side so visitors' IPs never reach the counter service.

const NS = "prosopo.live";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const hit = req.query.hit === "1";
    const url = `https://abacus.jasoncameron.dev/${hit ? "hit" : "get"}/${NS}/visitors`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`abacus ${r.status}`);
    const data = await r.json();
    res.status(200).json({ users: data.value ?? 0 });
  } catch (err) {
    console.error("stats:", err.message);
    res.status(200).json({ users: null }); // fail silently — vanity metric
  }
}

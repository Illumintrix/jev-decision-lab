const ALLOWED_TYPES = new Set(['choice', 'noul', 'score']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Jev is not connected yet. Add TYPESAFE_API_KEY to the deployment.' });

  const { state, questions } = req.body || {};
  if (!state || typeof state !== 'string' || state.length > 12000) {
    return res.status(400).json({ error: 'State must be a non-empty string under 12,000 characters.' });
  }
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    return res.status(400).json({ error: 'Questions must be an object.' });
  }
  const entries = Object.entries(questions);
  if (!entries.length || entries.length > 8) return res.status(400).json({ error: 'Send 1 to 8 questions.' });
  for (const [id, q] of entries) {
    if (!/^[a-z0-9_]{1,48}$/i.test(id) || !q || !ALLOWED_TYPES.has(q.type) || typeof q.instructions !== 'string' || !q.instructions.trim() || q.instructions.length > 500) {
      return res.status(400).json({ error: `Invalid question: ${id}` });
    }
    if (q.type === 'choice' && (!q.criteria || Array.isArray(q.criteria) || Object.keys(q.criteria).length < 2)) return res.status(400).json({ error: `Choice ${id} needs at least two options.` });
    if (q.type === 'noul' && (!q.criteria || typeof q.criteria.true !== 'string' || typeof q.criteria.false !== 'string')) return res.status(400).json({ error: `Noul ${id} needs yes and no criteria.` });
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2)) return res.status(400).json({ error: `Score ${id} needs at least two ordered levels.` });
  }

  try {
    const upstream = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, model: 'jev-latest', questions }),
      signal: AbortSignal.timeout(30000)
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = data?.detail?.message || data?.detail?.error?.message || data?.message || 'Jev could not evaluate this request.';
      return res.status(upstream.status).json({ error: message, requestId: upstream.headers.get('x-typesafe-request-id') });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(502).json({ error: error.name === 'TimeoutError' ? 'Jev took too long to respond.' : 'Could not reach Jev.' });
  }
};

// /api/verify-license.js (разворачивается на Vercel)
module.exports = async (req, res) => {
  console.log('[PROXY] Request received:', req.method);
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { }
    }

    const input_key = body?.input_key;
    console.log('[PROXY] License Key to verify:', input_key ? '***' + input_key.slice(-5) : 'MISSING');

    if (!input_key) {
      return res.status(400).json({ ok: false, error: 'Missing input_key' });
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[PROXY] ERROR: Missing Supabase variables in Vercel');
      return res.status(500).json({ ok: false, error: 'Server environment not configured' });
    }

    console.log('[PROXY] Calling Supabase RPC...');
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_license_key`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ input_key })
    });

    const debugStatus = response.status;
    const result = await response.json();

    console.log('[PROXY] Supabase Response Status:', debugStatus);
    console.log('[PROXY] Supabase Raw Result:', JSON.stringify(result));

    // Важно: возвращаем результат именно в том формате, который ждет расширение
    // Ожидаемый формат: { ok: true, status: 'active'|'invalid'|'expired' }
    return res.status(200).json(result);
  } catch (error) {
    console.error('[PROXY] CRITICAL ERROR:', error.message);
    return res.status(500).json({ ok: false, error: 'Internal Server Error: ' + error.message });
  }
}

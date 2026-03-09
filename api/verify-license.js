// /api/verify-license.js (разворачивается на Vercel)
module.exports = async (req, res) => {
  try {
    // В некоторых окружениях req.body может прийти как строка
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { }
    }

    const input_key = body?.input_key;

    if (!input_key) {
      return res.status(400).json({ ok: false, error: 'Missing input_key' });
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Server Configuration Error: Missing Supabase variables');
      return res.status(500).json({ ok: false, error: 'Server environment not configured' });
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_license_key`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ input_key })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Supabase RPC Error:', errorText);
      return res.status(response.status).json({ ok: false, error: 'Supabase request failed' });
    }

    const result = await response.json();
    return res.status(200).json(result);
  } catch (error) {
    console.error('Proxy Error:', error.message);
    return res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}

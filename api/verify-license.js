// api/verify-license.js

module.exports = async (req, res) => {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  console.log('[PROXY] Request method:', req.method);

  try {
    let body = req.body;

    // На Vercel в Node-функциях req.body часто undefined — читаем сырое тело
    if (!body) {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
      }
      console.log('[PROXY] Raw body string:', raw);

      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (e) {
          console.error('[PROXY] Failed to parse JSON body:', e.message);
          body = {};
        }
      } else {
        body = {};
      }
    }

    console.log('[PROXY] Parsed body:', body);

    const input_key = body && body.input_key;
    console.log('[PROXY] License Key to verify:', input_key ? '***' + String(input_key).slice(-5) : 'MISSING');

    if (!input_key) {
      return res.status(400).json({ ok: false, status: 'missing', error: 'Missing input_key' });
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[PROXY] ERROR: Missing Supabase ENV vars');
      return res.status(500).json({ ok: false, status: 'error', error: 'Server environment not configured' });
    }

    console.log('[PROXY] Calling Supabase RPC...');
    const sbResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_license_key`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ input_key })
    });

    const sbStatus = sbResponse.status;
    let sbResult;
    try {
      sbResult = await sbResponse.json();
    } catch (e) {
      console.error('[PROXY] Failed to parse Supabase JSON:', e.message);
      sbResult = null;
    }

    console.log('[PROXY] Supabase status:', sbStatus);
    console.log('[PROXY] Supabase raw result:', sbResult);

    // Здесь адаптируйте под реальный формат ответа вашей RPC функции
    // Ниже пример, нужно подправить под вашу логику
    let result = { ok: false, status: 'invalid' };

    // Пример: если RPC вернет объект { status: 'active' | 'expired' | 'invalid' }
    if (sbResult && sbResult.status) {
      result = {
        ok: sbResult.status === 'active',
        status: sbResult.status
      };
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[PROXY] CRITICAL ERROR:', error);
    return res.status(500).json({ ok: false, status: 'error', error: 'Internal Server Error: ' + error.message });
  }
};
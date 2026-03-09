// /api/verify-license.js (разворачивается на Vercel)
module.exports = async (req, res) => {
  const { input_key } = req.body;

  // Ключи Supabase берем из Environment Variables на Vercel!
  // В коде их больше НЕТ.
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_license_key`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input_key })
  });

  const result = await response.json();
  return res.status(200).json(result);
}

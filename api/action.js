export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      route: 'api/action',
      message: 'Vercel function is available',
    })
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {}

    return res.status(200).json({
      ok: true,
      route: 'api/action',
      received: body,
      message: 'Action received',
    })
  }

  return res.status(405).json({
    ok: false,
    error: 'Method not allowed',
  })
}

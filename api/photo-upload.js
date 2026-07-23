// Test: minimal POST handler to see if POST works at all
// on /api/photo-upload. If this works, the original 502 was
// in our business logic. If this also 502s, the issue is
// at the Vercel/Cloudflare layer.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  res.status(200).json({
    method: req.method,
    headers: req.headers,
    body: req.body,
    bodyType: typeof req.body,
  });
}

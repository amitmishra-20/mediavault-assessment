import '../server/index.mjs';

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function (req, res) {
  const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : undefined;
  const upstream = await fetch(`http://localhost:${process.env.PORT ?? 8787}${req.url ?? ''}`, {
    method: req.method,
    headers: { ...req.headers, host: undefined, connection: undefined },
    body,
  });
  for (const [k, v] of upstream.headers) {
    if (k.toLowerCase() === 'set-cookie') continue;
    res.setHeader(k, v);
  }
  res.statusCode = upstream.status;
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
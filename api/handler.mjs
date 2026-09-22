async function connect() {
  let err;
  for (let i = 0; i < 5; i++) {
    try {
      // Deferred import: Vercel sets VERCEL=1? then guard inside server may skip listen — mirror its env here.
      await import('../server/index.mjs');
      return;
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw err;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function handle(req, res) {
  await connect();
  const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : undefined;
  let upstream;
  for (let i = 0; i < 5; i++) {
    try {
      upstream = await fetch(`http://localhost:${process.env.PORT ?? 8787}${req.url ?? ''}`, {
        method: req.method,
        headers: { ...req.headers, host: undefined, connection: undefined },
        body,
      });
      break;
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  for (const [k, v] of upstream.headers) {
    if (k.toLowerCase() === 'set-cookie') continue;
    res.setHeader(k, v);
  }
  res.statusCode = upstream.status;
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
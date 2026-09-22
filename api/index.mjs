export default async function (req, res) {
  try {
    const { handle } = await import('./handler.mjs');
    await handle(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: err?.stack ?? String(err) }));
  }
}
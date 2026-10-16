import { Readable } from 'node:stream';

const MAX_BODY = 4 * 1024 * 1024; // below Vercel's request/response limit

export class BufferedResponse {
  statusCode = 200;
  headers = {};
  headersSent = false;
  body = '';
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  getHeader(name) { return this.headers[name.toLowerCase()]; }
  writeHead(code, headers = {}) {
    this.statusCode = code;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    this.headersSent = true;
  }
  end(body = '') { this.body = body; this.headersSent = true; }
}

export async function readRequest(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY) throw Object.assign(new Error('request too large'), { status: 413 });
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

// One adapter per imported server module. Its queue protects module globals within
// an instance; SELECT FOR UPDATE protects them across processes and cold starts.
export function createHandler({ store, server }) {
  let tail = Promise.resolve();
  return async function handle(req, res) {
    let bytes;
    try { bytes = await readRequest(req); }
    catch (error) {
      res.writeHead(error.status || 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: error.status === 413 ? 'request too large' : 'bad request' }));
    }
    const work = tail.then(() => store.transaction(async snapshot => {
      server.restoreServerless(snapshot);
      const request = Readable.from(bytes.length ? [bytes] : []);
      Object.assign(request, { headers: req.headers, method: req.method, url: req.url, socket: req.socket, complete: true });
      const response = new BufferedResponse();
      await server.requestHandler(request, response);
      // The upstream dispatcher catches route exceptions. Roll back unexpected
      // failures; expected 4xx must commit spent challenges and failed-login limits.
      if (response.statusCode >= 500) throw new Error('API request failed');
      if (Buffer.byteLength(response.body) > MAX_BODY) throw new Error('API response exceeds Vercel limit');
      server.snapshotServerless(snapshot);
      return response;
    }));
    tail = work.catch(() => {});
    try {
      const response = await work;
      // Cookies and success are sent only AFTER COMMIT. A failed database write
      // must never tell a phone its workout was saved, nor sign in a missing user.
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
    } catch {
      // Do not log connection strings, snapshot contents or request credentials.
      console.error('openGym: database transaction failed');
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '3' });
      res.end(JSON.stringify({ error: 'storage temporarily unavailable' }));
    }
  };
}

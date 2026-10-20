import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexSession, AppError, validateInput } from './codex.js';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const sessionLifetime = 30 * 60 * 1000;
export function createApp({ workerFactory = () => new CodexSession(), secure = process.env.NODE_ENV === 'production', publicOrigin = process.env.RENDER_EXTERNAL_URL, maxSessions = 4 } = {}) {
  const sessions = new Map(), dist = resolve('dist');
  const cookieName = secure ? '__Host-reframe' : 'reframe';
  let starts = [];
  const dispose = async (id, session) => { sessions.delete(id); await session.worker?.close(); };
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) {
      if (!session.job?.pending && Date.now() - session.touched > sessionLifetime) void dispose(id, session);
      else if (session.job && !session.job.pending && Date.now() - session.job.created > 5 * 60 * 1000) session.job = null;
    }
  }, 60000);
  cleanup.unref();
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Send JSON.', 415);
    let size = 0; const parts = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 3_100_000) throw new AppError('Your images are too large. Use smaller references.', 413);
      parts.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(parts).toString()); }
    catch { throw new AppError('Invalid JSON.', 400); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
      if (path.startsWith('/api/')) {
        const origin = publicOrigin || `${secure ? 'https' : 'http'}://${req.headers.host}`;
        if (req.method !== 'GET' && (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site'))
          throw new AppError('Open Reframe directly to continue.', 403);
        const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')));
        let id = cookies[cookieName], session = sessions.get(id);
        if (session) session.touched = Date.now();
        if (req.method === 'POST' && path === '/api/auth/start') {
          await body(req);
          if (session?.worker.closed) { await dispose(id, session); session = null; }
          if (!session) {
            starts = starts.filter(time => Date.now() - time < 60000);
            if (sessions.size >= maxSessions || starts.length >= 10) throw new AppError('The POC is busy. Try again in a few minutes.', 429);
            starts.push(Date.now());
            id = randomBytes(32).toString('hex');
            session = { touched: Date.now(), worker: workerFactory(), job: null };
            sessions.set(id, session);
            try { await session.worker.init(); }
            catch (error) { await dispose(id, session); throw error; }
          }
          // Repeated start clicks never create parallel sign-in attempts.
          if (!session.loginPromise) session.loginPromise = session.worker.startLogin().finally(() => { session.loginPromise = null; });
          try {
            const login = await session.loginPromise;
            res.setHeader('Set-Cookie', `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`);
            return json(res, 200, login);
          } catch (error) { await dispose(id, session); throw error; }
        }
        if (req.method === 'GET' && path === '/api/auth')
          return json(res, 200, session ? await session.worker.account() : { state: 'signedOut' });
        if (req.method === 'POST' && path === '/api/auth/logout') {
          await body(req);
          if (session) await dispose(id, session);
          res.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`);
          return json(res, 200, { ok: true });
        }
        // A failed worker can still have a completed job error for its owner.
        if (!session || (session.worker.closed && !path.startsWith('/api/jobs/')))
          throw new AppError('Sign in with ChatGPT to continue.', 401);
        if (req.method === 'POST' && (path === '/api/scene' || path === '/api/photo')) {
          const kind = path.slice(5), input = validateInput(kind, await body(req));
          if (session.job?.pending) throw new AppError('Wait for your current generation to finish.', 409);
          if ((await session.worker.account()).state !== 'signedIn') throw new AppError('Sign in with ChatGPT to continue.', 401);
          // Account validation is async: recheck before reserving the job.
          if (session.job?.pending) throw new AppError('Wait for your current generation to finish.', 409);
          const job = { id: randomUUID(), pending: true, created: Date.now() };
          session.job = job;
          session.worker.generate(kind, input).then(result => {
            job.result = result;
          }).catch(error => {
            job.error = error instanceof AppError ? error.message : 'Generation failed. Please try again.';
            job.status = error instanceof AppError ? error.status : 502;
          }).finally(() => { job.pending = false; session.touched = Date.now(); });
          return json(res, 202, { jobId: job.id });
        }
        if (req.method === 'GET' && path.startsWith('/api/jobs/')) {
          const job = session.job;
          if (!job || path.slice(10) !== job.id) throw new AppError('This generation is no longer available.', 404);
          if (job.pending) return json(res, 200, { pending: true });
          if (job.error) return json(res, job.status, { error: job.error });
          return json(res, 200, { result: job.result });
        }
        throw new AppError('Not found.', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('Method not allowed.', 405);
      const file = resolve(dist, `.${decodeURIComponent(path === '/' ? '/index.html' : path)}`);
      if (!file.startsWith(`${dist}${sep}`)) throw new AppError('Not found.', 404);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) throw new AppError('Not found.', 404);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof AppError ? error.status : 500,
        { error: error instanceof AppError ? error.message : 'The server could not complete this request.' });
      else res.end();
    }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  server.on('close', () => { clearInterval(cleanup); for (const [id, session] of sessions) void dispose(id, session); });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createApp();
  server.listen(port, '0.0.0.0', () => console.log(`Reframe listening on port ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close(); server.closeAllConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

import http from 'http';
import https from 'https';
import { URL } from 'url';

if (typeof globalThis.AbortSignal === 'undefined') {
  globalThis.AbortSignal = {
    timeout(ms) {
      return { timeoutMs: ms };
    }
  };
} else if (!globalThis.AbortSignal.timeout) {
  globalThis.AbortSignal.timeout = function (ms) {
    if (typeof globalThis.AbortController !== 'undefined') {
      const ac = new globalThis.AbortController();
      const t = setTimeout(() => {
        try { ac.abort(); } catch {}
      }, ms);
      if (t.unref) t.unref();
      return ac.signal;
    }
    return { timeoutMs: ms };
  };
}

if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = function fetchPolyfill(input, init = {}) {
    return new Promise((resolve, reject) => {
      try {
        const urlStr = typeof input === 'string' ? input : (input?.url || input?.href || String(input));
        const urlObj = new URL(urlStr);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const headers = { ...(init.headers || {}) };
        let body = init.body;

        if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
          body = JSON.stringify(body);
        }

        const options = {
          protocol: urlObj.protocol,
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: (urlObj.pathname || '/') + (urlObj.search || ''),
          method: (init.method || 'GET').toUpperCase(),
          headers
        };

        let isTimedOut = false;
        let timer = null;

        const timeoutMs = init.signal?.timeoutMs || (typeof init.timeout === 'number' ? init.timeout : null);
        if (timeoutMs) {
          timer = setTimeout(() => {
            isTimedOut = true;
            req.destroy(new Error(`Запит перервано за таймаутом (${timeoutMs}мс)`));
          }, timeoutMs);
          if (timer.unref) timer.unref();
        }

        if (init.signal && typeof init.signal.addEventListener === 'function') {
          init.signal.addEventListener('abort', () => {
            req.destroy(new Error('Запит скасовано'));
          });
        }

        const req = client.request(options, (res) => {
          if (timer) clearTimeout(timer);

          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, urlObj.href).href;
            const redirectInit = { ...init };
            if ([301, 302, 303].includes(res.statusCode)) {
              redirectInit.method = 'GET';
              delete redirectInit.body;
            }
            return resolve(fetchPolyfill(redirectUrl, redirectInit));
          }

          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const responseObj = {
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage || '',
              headers: {
                get(name) {
                  return res.headers[name.toLowerCase()] || null;
                },
                ...res.headers
              },
              async json() {
                return JSON.parse(buffer.toString('utf-8'));
              },
              async text() {
                return buffer.toString('utf-8');
              },
              async arrayBuffer() {
                const ab = new ArrayBuffer(buffer.length);
                const view = new Uint8Array(ab);
                for (let i = 0; i < buffer.length; ++i) {
                  view[i] = buffer[i];
                }
                return ab;
              }
            };
            resolve(responseObj);
          });
        });

        req.on('error', (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        });

        if (body) {
          req.write(body);
        }
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  };
}

import './fetch-polyfill.js';
import express from 'express';
import http from 'http';
import https from 'https';
import os from 'os';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { db, generateSecureId, parseNumericInput } from './database.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  try {
    const files = [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')];
    for (const f of files) {
      if (fs.existsSync(f)) {
        const lines = fs.readFileSync(f, 'utf-8').split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eq = trimmed.indexOf('=');
            if (eq > 0) {
              const k = trimmed.slice(0, eq).trim();
              const v = trimmed.slice(eq + 1).trim();
              if (process.env[k] === undefined) {
                process.env[k] = v;
              }
            }
          }
        }
      }
    }
  } catch {}
}
loadEnv();

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const PORT = process.env.PORT || 3500;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || (parseInt(PORT, 10) + 1);
const ENABLE_LOCAL_HTTPS = process.env.ENABLE_LOCAL_HTTPS !== 'false';
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-flash-latest'];

function getGeminiApiKey() {
  return (process.env.GEMINI_API_KEY || '').trim();
}

function sanitizeGeminiMessage(msg, apiKey) {
  let text = String(msg || '');
  if (apiKey) {
    text = text.split(apiKey).join('[REDACTED]').split(encodeURIComponent(apiKey)).join('[REDACTED]');
  }
  return text.replace(/key=[A-Za-z0-9_\-]+/gi, 'key=[REDACTED]');
}

function parseAiJsonResponse(rawText) {
  if (!rawText) return null;
  const cleaned = String(rawText).replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return null;
}

async function callGeminiServer(promptText, options = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, status: 503, error: 'GEMINI_API_KEY не налаштований на сервері' };
  }

  let contentsPayload = null;
  if (Array.isArray(options.contents) && options.contents.length > 0) {
    const normalizedHistory = [];
    for (const item of options.contents) {
      if (!item || typeof item !== 'object') continue;
      const role = item.role === 'model' ? 'model' : 'user';
      const txt = typeof item.text === 'string'
        ? item.text.trim()
        : (Array.isArray(item.parts) ? item.parts.map(p => String(p.text || '')).join('\n').trim() : '');
      if (txt) {
        normalizedHistory.push({ role, parts: [{ text: txt.slice(0, 12000) }] });
      }
    }
    const cleanCurrent = String(promptText || '').trim();
    if (cleanCurrent) {
      normalizedHistory.push({ role: 'user', parts: [{ text: cleanCurrent.slice(0, 48000) }] });
    }
    if (normalizedHistory.length === 0) {
      return { ok: false, status: 400, error: 'Порожній запит для ШІ' };
    }
    contentsPayload = normalizedHistory;
  } else {
    const cleanPrompt = String(promptText || '').trim();
    const hasInline = Boolean(options.inlineData && options.inlineData.data);
    if ((!cleanPrompt && !hasInline) || cleanPrompt.length > 60000) {
      return { ok: false, status: 400, error: 'Некоректний розмір запиту для ШІ' };
    }
    const parts = [];
    if (hasInline) {
      parts.push({
        inlineData: {
          mimeType: options.inlineData.mimeType || 'application/octet-stream',
          data: options.inlineData.data
        }
      });
    }
    if (cleanPrompt) {
      parts.push({ text: cleanPrompt });
    }
    contentsPayload = [{ role: 'user', parts }];
  }

  const generationConfig = {
    maxOutputTokens: options.maxOutputTokens || 8192
  };
  if (options.expectJson) {
    generationConfig.responseMimeType = 'application/json';
  }
  if (options.temperature !== undefined) {
    generationConfig.temperature = options.temperature;
  }

  const sysText = options.systemInstruction
    ? String(options.systemInstruction).trim().slice(0, 4000)
    : 'Відповідай виключно українською мовою. All responses must be in Ukrainian language.';

  let lastError = 'Не вдалося отримати відповідь від Gemini';
  for (const model of GEMINI_MODELS) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const gRes = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: sysText }]
          },
          contents: contentsPayload,
          generationConfig
        }),
        signal: AbortSignal.timeout(options.timeoutMs || 25000)
      });

      if (gRes.ok) {
        const data = await gRes.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const rawText = parts.map(p => p.text || '').join('');
        if (rawText) {
          if (options.expectJson) {
            const parsed = parseAiJsonResponse(rawText);
            return { ok: true, result: parsed !== null ? parsed : rawText, rawText, model };
          }
          return { ok: true, result: rawText, rawText, model };
        }
      } else {
        const errData = await gRes.json().catch(() => ({}));
        const rawErr = errData.error ? `${errData.error.message} (${errData.error.code})` : `HTTP ${gRes.status}`;
        lastError = sanitizeGeminiMessage(rawErr, apiKey);
      }
    } catch (err) {
      lastError = sanitizeGeminiMessage(err.message, apiKey);
    }
  }
  return { ok: false, status: 502, error: lastError };
}

const sslDir = path.join(__dirname, 'ssl');
const certPath = path.join(sslDir, 'cert.pem');
const keyPath = path.join(sslDir, 'key.pem');

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashPasswordScrypt(plain, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return { salt, passwordHash: hash };
}

function verifyPasswordScrypt(plain, salt, expectedHash) {
  if (!plain || !salt || !expectedHash) return false;
  try {
    const derived = crypto.scryptSync(String(plain), salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

async function getOrCreateSslCert() {
  try {
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return {
        cert: fs.readFileSync(certPath, 'utf8'),
        key: fs.readFileSync(keyPath, 'utf8')
      };
    }
    if (!fs.existsSync(sslDir)) {
      fs.mkdirSync(sslDir, { recursive: true });
    }
    const selfsignedModule = await import('selfsigned');
    const generator = selfsignedModule.generate || selfsignedModule.default?.generate;
    const pems = await generator(
      [
        { name: 'commonName', value: 'localhost' },
        { name: 'organizationName', value: 'SecureExam' }
      ],
      {
        days: 365,
        keySize: 2048,
        algorithm: 'sha256'
      }
    );
    fs.writeFileSync(certPath, pems.cert, 'utf8');
    fs.writeFileSync(keyPath, pems.private, 'utf8');
    return { cert: pems.cert, key: pems.private };
  } catch (err) {
    console.error('SSL cert generation error:', err);
    return null;
  }
}

const rateLimitBuckets = new Map();
function createRateLimiter(options) {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 120;
  const message = options.message || 'Забагато запитів. Зачекайте хвилину.';
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const key = `${options.prefix || 'rl'}:${ip}`;
    const now = Date.now();
    let record = rateLimitBuckets.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 1, resetAt: now + windowMs };
      rateLimitBuckets.set(key, record);
      return next();
    }
    record.count++;
    if (record.count > max) {
      res.setHeader('Retry-After', Math.ceil((record.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitBuckets.entries()) {
    if (now > record.resetAt) {
      rateLimitBuckets.delete(key);
    }
  }
}, 300000);

const globalApiLimiter = createRateLimiter({ prefix: 'api', max: 180, windowMs: 60000 });
const loginLimiter = createRateLimiter({ prefix: 'login', max: 15, windowMs: 60000, message: 'Забагато спроб входу. Зачекайте 1 хвилину.' });
const supportLimiter = createRateLimiter({ prefix: 'support', max: 20, windowMs: 60000 });
const sessionStartLimiter = createRateLimiter({ prefix: 'ses_start', max: 35, windowMs: 60000 });
const aiLimiter = createRateLimiter({ prefix: 'ai', max: 20, windowMs: 60000, message: 'Забагато AI-запитів. Зачекайте 1 хвилину.' });

const app = express();
const server = http.createServer(app);
let httpsServer = null;

const wss = new WebSocketServer({ noServer: true });

function handleUpgrade(req, socket, head) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
}
server.on('upgrade', handleUpgrade);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use('/api/', globalApiLimiter);
app.use((req, res, next) => {
  if (/\.(html|js|css)$/.test(req.path)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const connectedStudents = new Map();
const connectedAdmins = new Set();

function broadcastToAdmins(payload) {
  const json = JSON.stringify(payload);
  for (const adminWs of connectedAdmins) {
    if (adminWs.readyState === WebSocket.OPEN) {
      adminWs.send(json);
    } else {
      connectedAdmins.delete(adminWs);
    }
  }
}

function sendToStudent(sessionId, payload) {
  const client = connectedStudents.get(sessionId);
  if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

const secretPath = process.env.ADMIN_SECRET_FILE
  ? path.resolve(process.env.ADMIN_SECRET_FILE)
  : path.join(__dirname, 'admin_secret.json');
const envPath = fs.existsSync(path.join(__dirname, '.env')) ? path.join(__dirname, '.env') : path.join(__dirname, '..', '.env');

function persistAdminSecretState(state) {
  try {
    fs.writeFileSync(secretPath, JSON.stringify({
      salt: state.salt,
      passwordHash: state.passwordHash,
      tokenSecret: state.tokenSecret,
      tokenVersion: state.tokenVersion,
      updatedAt: Date.now()
    }, null, 2), 'utf-8');
  } catch {}
}

function syncEnvAdminPasswordIfPresent(pwd) {
  try {
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf-8');
      if (content.includes('ADMIN_PASSWORD=')) {
        content = content.replace(/ADMIN_PASSWORD=.*(\r?\n|$)/, `ADMIN_PASSWORD=${pwd}$1`);
        fs.writeFileSync(envPath, content, 'utf-8');
      }
    }
  } catch {}
}

function generateInitialPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

let generatedOneTimePassword = null;

function initAdminAuth() {
  const envPwd = (process.env.ADMIN_PASSWORD || '').trim();
  let fileState = null;
  try {
    if (fs.existsSync(secretPath)) {
      fileState = JSON.parse(fs.readFileSync(secretPath, 'utf-8'));
    }
  } catch {}

  if (envPwd) {
    const hashed = hashPasswordScrypt(envPwd);
    const derivedSecret = crypto.createHmac('sha256', 'secureexam-token-key-v1').update(envPwd).digest('hex');
    const state = {
      salt: hashed.salt,
      passwordHash: hashed.passwordHash,
      tokenSecret: derivedSecret,
      tokenVersion: (fileState && Number(fileState.tokenVersion)) || 1
    };
    persistAdminSecretState(state);
    return state;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Set ADMIN_PASSWORD in the hosting provider environment before starting SecureExam.');
  }

  if (fileState && fileState.passwordHash && fileState.salt) {
    return {
      salt: fileState.salt,
      passwordHash: fileState.passwordHash,
      tokenSecret: fileState.tokenSecret || crypto.randomBytes(32).toString('hex'),
      tokenVersion: Number(fileState.tokenVersion) || 1
    };
  }

  if (fileState && fileState.adminPassword) {
    const hashed = hashPasswordScrypt(fileState.adminPassword);
    const state = {
      salt: hashed.salt,
      passwordHash: hashed.passwordHash,
      tokenSecret: crypto.randomBytes(32).toString('hex'),
      tokenVersion: 1
    };
    persistAdminSecretState(state);
    return state;
  }

  const freshPwd = generateInitialPassword();
  generatedOneTimePassword = freshPwd;
  const hashed = hashPasswordScrypt(freshPwd);
  const state = {
    salt: hashed.salt,
    passwordHash: hashed.passwordHash,
    tokenSecret: crypto.randomBytes(32).toString('hex'),
    tokenVersion: 1
  };
  persistAdminSecretState(state);
  return state;
}

const adminAuth = initAdminAuth();

function issueAdminToken() {
  const payload = {
    role: 'admin',
    v: adminAuth.tokenVersion,
    iat: Date.now(),
    exp: Date.now() + 24 * 60 * 60 * 1000,
    jti: crypto.randomBytes(8).toString('hex')
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigB64 = crypto.createHmac('sha256', adminAuth.tokenSecret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

function verifyAdminToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return false;
  const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return false;
  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);
  if (!payloadB64 || !sigB64) return false;
  const expectedSig = crypto.createHmac('sha256', adminAuth.tokenSecret).update(payloadB64).digest('base64url');
  if (!constantTimeEqual(sigB64, expectedSig)) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload || payload.role !== 'admin') return false;
    if (Number(payload.v) !== adminAuth.tokenVersion) return false;
    if (!payload.exp || Date.now() > Number(payload.exp)) return false;
    return true;
  } catch {
    return false;
  }
}

function extractStudentToken(req) {
  return req.headers['x-session-token'] || req.query?.studentToken || req.body?.studentToken || '';
}

function verifyStudentSessionToken(session, rawToken) {
  if (!session) return false;
  if (!session.studentToken) return true;
  return constantTimeEqual(String(rawToken || '').trim(), String(session.studentToken));
}

function sanitizeSessionForAdmin(session) {
  if (!session) return null;
  const { studentToken, ...rest } = session;
  return rest;
}

wss.on('connection', (ws) => {
  let boundRole = null;
  let boundSessionId = null;
  let isAuthenticated = false;

  ws.on('message', async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());

      if (message.type === 'register') {
        if (message.role === 'admin') {
          if (!verifyAdminToken(message.adminToken)) {
            ws.send(JSON.stringify({ type: 'auth_error', error: 'Недійсний токен адміністратора' }));
            ws.close(4001, 'Unauthorized');
            return;
          }
          boundRole = 'admin';
          boundSessionId = null;
          isAuthenticated = true;
          connectedAdmins.add(ws);

          const onlineList = [];
          for (const [sId, c] of connectedStudents.entries()) {
            const sess = await db.getSession(sId);
            onlineList.push({
              sessionId: sId,
              lastSeen: c.lastSeen,
              latency: c.latency || 0,
              questionIndex: c.questionIndex || 1,
              totalQuestions: c.totalQuestions || 1,
              isPaused: !!(sess && sess.isPaused)
            });
          }
          ws.send(JSON.stringify({
            type: 'online_students_snapshot',
            students: onlineList
          }));
          ws.send(JSON.stringify({
            type: 'exam_pause_changed',
            paused: globalExamPaused
          }));
          return;
        }

        const requestedSessionId = message.sessionId;
        if (!requestedSessionId || typeof requestedSessionId !== 'string') {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Не вказано ідентифікатор сесії' }));
          ws.close(4001, 'Missing session');
          return;
        }

        const sess = await db.getSession(requestedSessionId);
        if (!sess) {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Сесію не знайдено' }));
          ws.close(4001, 'Invalid session');
          return;
        }

        if (!verifyStudentSessionToken(sess, message.studentToken)) {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Невірний токен сесії' }));
          ws.close(4001, 'Unauthorized');
          return;
        }

        boundRole = 'student';
        boundSessionId = sess.id;
        isAuthenticated = true;

        connectedStudents.set(boundSessionId, {
          ws,
          lastSeen: Date.now(),
          latency: 0,
          questionIndex: 1,
          totalQuestions: (sess.questions || []).length || 1
        });

        broadcastToAdmins({
          type: 'student_status_change',
          sessionId: boundSessionId,
          status: 'online',
          timestamp: Date.now(),
          isPaused: !!sess.isPaused
        });

        if (sess.proctorBypassed) {
          ws.send(JSON.stringify({
            type: 'admin_override_bypass',
            trustScore: sess.trustScore || 70
          }));
        }

        if (globalExamPaused || sess.isPaused) {
          ws.send(JSON.stringify({
            type: 'exam_paused',
            scope: sess.isPaused ? 'individual' : 'global',
            message: sess.isPaused
              ? (sess.pauseMessage || 'Ваш екзамен тимчасово призупинено викладачем')
              : 'Екзамен тимчасово зупинений викладачем'
          }));
        }
        return;
      }

      if (!isAuthenticated) {
        ws.send(JSON.stringify({ type: 'auth_error', error: 'Спочатку виконайте автентифікацію' }));
        return;
      }

      if (message.type === 'teacher_warning') {
        if (boundRole !== 'admin') return;
        const targetSessionId = message.sessionId;
        sendToStudent(targetSessionId, {
          type: 'teacher_warning',
          message: message.message,
          level: message.level || 'warning',
          timestamp: Date.now()
        });
        await db.logIncident(targetSessionId, {
          category: 'teacher_warning',
          message: `Попередження від викладача: ${message.message}`,
          severity: message.level || 'warning'
        });
        return;
      }

      if (boundRole !== 'student' || !boundSessionId) return;

      if (message.type === 'student_progress') {
        const clientData = connectedStudents.get(boundSessionId);
        if (clientData) {
          clientData.questionIndex = message.questionIndex;
          clientData.totalQuestions = message.totalQuestions;
        }
        broadcastToAdmins({
          type: 'student_progress',
          sessionId: boundSessionId,
          questionIndex: message.questionIndex,
          totalQuestions: message.totalQuestions,
          timestamp: Date.now()
        });
        return;
      }

      if (message.type === 'ping') {
        const clientSent = message.clientTimestamp || Date.now();
        const serverNow = Date.now();
        const latency = message.latency || 0;

        const clientData = connectedStudents.get(boundSessionId);
        if (clientData) {
          clientData.lastSeen = serverNow;
          clientData.latency = latency;
        }
        await db.recordPing(boundSessionId, {
          latency,
          status: 'ok'
        });

        broadcastToAdmins({
          type: 'student_ping',
          sessionId: boundSessionId,
          latency,
          timestamp: serverNow
        });

        ws.send(JSON.stringify({
          type: 'pong',
          clientTimestamp: clientSent,
          serverTimestamp: serverNow
        }));
        return;
      }

      if (message.type === 'incident') {
        const recorded = await db.logIncident(boundSessionId, message.incident);
        broadcastToAdmins({
          type: 'new_incident',
          sessionId: boundSessionId,
          incident: recorded
        });
        return;
      }

      if (message.type === 'student_ack_warning') {
        broadcastToAdmins({
          type: 'student_ack_warning',
          sessionId: boundSessionId,
          timestamp: Date.now()
        });
        return;
      }
    } catch (err) {
      console.error(err);
    }
  });

  ws.on('close', () => {
    if (boundRole === 'admin') {
      connectedAdmins.delete(ws);
    } else if (boundRole === 'student' && boundSessionId) {
      const current = connectedStudents.get(boundSessionId);
      if (current && current.ws === ws) {
        connectedStudents.delete(boundSessionId);
        broadcastToAdmins({
          type: 'student_status_change',
          sessionId: boundSessionId,
          status: 'disconnected',
          timestamp: Date.now()
        });
      }
    }
  });
});

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.headers['authorization'];
  if (verifyAdminToken(token)) {
    return next();
  }
  return res.status(401).json({ error: 'Несанкціонований доступ' });
}

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password === 'string' && verifyPasswordScrypt(password.trim(), adminAuth.salt, adminAuth.passwordHash)) {
    return res.json({ success: true, token: issueAdminToken() });
  }
  return res.status(401).json({ error: 'Невірний пароль' });
});

app.get('/api/admin/verify-token', requireAdmin, (req, res) => {
  res.json({ valid: true });
});

app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !verifyPasswordScrypt(currentPassword.trim(), adminAuth.salt, adminAuth.passwordHash)) {
    return res.status(400).json({ error: 'Поточний пароль введено невірно' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 8) {
    return res.status(400).json({ error: 'Новий пароль має містити щонайменше 8 символів' });
  }
  const cleanNew = newPassword.trim();
  const hashed = hashPasswordScrypt(cleanNew);
  adminAuth.salt = hashed.salt;
  adminAuth.passwordHash = hashed.passwordHash;
  adminAuth.tokenVersion += 1;
  adminAuth.tokenSecret = process.env.ADMIN_PASSWORD
    ? crypto.createHmac('sha256', 'secureexam-token-key-v1').update(cleanNew).digest('hex')
    : crypto.randomBytes(32).toString('hex');
  if (process.env.ADMIN_PASSWORD) {
    process.env.ADMIN_PASSWORD = cleanNew;
  }
  persistAdminSecretState(adminAuth);
  syncEnvAdminPasswordIfPresent(cleanNew);
  res.json({ success: true, message: 'Пароль успішно змінено', token: issueAdminToken() });
});

app.post('/api/support/submit', supportLimiter, async (req, res) => {
  const { type, title, description, name, contact } = req.body || {};
  if (!type || !title || !description) return res.status(400).json({ error: 'Заповніть усі поля' });
  const ticket = {
    id: generateSecureId('ticket_', 6),
    type,
    title: title.trim(),
    description: description.trim(),
    name: (name || 'Анонім').trim(),
    contact: (contact || '').trim(),
    createdAt: new Date().toISOString(),
    status: 'new'
  };
  await db.saveSupportTicket(ticket);
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  let sheetsStatus = 'skipped';
  if (webhookUrl) {
    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ...ticket, secret: process.env.GOOGLE_SHEETS_SECRET || '' }),
        redirect: 'follow',
        signal: AbortSignal.timeout(10000)
      });
      const data = await resp.json().catch(() => null);
      sheetsStatus = data?.status || resp.status;
    } catch {
      sheetsStatus = 'error';
    }
  }
  res.json({ success: true, ticket, sheetsStatus });
});

app.get('/api/admin/support', requireAdmin, async (req, res) => {
  const tickets = await db.getSupportTickets();
  res.json(tickets);
});

app.delete('/api/admin/support/:id', requireAdmin, async (req, res) => {
  const ok = await db.deleteSupportTicket(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Тікет не знайдено' });
  res.json({ success: true });
});

app.get('/api/tests', async (req, res) => {
  const all = await db.getAllTests();
  const { topic, subject, search, classId } = req.query;
  let list = all.map(t => ({
    id: t.id,
    title: t.title,
    durationMinutes: t.durationMinutes || 15,
    questionsCount: (t.questions || []).length,
    topic: t.topic || '',
    subject: t.subject || '',
    tags: t.tags || []
  }));
  if (classId) {
    const cls = await db.getClass(classId);
    if (cls && Array.isArray(cls.assignedTests)) {
      list = list.filter(t => cls.assignedTests.includes(t.id));
    }
  }
  if (topic) list = list.filter(t => t.topic && t.topic.toLowerCase().includes(topic.toLowerCase()));
  if (subject) list = list.filter(t => t.subject && t.subject.toLowerCase().includes(subject.toLowerCase()));
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(t => t.title.toLowerCase().includes(q) || (t.topic || '').toLowerCase().includes(q) || (t.subject || '').toLowerCase().includes(q) || (t.tags || []).some(tag => tag.toLowerCase().includes(q)));
  }
  res.json(list);
});

app.get('/api/active-test', async (req, res) => {
  const activeId = await db.getActiveTestId();
  const liteMode = await db.getLiteMode();
  const test = await db.getTest(activeId);
  if (!test) {
    const all = await db.getAllTests();
    if (!all[0]) return res.status(404).json({ error: 'No tests' });
    return res.json({
      id: all[0].id,
      title: all[0].title,
      durationMinutes: all[0].durationMinutes || 15,
      questionsCount: (all[0].questions || []).length,
      topic: all[0].topic || '',
      subject: all[0].subject || '',
      liteMode
    });
  }
  res.json({
    id: test.id,
    title: test.title,
    durationMinutes: test.durationMinutes || 15,
    questionsCount: (test.questions || []).length,
    topic: test.topic || '',
    subject: test.subject || '',
    liteMode
  });
});

app.post('/api/admin/active-test', requireAdmin, async (req, res) => {
  const { testId, liteMode } = req.body;
  if (testId) {
    const ok = await db.setActiveTestId(testId);
    if (!ok) return res.status(404).json({ error: 'Test not found' });
  }
  if (typeof liteMode === 'boolean') await db.setLiteMode(liteMode);
  const currentActiveId = await db.getActiveTestId();
  res.json({ success: true, activeTestId: currentActiveId, liteMode: await db.getLiteMode() });
});

app.get('/api/classes', async (req, res) => {
  const classes = await db.getAllClasses();
  res.json(classes.map(c => ({
    id: c.id,
    name: c.name,
    grade: c.grade || '',
    subject: c.subject || '',
    description: c.description || '',
    assignedTests: c.assignedTests || []
  })));
});

app.get('/api/leaderboard', async (req, res) => {
  const list = await db.getLeaderboard(req.query.testId || null);
  res.json(list);
});

function sanitizeQuestionForStudent(q) {
  const imgs = Array.isArray(q.images) && q.images.length > 0 ? q.images : (q.imageUrl ? [q.imageUrl] : []);
  let text = q.text || '';
  let fillBlanksSegments = undefined;
  if (q.type === 'fill_blanks') {
    fillBlanksSegments = text.split(/\[[^\]]+\]/);
    text = text.replace(/\[([^\]]+)\]/g, '_______');
  }
  return {
    id: q.id,
    text,
    type: q.type || 'single',
    images: imgs,
    imageUrl: imgs[0] || (q.imageUrl || ''),
    options: q.options || [],
    matchingLeft: q.matchingLeft || (q.matchingPairs ? q.matchingPairs.map(p => p.left) : []),
    matchingRight: q.matchingRight || (q.matchingPairs ? q.matchingPairs.map(p => p.right) : []),
    orderingItems: q.type === 'ordering' ? (q.orderingItems || q.options || []) : undefined,
    blanksCount: q.type === 'fill_blanks' ? (Array.isArray(q.blanks) && q.blanks.length > 0 ? q.blanks.length : ((q.text || '').match(/\[([^\]]+)\]/g) || []).length) : undefined,
    fillBlanksSegments,
    hotspotPrompt: q.type === 'hotspot' ? (q.hotspotPrompt || 'Клікніть на правильну область на зображенні') : undefined,
    timeLimitSeconds: q.timeLimitSeconds
  };
}

app.get('/api/tests/:id', async (req, res) => {
  const test = await db.getTest(req.params.id);
  if (!test) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }

  const sanitizedQuestions = (test.questions || []).map(sanitizeQuestionForStudent);

  res.json({
    id: test.id,
    title: test.title,
    durationMinutes: test.durationMinutes,
    topic: test.topic || '',
    subject: test.subject || '',
    tags: test.tags || [],
    questions: sanitizedQuestions
  });
});

let globalDebugBypass = false;
let globalExamPaused = false;
let globalPauseStartedAt = null;

function getConfiguredDebugKey() {
  if (process.env.NODE_ENV === 'production') return '';
  return (process.env.DEV_DEBUG_KEY || '').trim();
}

app.post('/api/dev/debug-mode', loginLimiter, (req, res) => {
  const configuredKey = getConfiguredDebugKey();
  const key = (req.body && req.body.key ? String(req.body.key) : '').trim();
  if (!configuredKey || !constantTimeEqual(key, configuredKey)) {
    return res.status(403).json({ error: 'Режим розробника вимкнено або ключ доступу невірний' });
  }
  globalDebugBypass = !globalDebugBypass;
  if (globalDebugBypass) {
    for (const [, client] of connectedStudents.entries()) {
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'admin_override_bypass', trustScore: 100 }));
      }
    }
  }
  res.json({ success: true, debugMode: globalDebugBypass });
});

app.get('/api/dev/debug-mode', (req, res) => {
  res.json({ debugMode: globalDebugBypass, enabled: Boolean(getConfiguredDebugKey()) });
});

app.post('/api/admin/pause-exam', requireAdmin, (req, res) => {
  if (!globalExamPaused) {
    globalExamPaused = true;
    globalPauseStartedAt = Date.now();
  }
  const msg = req.body.message || 'Екзамен тимчасово зупинений викладачем';
  for (const [, client] of connectedStudents.entries()) {
    if (client.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'exam_paused',
        scope: 'global',
        message: msg
      }));
    }
  }
  broadcastToAdmins({ type: 'exam_pause_changed', paused: true });
  res.json({ success: true, paused: true });
});

app.post('/api/admin/resume-exam', requireAdmin, async (req, res) => {
  globalExamPaused = false;
  globalPauseStartedAt = null;
  for (const [sId, client] of connectedStudents.entries()) {
    if (client.ws && client.ws.readyState === WebSocket.OPEN) {
      const sess = await db.getSession(sId);
      if (sess && sess.isPaused) {
        client.ws.send(JSON.stringify({
          type: 'exam_paused',
          scope: 'individual',
          message: sess.pauseMessage || 'Ваш екзамен досі призупинено викладачем'
        }));
      } else {
        client.ws.send(JSON.stringify({ type: 'exam_resumed', scope: 'global' }));
      }
    }
  }
  broadcastToAdmins({ type: 'exam_pause_changed', paused: false });
  res.json({ success: true, paused: false });
});

app.get('/api/admin/pause-state', requireAdmin, (req, res) => {
  res.json({ paused: globalExamPaused });
});

app.post('/api/admin/sessions/:id/pause', requireAdmin, async (req, res) => {
  const session = await db.setSessionPaused(req.params.id, true, req.body?.message);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  sendToStudent(session.id, {
    type: 'exam_paused',
    scope: 'individual',
    message: session.pauseMessage || 'Ваш екзамен тимчасово призупинено викладачем'
  });
  broadcastToAdmins({
    type: 'session_pause_updated',
    sessionId: session.id,
    isPaused: true,
    pauseMessage: session.pauseMessage
  });
  res.json({ success: true, session: sanitizeSessionForAdmin(session) });
});

app.post('/api/admin/sessions/:id/resume', requireAdmin, async (req, res) => {
  const session = await db.setSessionPaused(req.params.id, false);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  if (!globalExamPaused) {
    sendToStudent(session.id, {
      type: 'exam_resumed',
      scope: 'individual'
    });
  } else {
    sendToStudent(session.id, {
      type: 'exam_paused',
      scope: 'global',
      message: 'Індивідуальну паузу знято, але триває загальна пауза для всього класу'
    });
  }
  broadcastToAdmins({
    type: 'session_pause_updated',
    sessionId: session.id,
    isPaused: false
  });
  res.json({ success: true, session: sanitizeSessionForAdmin(session) });
});

app.post('/api/admin/sessions/:id/allow-retake', requireAdmin, async (req, res) => {
  const session = await db.allowSessionRetake(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  broadcastToAdmins({
    type: 'session_retake_allowed',
    sessionId: session.id,
    testId: session.testId
  });
  res.json({ success: true, session: sanitizeSessionForAdmin(session) });
});

app.post('/api/sessions/start', sessionStartLimiter, async (req, res) => {
  const { studentName, studentId, testId, clientInfo, resumeSessionId, avatar } = req.body;

  if (resumeSessionId) {
    const existing = await db.getSession(resumeSessionId);
    if (existing && existing.status === 'in_progress') {
      if (!verifyStudentSessionToken(existing, extractStudentToken(req))) {
        return res.status(401).json({ error: 'Недійсний токен відновлення сесії' });
      }
      const sanitizedQuestions = (existing.questions || []).map(sanitizeQuestionForStudent);
      return res.json({
        id: existing.id,
        studentToken: existing.studentToken,
        testId: existing.testId,
        studentName: existing.studentName,
        studentId: existing.studentId,
        avatar: existing.avatar || null,
        startedAt: existing.startedAt,
        totalPausedMs: (existing.totalPausedMs || 0) + (existing.isPaused && existing.pausedAt ? Math.max(0, Date.now() - existing.pausedAt) : 0),
        isPaused: globalExamPaused || !!existing.isPaused,
        pauseMessage: existing.pauseMessage || '',
        attemptNumber: existing.attemptNumber || 1,
        clientIp: existing.clientIp,
        questions: sanitizedQuestions,
        partialAnswers: existing.partialAnswers || {},
        trustScore: existing.trustScore,
        proctorBypassed: globalDebugBypass || !!existing.proctorBypassed,
        isResumed: true
      });
    }
  }

  if (!studentName || !testId) {
    return res.status(400).json({ error: 'Необхідно вказати ім\'я та ідентифікатор тесту' });
  }

  const test = await db.getTest(testId);
  if (!test) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }

  const cleanName = String(studentName).trim();
  const cleanStudentId = String(studentId || '').trim() || ('ID-' + Math.floor(100000 + Math.random() * 900000));
  const prevFinished = await db.findLatestFinishedSessionForStudent(testId, cleanName, cleanStudentId);

  let attemptNumber = 1;
  let previousSessionId = null;

  if (prevFinished) {
    if (!prevFinished.retakeAllowed && !globalDebugBypass && !req.body.proctorBypassed) {
      return res.status(409).json({
        error: 'Ви вже завершили цей тест. Повторне складання можливе лише після дозволу викладача («Дозволити перескласти»).',
        code: 'RETAKE_NOT_ALLOWED',
        previousSessionId: prevFinished.id
      });
    }
    if (prevFinished.retakeAllowed) {
      await db.consumeRetakePermission(prevFinished.id);
    }
    attemptNumber = (prevFinished.attemptNumber || 1) + 1;
    previousSessionId = prevFinished.id;
  }

  const sessionId = generateSecureId('ses_', 12);
  const studentToken = crypto.randomBytes(24).toString('hex');
  const session = await db.createSession({
    id: sessionId,
    studentToken,
    testId,
    studentName: cleanName,
    studentId: cleanStudentId,
    avatar: avatar || null,
    attemptNumber,
    previousSessionId,
    clientIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
    clientInfo: clientInfo || {},
    proctorBypassed: globalDebugBypass || !!req.body.proctorBypassed
  });

  const rawQuestions = session.questions || test.questions || [];
  const sanitizedQuestions = rawQuestions.map(sanitizeQuestionForStudent);

  res.json({
    id: session.id,
    studentToken: session.studentToken,
    testId: session.testId,
    studentName: session.studentName,
    studentId: session.studentId,
    avatar: session.avatar || null,
    startedAt: session.startedAt,
    totalPausedMs: 0,
    isPaused: globalExamPaused,
    attemptNumber: session.attemptNumber || 1,
    clientIp: session.clientIp,
    questions: sanitizedQuestions,
    partialAnswers: {},
    trustScore: session.trustScore,
    proctorBypassed: globalDebugBypass || !!session.proctorBypassed,
    isResumed: false
  });
});

app.get('/api/sessions/:id/state', async (req, res) => {
  const session = await db.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  if (!verifyStudentSessionToken(session, extractStudentToken(req))) {
    return res.status(401).json({ error: 'Недійсний токен сесії' });
  }
  const test = await db.getTest(session.testId);
  const rawQuestions = session.questions || (test ? test.questions : []) || [];
  const sanitizedQuestions = rawQuestions.map(sanitizeQuestionForStudent);
  const activePauseExtra = (session.isPaused && session.pausedAt) ? Math.max(0, Date.now() - session.pausedAt) : 0;
  const globalPauseExtra = (!session.isPaused && globalExamPaused && globalPauseStartedAt) ? Math.max(0, Date.now() - globalPauseStartedAt) : 0;

  res.json({
    id: session.id,
    testId: session.testId,
    studentName: session.studentName,
    studentId: session.studentId,
    startedAt: session.startedAt,
    totalPausedMs: (session.totalPausedMs || 0) + activePauseExtra + globalPauseExtra,
    isPaused: globalExamPaused || !!session.isPaused,
    pauseMessage: session.isPaused ? (session.pauseMessage || 'Ваш екзамен тимчасово призупинено викладачем') : '',
    attemptNumber: session.attemptNumber || 1,
    durationMinutes: session.durationMinutes || (test && test.durationMinutes) || 15,
    status: session.status,
    trustScore: session.trustScore,
    proctorBypassed: globalDebugBypass || !!session.proctorBypassed,
    partialAnswers: session.partialAnswers || {},
    questions: sanitizedQuestions
  });
});

app.get('/api/sessions/:id/retake-status', async (req, res) => {
  const session = await db.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  if (!verifyStudentSessionToken(session, extractStudentToken(req))) {
    return res.status(401).json({ error: 'Недійсний токен сесії' });
  }
  res.json({
    retakeAllowed: !!session.retakeAllowed && !session.retakeUsed,
    retakeUsed: !!session.retakeUsed,
    attemptNumber: session.attemptNumber || 1
  });
});

app.post('/api/sessions/:id/answers', async (req, res) => {
  const session = await db.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  if (!verifyStudentSessionToken(session, extractStudentToken(req))) {
    return res.status(401).json({ error: 'Недійсний токен сесії' });
  }
  const { answers } = req.body;
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Некоректні відповіді' });
  }
  const saved = await db.savePartialAnswers(req.params.id, answers);
  if (!saved) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  res.json({ success: true, partialAnswers: saved });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'ok',
    version: readLocalVersion(),
    storage: db.isPostgres() ? 'postgres' : 'json',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

app.post('/api/ping', (req, res) => {
  const { clientTimestamp } = req.body;
  res.json({
    clientTimestamp: clientTimestamp || Date.now(),
    serverTimestamp: Date.now()
  });
});

app.post('/api/incidents', async (req, res) => {
  const { sessionId, incident } = req.body;
  if (!sessionId || !incident) {
    return res.status(400).json({ error: 'Невірні дані' });
  }
  const session = await db.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  if (!verifyStudentSessionToken(session, extractStudentToken(req))) {
    return res.status(401).json({ error: 'Недійсний токен сесії' });
  }

  const recorded = await db.logIncident(sessionId, incident);
  broadcastToAdmins({
    type: 'new_incident',
    sessionId,
    incident: recorded
  });

  res.json(recorded);
});

app.post('/api/sessions/submit', async (req, res) => {
  const { sessionId, answers, questionTimings } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'Не вказано sessionId' });
  }

  const existing = await db.getSession(sessionId);
  if (!existing) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  if (!verifyStudentSessionToken(existing, extractStudentToken(req))) {
    return res.status(401).json({ error: 'Недійсний токен сесії' });
  }

  const result = await db.submitTest(sessionId, { answers: answers || {}, questionTimings: questionTimings || {} });
  if (!result) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }

  const hasAiPending = Object.values(result.answers || {}).some(a => a && a.needsAiGrading);
  if (hasAiPending && getGeminiApiKey()) {
    runAiGradingForSession(result, db).catch(() => {});
  }

  broadcastToAdmins({
    type: 'session_completed',
    sessionId,
    result: sanitizeSessionForAdmin(result)
  });

  const answerReviewAvailable = result.status === 'completed' && !!result.answers;
  const wrongAnswers = Object.fromEntries(
    Object.entries(result.answers || {}).filter(([, answer]) => answer && !answer.isCorrect)
  );

  res.json({
    id: result.id,
    studentName: result.studentName,
    studentId: result.studentId,
    attemptNumber: result.attemptNumber || 1,
    scorePercentage: result.scorePercentage,
    score12: result.score12,
    rawScore: result.rawScore,
    totalQuestions: result.totalQuestions,
    trustScore: result.trustScore,
    status: result.status,
    finalVerdict: result.finalVerdict,
    answerReviewAvailable,
    wrongAnswers
  });
});

app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  const sessions = await db.getAllSessions();
  res.json(sessions.map(sanitizeSessionForAdmin));
});

app.get('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  const session = await db.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }

  const incidents = await db.getSessionIncidents(req.params.id);
  const pings = await db.getSessionPings(req.params.id);

  res.json({
    session: sanitizeSessionForAdmin(session),
    incidents,
    pings
  });
});

app.get('/api/admin/tests', requireAdmin, async (req, res) => {
  const tests = await db.getAllTests();
  res.json(tests);
});

app.post('/api/admin/tests', requireAdmin, async (req, res) => {
  const { title, durationMinutes, questions, topic, subject, tags, shuffleQuestions, shuffleOptions } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Вкажіть назву тесту' });
  }
  const created = await db.createTest({
    title: title.trim(),
    durationMinutes: parseInt(durationMinutes, 10) || 15,
    questions: Array.isArray(questions) ? questions : [],
    topic: topic || '',
    subject: subject || '',
    tags: Array.isArray(tags) ? tags : [],
    shuffleQuestions: !!shuffleQuestions,
    shuffleOptions: !!shuffleOptions
  });
  res.status(201).json(created);
});

app.delete('/api/admin/tests/:id', requireAdmin, async (req, res) => {
  const ok = await db.deleteTest(req.params.id);
  if (!ok) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }
  res.json({ success: true });
});

app.get('/api/admin/tests/:id/analytics', requireAdmin, async (req, res) => {
  const { classId } = req.query || {};
  const analytics = await db.getTestAnalytics(req.params.id, classId);
  if (!analytics) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }
  res.json(analytics);
});

app.get('/api/admin/tests/:id', requireAdmin, async (req, res) => {
  const test = await db.getTest(req.params.id);
  if (!test) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }
  res.json(test);
});

app.put('/api/admin/tests/:id', requireAdmin, async (req, res) => {
  const test = await db.getTest(req.params.id);
  if (!test) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }
  if (req.body.title !== undefined) test.title = req.body.title;
  if (req.body.durationMinutes !== undefined) test.durationMinutes = parseInt(req.body.durationMinutes, 10) || 15;
  if (req.body.topic !== undefined) test.topic = req.body.topic;
  if (req.body.subject !== undefined) test.subject = req.body.subject;
  if (req.body.tags !== undefined) test.tags = Array.isArray(req.body.tags) ? req.body.tags : [];
  if (req.body.questions !== undefined && Array.isArray(req.body.questions)) {
    test.questions = req.body.questions.map(q => {
      const copy = { ...q };
      if (copy.type === 'numeric') {
        const parsedTarget = parseNumericInput(copy.correct);
        const rawTol = Math.max(0, Math.abs(parseNumericInput(copy.numericTolerance) ?? 0));
        const tolEnabled = copy.numericToleranceEnabled !== undefined ? !!copy.numericToleranceEnabled : rawTol > 0;
        copy.correct = parsedTarget !== null ? parsedTarget : 0;
        copy.numericTolerance = tolEnabled ? rawTol : 0;
        copy.numericToleranceEnabled = tolEnabled && copy.numericTolerance > 0;
      }
      return copy;
    });
  }
  if (req.body.shuffleQuestions !== undefined) test.shuffleQuestions = !!req.body.shuffleQuestions;
  if (req.body.shuffleOptions !== undefined) test.shuffleOptions = !!req.body.shuffleOptions;
  await db.saveTest(test);
  res.json(test);
});

function parseQuestionPayload(body) {
  const { text, options, correct, numericTolerance, numericToleranceEnabled, useAiGrading, timeLimitSeconds, type, matchingPairs, orderingItems, blanks, hotspotTarget, imageUrl, images, correctKeywords, points, explanation } = body;
  const qType = type || 'single';
  let processedCorrect = 0;
  let processedTolerance = undefined;
  let processedToleranceEnabled = undefined;

  if (qType === 'multiple') {
    processedCorrect = Array.isArray(correct) ? correct.map(Number).filter(n => !isNaN(n)) : [0];
  } else if (qType === 'matching') {
    processedCorrect = typeof correct === 'object' && correct !== null ? correct : {};
  } else if (qType === 'ordering') {
    processedCorrect = Array.isArray(orderingItems) ? orderingItems : (Array.isArray(options) ? options : []);
  } else if (qType === 'short_answer') {
    processedCorrect = typeof correct === 'string' ? correct.trim() : String(correct || '');
  } else if (qType === 'numeric') {
    const parsedTarget = parseNumericInput(correct);
    if (parsedTarget === null) {
      return { error: 'Вкажіть коректне числове значення правильної відповіді' };
    }
    const parsedTol = numericTolerance !== undefined ? parseNumericInput(numericTolerance) : 0;
    if (parsedTol === null || parsedTol < 0) {
      return { error: 'Допустима похибка має бути невід’ємним числом' };
    }
    const tolEnabled = numericToleranceEnabled !== undefined ? !!numericToleranceEnabled : Math.abs(parsedTol) > 0;
    processedCorrect = parsedTarget;
    processedTolerance = tolEnabled ? Math.abs(parsedTol) : 0;
    processedToleranceEnabled = tolEnabled && processedTolerance > 0;
  } else if (qType === 'true_false') {
    processedCorrect = Number(correct) === 1 ? 1 : 0;
  } else {
    processedCorrect = parseInt(correct, 10);
    if (isNaN(processedCorrect) || processedCorrect < 0) processedCorrect = 0;
  }

  const finalImages = images !== undefined ? (Array.isArray(images) ? images : (images ? [images] : [])) : (imageUrl ? [imageUrl] : []);
  return {
    text,
    qType,
    finalImages,
    imageUrl: finalImages[0] || (imageUrl || ''),
    options: Array.isArray(options) ? options : [],
    matchingPairs: Array.isArray(matchingPairs) ? matchingPairs : [],
    orderingItems: Array.isArray(orderingItems) ? orderingItems : [],
    blanks: Array.isArray(blanks) ? blanks : [],
    hotspotTarget: hotspotTarget || null,
    processedCorrect,
    processedTolerance,
    processedToleranceEnabled,
    useAiGrading: qType === 'short_answer' ? !!useAiGrading : false,
    correctKeywords: Array.isArray(correctKeywords) ? correctKeywords : (typeof processedCorrect === 'string' ? processedCorrect.split(',').map(s => s.trim()).filter(Boolean) : []),
    points: Math.max(1, parseInt(points, 10) || 1),
    explanation: explanation ? String(explanation).trim() : '',
    timeLimitSeconds: parseInt(timeLimitSeconds, 10) || 60
  };
}

app.post('/api/admin/tests/:id/questions', requireAdmin, async (req, res) => {
  if (!req.body.text || !req.body.text.trim()) {
    return res.status(400).json({ error: 'Питання повинно містити текст' });
  }
  const parsed = parseQuestionPayload(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  const newQ = await db.addQuestion(req.params.id, {
    text: req.body.text.trim(),
    images: parsed.finalImages,
    imageUrl: parsed.imageUrl,
    options: parsed.options,
    matchingPairs: parsed.matchingPairs,
    orderingItems: parsed.orderingItems,
    blanks: parsed.blanks,
    hotspotTarget: parsed.hotspotTarget,
    correct: parsed.processedCorrect,
    numericTolerance: parsed.processedTolerance,
    numericToleranceEnabled: parsed.processedToleranceEnabled,
    correctKeywords: parsed.correctKeywords,
    points: parsed.points,
    explanation: parsed.explanation,
    timeLimitSeconds: parsed.timeLimitSeconds,
    type: parsed.qType,
    useAiGrading: parsed.useAiGrading
  });

  if (!newQ) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }
  res.status(201).json(newQ);
});

app.post('/api/admin/tests/:id/questions/bulk', requireAdmin, async (req, res) => {
  const { questions, replaceExisting } = req.body;
  const test = await db.getTest(req.params.id);
  if (!test) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Список питань порожній' });
  }

  if (replaceExisting) {
    test.questions = [];
  } else if (!test.questions) {
    test.questions = [];
  }

  const added = [];
  for (const q of questions) {
    if (!q.text || !q.text.trim()) continue;
    const parsed = parseQuestionPayload(q);
    if (parsed.error) continue;

    const newQuestion = {
      id: generateSecureId('q_', 6),
      text: q.text.trim(),
      type: parsed.qType,
      images: parsed.finalImages,
      imageUrl: parsed.imageUrl,
      options: parsed.options,
      matchingPairs: parsed.matchingPairs,
      orderingItems: parsed.orderingItems,
      blanks: parsed.blanks,
      hotspotTarget: parsed.hotspotTarget,
      correct: parsed.processedCorrect,
      numericTolerance: parsed.processedTolerance,
      numericToleranceEnabled: parsed.processedToleranceEnabled,
      useAiGrading: parsed.useAiGrading,
      correctKeywords: parsed.correctKeywords,
      points: parsed.points,
      explanation: parsed.explanation,
      timeLimitSeconds: parsed.timeLimitSeconds
    };
    test.questions.push(newQuestion);
    added.push(newQuestion);
  }

  await db.saveTest(test);
  res.json({ success: true, count: added.length, questions: added });
});

app.put('/api/admin/tests/:id/questions/:qId', requireAdmin, async (req, res) => {
  const parsed = parseQuestionPayload(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  const updated = await db.updateQuestion(req.params.id, req.params.qId, {
    text: req.body.text,
    images: req.body.images !== undefined ? parsed.finalImages : undefined,
    imageUrl: req.body.images !== undefined ? parsed.imageUrl : req.body.imageUrl,
    options: req.body.options,
    matchingPairs: req.body.matchingPairs,
    orderingItems: req.body.orderingItems,
    blanks: req.body.blanks !== undefined ? parsed.blanks : undefined,
    hotspotTarget: req.body.hotspotTarget !== undefined ? parsed.hotspotTarget : undefined,
    correct: parsed.processedCorrect,
    numericTolerance: parsed.processedTolerance,
    numericToleranceEnabled: parsed.processedToleranceEnabled,
    useAiGrading: parsed.useAiGrading,
    correctKeywords: parsed.correctKeywords,
    points: req.body.points !== undefined ? parsed.points : undefined,
    explanation: req.body.explanation !== undefined ? parsed.explanation : undefined,
    timeLimitSeconds: req.body.timeLimitSeconds,
    type: parsed.qType
  });
  if (!updated) {
    return res.status(404).json({ error: 'Питання або тест не знайдено' });
  }
  res.json(updated);
});

app.post('/api/admin/upload-image', requireAdmin, async (req, res) => {
  try {
    const { dataUrl } = req.body;
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Некоректний формат зображення' });
    }
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Некоректні base64 дані' });
    }
    const ext = matches[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const buffer = Buffer.from(matches[2], 'base64');
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const cleanName = 'img_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
    const filePath = path.join(uploadDir, cleanName);
    fs.writeFileSync(filePath, buffer);
    res.json({ success: true, url: '/uploads/' + cleanName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/sessions/:id/send-message', requireAdmin, async (req, res) => {
  const sessionId = req.params.id;
  const { message, level } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Повідомлення не може бути порожнім' });
  }
  const delivered = sendToStudent(sessionId, {
    type: 'teacher_warning',
    message: message.trim(),
    level: level || 'warning',
    timestamp: Date.now()
  });
  await db.logIncident(sessionId, {
    category: 'teacher_warning',
    message: `Попередження від викладача: ${message.trim()}`,
    severity: level || 'warning'
  });
  broadcastToAdmins({
    type: 'new_incident',
    sessionId,
    incident: {
      category: 'teacher_warning',
      message: `Надіслано учневі: ${message.trim()}`,
      severity: level || 'warning',
      timestamp: Date.now()
    }
  });
  res.json({ success: true, delivered });
});

app.get('/api/admin/ai-status', requireAdmin, (req, res) => {
  res.json({ enabled: !!getGeminiApiKey() });
});

app.post('/api/admin/ai-parse-import', requireAdmin, aiLimiter, async (req, res) => {
  try {
    const { rawText } = req.body;
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return res.status(400).json({ error: 'Введіть текст тесту для розпізнавання' });
    }
    const cleanText = rawText.trim().slice(0, 20000);

    if (getGeminiApiKey()) {
      const promptText = `Ти — експертний методист і парсер тестів українською мовою.
Твоє завдання — перетворити сирий текст тесту (з підручника, Word, сайту чи ЗНО) у структурований JSON.
Підтримуй типи питань:
1. "single": одна правильна відповідь. options: масив рядків, correct: індекс правильної відповіді (0, 1, 2...).
2. "multiple": кілька правильних відповідей. options: масив рядків, correct: масив індексів (наприклад [0, 2]).
3. "true_false": options: ["Неправда", "Правда"], correct: 0 або 1.
4. "matching": matchingPairs: [{"left": "...", "right": "..."}].
5. "ordering": orderingItems: масив елементів у правильному порядку.
6. "numeric": correct: число, numericTolerance: допустима похибка (число >= 0).

Якщо варіант позначено +, *, "вірно" чи вказано ключ відповідей в кінці, визнач правильну відповідь.
Час на питання timeLimitSeconds: 60.

Ось текст:
${cleanText}

Поверни результат ТІЛЬКИ як валідний JSON:
{
  "questions": [
    {
      "text": "Текст питання",
      "type": "single",
      "options": ["Варіант 1", "Варіант 2", "Варіант 3", "Варіант 4"],
      "correct": 0,
      "timeLimitSeconds": 60
    }
  ]
}`;

      const aiRes = await callGeminiServer(promptText, { expectJson: true, temperature: 0.2, timeoutMs: 45000 });
      if (aiRes.ok && aiRes.result && Array.isArray(aiRes.result.questions) && aiRes.result.questions.length > 0) {
        const normalizedImported = aiRes.result.questions
          .map(q => normalizeAiQuestion(q))
          .filter(Boolean);
        if (normalizedImported.length > 0) {
          return res.json({ success: true, source: 'gemini', questions: normalizedImported });
        }
      }
    }

    const fallbackQuestions = [];
    const blocks = cleanText.split(/(?=(?:^|\n)\s*(?:\d+[\.\)]|Питання\s*\d+[\.:]?))/i).map(b => b.trim()).filter(Boolean);

    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      const qText = lines[0].replace(/^\d+[\.\)]\s*|^Питання\s*\d+[\.:]?\s*/i, '').trim();
      const optLines = lines.slice(1);
      const options = [];
      let correctIdx = 0;

      optLines.forEach((ol) => {
        let isCorrect = false;
        let clean = ol;
        if (clean.includes('+') || clean.includes('*') || clean.toLowerCase().includes('(правильно)')) {
          isCorrect = true;
          clean = clean.replace(/[\+\*]|\(правильно\)/gi, '').trim();
        }
        clean = clean.replace(/^[А-ЯA-Z\d][\.\)]\s*/i, '').trim();
        if (clean) {
          if (isCorrect) correctIdx = options.length;
          options.push(clean);
        }
      });

      if (options.length >= 2) {
        fallbackQuestions.push({
          text: qText,
          type: 'single',
          options,
          correct: correctIdx,
          timeLimitSeconds: 60
        });
      }
    }

    if (fallbackQuestions.length > 0) {
      return res.json({ success: true, source: 'local_parser', questions: fallbackQuestions });
    }

    res.status(400).json({ error: 'Не вдалося розпізнати питання з тексту. Перевірте формат.' });
  } catch (err) {
    res.status(500).json({ error: sanitizeGeminiMessage(err.message, getGeminiApiKey()) });
  }
});

app.delete('/api/admin/tests/:id/questions/:qId', requireAdmin, async (req, res) => {
  const ok = await db.deleteQuestion(req.params.id, req.params.qId);
  if (!ok) {
    return res.status(404).json({ error: 'Питання або тест не знайдено' });
  }
  res.json({ success: true });
});

app.delete('/api/admin/tests/:id/questions', requireAdmin, async (req, res) => {
  const test = await db.getTest(req.params.id);
  if (!test) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }
  const removed = (test.questions || []).length;
  test.questions = [];
  await db.saveTest(test);
  res.json({ success: true, removed });
});

const ALLOWED_AI_QUESTION_TYPES = ['single', 'multiple', 'true_false', 'matching', 'ordering', 'numeric', 'short_answer'];

const AI_TYPE_ALIASES = {
  single: 'single',
  multiple: 'multiple',
  true_false: 'true_false',
  tf: 'true_false',
  boolean: 'true_false',
  matching: 'matching',
  match: 'matching',
  ordering: 'ordering',
  order: 'ordering',
  numeric: 'numeric',
  number: 'numeric',
  short_answer: 'short_answer',
  short: 'short_answer',
  open: 'short_answer'
};

function sanitizeQuestionTypes(rawTypes) {
  if (!Array.isArray(rawTypes) || rawTypes.length === 0) return ['single'];
  const unique = [];
  for (const t of rawTypes) {
    const mapped = AI_TYPE_ALIASES[String(t || '').trim().toLowerCase()];
    if (mapped && ALLOWED_AI_QUESTION_TYPES.includes(mapped) && !unique.includes(mapped)) {
      unique.push(mapped);
    }
  }
  return unique.length > 0 ? unique : ['single'];
}

function normalizeAiQuestion(rawQ, defaults = {}) {
  if (!rawQ || typeof rawQ !== 'object') return null;
  const text = String(rawQ.text || rawQ.question || '').trim();
  if (!text) return null;

  const rawTypeKey = String(rawQ.type || defaults.defaultType || 'single').trim().toLowerCase();
  let qType = AI_TYPE_ALIASES[rawTypeKey] || 'single';
  if (Array.isArray(defaults.allowedTypes) && defaults.allowedTypes.length > 0 && !defaults.allowedTypes.includes(qType)) {
    qType = defaults.allowedTypes[0];
  }

  const timeLimitSeconds = Math.max(10, Math.min(600, parseInt(rawQ.timeLimitSeconds || rawQ.timeLimit || defaults.timeLimitSeconds, 10) || 60));
  const points = Math.max(1, Math.min(20, parseInt(rawQ.points, 10) || 1));
  const explanation = String(rawQ.explanation || '').trim();
  const base = {
    id: generateSecureId('q_ai_', 6),
    text,
    type: qType,
    images: [],
    imageUrl: '',
    options: [],
    matchingPairs: [],
    orderingItems: [],
    blanks: [],
    correctKeywords: [],
    points,
    timeLimit: timeLimitSeconds,
    timeLimitSeconds,
    explanation
  };

  if (qType === 'true_false') {
    base.options = ['Неправда', 'Правда'];
    const cRaw = rawQ.correct !== undefined ? rawQ.correct : rawQ.correctAnswer;
    const cStr = String(cRaw).trim().toLowerCase();
    base.correct = (cRaw === true || cRaw === 1 || cStr === '1' || cStr === 'true' || cStr === 'правда') ? 1 : 0;
    return base;
  }

  if (qType === 'matching') {
    const rawPairs = Array.isArray(rawQ.matchingPairs) ? rawQ.matchingPairs : (Array.isArray(rawQ.pairs) ? rawQ.pairs : []);
    const pairs = rawPairs
      .map(p => ({
        left: String(p?.left || p?.a || p?.term || '').trim(),
        right: String(p?.right || p?.b || p?.definition || '').trim()
      }))
      .filter(p => p.left && p.right);
    if (pairs.length < 2) return null;
    base.matchingPairs = pairs;
    base.correct = {};
    return base;
  }

  if (qType === 'ordering') {
    const rawItems = Array.isArray(rawQ.orderingItems)
      ? rawQ.orderingItems
      : (Array.isArray(rawQ.items) ? rawQ.items : (Array.isArray(rawQ.options) ? rawQ.options : []));
    const items = rawItems.map(i => String(i || '').trim()).filter(Boolean);
    if (items.length < 2) return null;
    base.orderingItems = items;
    base.options = items;
    base.correct = items;
    return base;
  }

  if (qType === 'numeric') {
    const targetVal = parseNumericInput(rawQ.correct !== undefined ? rawQ.correct : rawQ.answer);
    if (targetVal === null) return null;
    const hintTol = defaults.numericToleranceHint;
    let rawTol = parseNumericInput(rawQ.numericTolerance);
    if (rawTol === null && hintTol !== undefined && hintTol !== null) {
      rawTol = parseNumericInput(hintTol);
    }
    const absTol = Math.max(0, Math.abs(rawTol ?? 0));
    const tolEnabled = hintTol === 0
      ? false
      : (rawQ.numericToleranceEnabled !== undefined ? !!rawQ.numericToleranceEnabled && absTol > 0 : absTol > 0);
    base.correct = targetVal;
    base.numericTolerance = tolEnabled ? absTol : 0;
    base.numericToleranceEnabled = tolEnabled;
    return base;
  }

  if (qType === 'short_answer') {
    let keywords = [];
    if (Array.isArray(rawQ.correctKeywords)) {
      keywords = rawQ.correctKeywords.map(k => String(k || '').trim()).filter(Boolean);
    }
    if (keywords.length === 0) {
      if (Array.isArray(rawQ.correct)) {
        keywords = rawQ.correct.map(k => String(k || '').trim()).filter(Boolean);
      } else if (rawQ.correct !== undefined || rawQ.answer !== undefined) {
        keywords = String(rawQ.correct !== undefined ? rawQ.correct : rawQ.answer)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      }
    }
    if (keywords.length === 0) return null;
    base.correct = keywords.join(', ');
    base.correctKeywords = keywords;
    base.useAiGrading = rawQ.useAiGrading !== undefined ? !!rawQ.useAiGrading : false;
    return base;
  }

  const opts = Array.isArray(rawQ.options) ? rawQ.options.map(o => String(o || '').trim()).filter(Boolean) : [];
  if (opts.length < 2) return null;
  base.options = opts;

  if (qType === 'multiple') {
    let corrArr = [];
    if (Array.isArray(rawQ.correct)) {
      corrArr = rawQ.correct.map(c => {
        if (typeof c === 'string' && isNaN(Number(c))) {
          return opts.findIndex(o => o.toLowerCase() === c.trim().toLowerCase());
        }
        return parseInt(c, 10);
      }).filter(n => !isNaN(n) && n >= 0 && n < opts.length);
    } else if (typeof rawQ.correct === 'number') {
      if (rawQ.correct >= 0 && rawQ.correct < opts.length) corrArr = [rawQ.correct];
    }
    corrArr = Array.from(new Set(corrArr)).sort((a, b) => a - b);
    if (corrArr.length === 0) corrArr = [0];
    base.correct = corrArr;
    return base;
  }

  let corrIdx = parseInt(rawQ.correct, 10);
  if ((isNaN(corrIdx) || corrIdx < 0 || corrIdx >= opts.length) && rawQ.correctAnswer !== undefined) {
    corrIdx = opts.findIndex(o => o.toLowerCase() === String(rawQ.correctAnswer).trim().toLowerCase());
  }
  if (isNaN(corrIdx) || corrIdx < 0 || corrIdx >= opts.length) corrIdx = 0;
  base.correct = corrIdx;
  return base;
}

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/g, '&');
}

function extractTextFromDocxBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return '';
  const minOffset = Math.max(0, buf.length - 65557);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return '';

  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > buf.length) return '';

  let pos = cdOffset;
  let xmlString = '';
  while (pos + 46 <= cdOffset + cdSize) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const entryName = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');

    if (entryName === 'word/document.xml') {
      if (localOffset + 30 <= buf.length && buf.readUInt32LE(localOffset) === 0x04034b50) {
        const lfhNameLen = buf.readUInt16LE(localOffset + 26);
        const lfhExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
        if (dataStart + compSize <= buf.length) {
          const compSlice = buf.subarray(dataStart, dataStart + compSize);
          let xmlBuf = null;
          if (method === 0) xmlBuf = compSlice;
          else if (method === 8) xmlBuf = zlib.inflateRawSync(compSlice);
          if (xmlBuf) {
            xmlString = xmlBuf.toString('utf8');
            break;
          }
        }
      }
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }

  if (!xmlString) return '';
  return decodeXmlEntities(
    xmlString
      .replace(/<w:tab\b[^>]*\/?>/gi, ' ')
      .replace(/<\/w:tc>/gi, ' | ')
      .replace(/<w:br\b[^>]*\/?>|<\/w:p>|<\/w:tr>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildGenerationPrompt({
  topic,
  subject,
  grade,
  difficultyText,
  count,
  timeLimit,
  allowedTypes,
  sourceText,
  customInstructions,
  excludeQuestions,
  numericToleranceHint,
  tweakNote
}) {
  const typeDescriptions = {
    single: '"single" — 1 правильний варіант. Поля: "type":"single", "options":["...","...","...","..."], "correct":0..3 (індекс).',
    multiple: '"multiple" — кілька правильних відповідей (2-3 з 4-5). Поля: "type":"multiple", "options":["...","...","...","..."], "correct":[0,2] (масив індексів).',
    true_false: '"true_false" — твердження Правда/Неправда. Поля: "type":"true_false", "options":["Неправда","Правда"], "correct": 0 або 1 (1 = Правда, 0 = Неправда).',
    matching: '"matching" — встановлення відповідності (3-4 пари). Поля: "type":"matching", "matchingPairs":[{"left":"...","right":"..."},{"left":"...","right":"..."},{"left":"...","right":"..."}].',
    ordering: '"ordering" — правильна послідовність / хронологія (4 елементи). Поля: "type":"ordering", "orderingItems":["Крок 1","Крок 2","Крок 3","Крок 4"] (у правильному порядку).',
    numeric: `"numeric" — числова задача. Поля: "type":"numeric", "correct": число (наприклад 9.8), "numericTolerance": ${numericToleranceHint !== undefined && numericToleranceHint !== null ? Number(numericToleranceHint) : 0.2}, "numericToleranceEnabled": ${numericToleranceHint === 0 ? 'false' : 'true'}.`,
    short_answer: '"short_answer" — коротка відкрита відповідь. Поля: "type":"short_answer", "correctKeywords":["варіант 1","синонім"], "useAiGrading": false.'
  };

  const selectedSpecs = allowedTypes.map((t, i) => `${i + 1}) ${typeDescriptions[t]}`).filter(Boolean).join('\n');
  const cleanSource = String(sourceText || '').trim().slice(0, 24000);
  const excludeList = Array.isArray(excludeQuestions)
    ? excludeQuestions.map(q => String(q || '').trim().slice(0, 140)).filter(Boolean).slice(-60)
    : [];

  return `Ти — досвідчений викладач та методист.
Склади навчальні тестові завдання українською мовою.
${subject ? `Предмет: "${String(subject).trim().slice(0, 120)}".` : ''}
${grade ? `Клас / аудиторія: "${String(grade).trim().slice(0, 120)}".` : ''}
${topic ? `Тема: "${String(topic).trim().slice(0, 500)}".` : ''}
Рівень складності: ${difficultyText}.
Кількість питань у цій партії: ${count}.
Час на одне питання за замовчуванням: ${timeLimit} сек.
${tweakNote ? `Особлива задача: ${tweakNote}` : ''}
${customInstructions ? `Додаткові побажання викладача: ${String(customInstructions).trim().slice(0, 1200)}` : ''}

${cleanSource ? `ОПОРНИЙ МАТЕРІАЛ / КОНСПЕКТ (СУВОРО: формуй запитання, числа, терміни та відповіді ВИКЛЮЧНО на основі цього тексту, не вигадуй сторонніх фактів поза матеріалом):
"""
${cleanSource}
"""` : ''}

${excludeList.length > 0 ? `УЖЕ ІСНУЮЧІ ПИТАННЯ (НЕ ПОВТОРЮЙ їх і не перефразовуй те саме, придумай інші питання на інші аспекти теми):
${excludeList.map((q, idx) => `- ${idx + 1}. ${q}`).join('\n')}` : ''}

ДОЗВОЛЕНІ ТИПИ ЗАВДАНЬ (чергуй і використовуй ТІЛЬКИ ці типи, пропорційно розподіливши між ${count} питаннями):
${selectedSpecs}

ЗАГАЛЬНІ ВИМОГИ ДО ЯКОСТІ:
1. Формулювання мають бути грамотними, точними й однозначними, без очевидних дистракторів чи слів-заглушок ("Варіант А").
2. Для кожного питання ОБОВ'ЯЗКОВО додай поле "explanation" (1-2 речення науково точного пояснення правильної відповіді).
3. Для кожного питання вкажи "timeLimitSeconds": ${timeLimit} та "points": 1 (для matching/ordering можна 2-3).

Поверни ВИКЛЮЧНО валідний JSON:
{
  "title": "Назва тесту відповідно до теми",
  "questions": [
    {
      "text": "Текст питання",
      "type": "${allowedTypes[0]}",
      "options": ["Варіант 1", "Варіант 2", "Варіант 3", "Варіант 4"],
      "correct": 0,
      "points": 1,
      "timeLimitSeconds": ${timeLimit},
      "explanation": "Пояснення"
    }
  ]
}`;
}

app.post('/api/admin/extract-document-text', requireAdmin, aiLimiter, async (req, res) => {
  try {
    const { fileName = '', mimeType = '', base64Data = '', text = '' } = req.body || {};
    if (text && typeof text === 'string' && text.trim()) {
      const clean = text.trim();
      return res.json({
        success: true,
        text: clean.slice(0, 35000),
        truncated: clean.length > 35000,
        charCount: Math.min(clean.length, 35000),
        source: 'plain_text'
      });
    }

    const cleanB64 = String(base64Data || '').replace(/^data:[^;]+;base64,/i, '').trim();
    if (!cleanB64) {
      return res.status(400).json({ error: 'Файл порожній або не передано вміст' });
    }
    const fileBuf = Buffer.from(cleanB64, 'base64');
    if (fileBuf.length === 0 || fileBuf.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Підтримуються файли розміром до 10 МБ' });
    }

    const lowerName = String(fileName || '').toLowerCase();
    const lowerMime = String(mimeType || '').toLowerCase();

    if (lowerName.endsWith('.docx') || lowerMime.includes('wordprocessingml')) {
      const extracted = extractTextFromDocxBuffer(fileBuf);
      if (!extracted) {
        return res.status(400).json({ error: 'Не вдалося витягнути текст із DOCX. Перевірте файл або скопіюйте текст вручну.' });
      }
      return res.json({
        success: true,
        text: extracted.slice(0, 35000),
        truncated: extracted.length > 35000,
        charCount: Math.min(extracted.length, 35000),
        source: 'docx_xml'
      });
    }

    if (lowerName.endsWith('.doc')) {
      return res.status(400).json({ error: 'Старий формат .doc не підтримується напряму — перезбережіть файл у .docx або .pdf чи вставте текст.' });
    }

    if (lowerName.endsWith('.pdf') || lowerMime.includes('pdf')) {
      if (!getGeminiApiKey()) {
        return res.status(503).json({ error: 'Для розпізнавання PDF потрібен налаштований GEMINI_API_KEY на сервері.' });
      }
      const aiRes = await callGeminiServer(
        'Витягни повний навчальний текст, терміни, формули, визначення, дати, числа та ключові факти з цього PDF-документа без скорочень і вигадувань. Поверни лише чистий структурований текст.',
        {
          inlineData: { mimeType: 'application/pdf', data: cleanB64 },
          timeoutMs: 55000,
          maxOutputTokens: 8192
        }
      );
      if (!aiRes.ok || !aiRes.result) {
        return res.status(aiRes.status || 502).json({ error: `Не вдалося прочитати PDF через Gemini: ${aiRes.error || 'невідома помилка'}` });
      }
      const pdfText = String(aiRes.result).trim();
      return res.json({
        success: true,
        text: pdfText.slice(0, 35000),
        truncated: pdfText.length > 35000,
        charCount: Math.min(pdfText.length, 35000),
        source: 'gemini_pdf'
      });
    }

    const decoded = fileBuf.toString('utf8').trim();
    if (!decoded) {
      return res.status(400).json({ error: 'Текстовий файл порожній' });
    }
    return res.json({
      success: true,
      text: decoded.slice(0, 35000),
      truncated: decoded.length > 35000,
      charCount: Math.min(decoded.length, 35000),
      source: 'text_file'
    });
  } catch (err) {
    res.status(500).json({ error: sanitizeGeminiMessage(err.message, getGeminiApiKey()) });
  }
});

const DIFFICULTY_DESCRIPTION_MAP = {
  easy: 'початковий / базовий (основні поняття, терміни та базові факти)',
  medium: 'середній (розуміння принципів, типові задачі та практичне застосування)',
  hard: 'складний / достатній (глибокий аналіз, порівняння, винятки та нестандартні ситуації)',
  olympiad: 'олімпіадний / ЗНО / НМТ високого рівня (комплексні задачі, тонкі дистрактори)'
};

app.post('/api/admin/generate-test', requireAdmin, aiLimiter, async (req, res) => {
  try {
    const {
      topic = '',
      subject = '',
      grade = '',
      count = 5,
      difficulty = 'medium',
      timeLimitSeconds = 60,
      customInstructions = '',
      sourceText = '',
      questionTypes = ['single'],
      excludeQuestions = [],
      numericToleranceHint,
      testId = 'demo-test-1',
      applyToTest = false,
      replaceExisting = false
    } = req.body || {};

    const cleanTopic = typeof topic === 'string' ? topic.trim() : '';
    const cleanSource = typeof sourceText === 'string' ? sourceText.trim() : '';
    if (!cleanTopic && !cleanSource) {
      return res.status(400).json({ error: 'Вкажіть тему тесту або додайте опорний текст / конспект' });
    }
    if (!getGeminiApiKey()) {
      return res.status(503).json({ error: 'GEMINI_API_KEY не налаштований на сервері' });
    }

    const questionCount = Math.max(1, Math.min(50, parseInt(count, 10) || 5));
    const timeLimit = Math.max(10, Math.min(600, parseInt(timeLimitSeconds, 10) || 60));
    const allowedTypes = sanitizeQuestionTypes(questionTypes);
    const difficultyText = DIFFICULTY_DESCRIPTION_MAP[difficulty] || (typeof difficulty === 'string' && difficulty.trim() ? difficulty.trim() : DIFFICULTY_DESCRIPTION_MAP.medium);

    const promptText = buildGenerationPrompt({
      topic: cleanTopic,
      subject,
      grade,
      difficultyText,
      count: questionCount,
      timeLimit,
      allowedTypes,
      sourceText: cleanSource,
      customInstructions,
      excludeQuestions,
      numericToleranceHint
    });

    const aiRes = await callGeminiServer(promptText, {
      expectJson: true,
      temperature: 0.65,
      timeoutMs: 55000,
      maxOutputTokens: 8192
    });
    if (!aiRes.ok) {
      return res.status(aiRes.status || 502).json({ error: `Помилка запиту до Gemini API: ${aiRes.error}` });
    }

    const parsed = typeof aiRes.result === 'string' ? parseAiJsonResponse(aiRes.result) : aiRes.result;
    const rawQuestions = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.questions) ? parsed.questions : []);
    if (rawQuestions.length === 0) {
      return res.status(502).json({ error: 'ШІ не сформував жодного питання' });
    }

    const validatedQuestions = rawQuestions
      .map(q => normalizeAiQuestion(q, {
        defaultType: allowedTypes[0],
        allowedTypes,
        timeLimitSeconds: timeLimit,
        numericToleranceHint
      }))
      .filter(Boolean);

    if (validatedQuestions.length === 0) {
      return res.status(502).json({ error: 'Питання від ШІ не пройшли валідацію формату' });
    }

    let applied = false;
    let savedTest = null;
    if (applyToTest && testId) {
      const test = await db.getTest(testId);
      if (test) {
        if (parsed && parsed.title && typeof parsed.title === 'string' && parsed.title.trim()) {
          test.title = parsed.title.trim();
        }
        if (replaceExisting) {
          test.questions = validatedQuestions;
        } else {
          test.questions = (test.questions || []).concat(validatedQuestions);
        }
        savedTest = await db.saveTest(test);
        applied = true;
      }
    }

    res.json({
      success: true,
      title: (parsed && parsed.title) || cleanTopic || 'Тест за конспектом',
      questions: validatedQuestions,
      applied,
      test: savedTest
    });
  } catch (err) {
    res.status(500).json({ error: sanitizeGeminiMessage(err.message, getGeminiApiKey()) });
  }
});

app.post('/api/admin/ai/regenerate-question', requireAdmin, aiLimiter, async (req, res) => {
  try {
    const {
      topic = '',
      subject = '',
      grade = '',
      difficulty = 'medium',
      sourceText = '',
      question = null,
      tweak = 'replace',
      allowedTypes = [],
      excludeQuestions = [],
      timeLimitSeconds = 60,
      numericToleranceHint
    } = req.body || {};

    if (!getGeminiApiKey()) {
      return res.status(503).json({ error: 'GEMINI_API_KEY не налаштований на сервері' });
    }
    if (!question || typeof question !== 'object') {
      return res.status(400).json({ error: 'Не передано питання для перегенерації' });
    }

    const timeLimit = Math.max(10, Math.min(600, parseInt(timeLimitSeconds || question.timeLimitSeconds || question.timeLimit, 10) || 60));
    const targetType = AI_TYPE_ALIASES[String(question.type || '').toLowerCase()] || 'single';
    const typeList = Array.isArray(allowedTypes) && allowedTypes.length > 0
      ? sanitizeQuestionTypes(allowedTypes)
      : [targetType];
    if (!typeList.includes(targetType)) typeList.unshift(targetType);

    let tweakNote = `Заміни наведене запитання ЦІЛКОМ НОВИМ іншим запитанням типу "${targetType}" на інший факт або задачу з цієї ж теми: "${String(question.text || '').slice(0, 300)}".`;
    if (tweak === 'harder') {
      tweakNote = `УСКЛАДНИ це запитання (глибший аналіз, тонші дистрактори або багатоходова задача, збережи тип "${targetType}"): "${String(question.text || '').slice(0, 300)}".`;
    } else if (tweak === 'easier') {
      tweakNote = `СПРОСТИ це запитання (зроби формулювання доступнішим і базовим, збережи тип "${targetType}"): "${String(question.text || '').slice(0, 300)}".`;
    }

    const difficultyText = DIFFICULTY_DESCRIPTION_MAP[difficulty] || (typeof difficulty === 'string' && difficulty.trim() ? difficulty.trim() : DIFFICULTY_DESCRIPTION_MAP.medium);
    const mergedExclude = tweak === 'replace'
      ? [...(Array.isArray(excludeQuestions) ? excludeQuestions : []), question.text].filter(Boolean)
      : excludeQuestions;

    const promptText = buildGenerationPrompt({
      topic,
      subject,
      grade,
      difficultyText,
      count: 1,
      timeLimit,
      allowedTypes: [targetType],
      sourceText,
      customInstructions: '',
      excludeQuestions: mergedExclude,
      numericToleranceHint,
      tweakNote
    });

    const aiRes = await callGeminiServer(promptText, {
      expectJson: true,
      temperature: tweak === 'replace' ? 0.8 : 0.45,
      timeoutMs: 35000,
      maxOutputTokens: 4096
    });
    if (!aiRes.ok) {
      return res.status(aiRes.status || 502).json({ error: aiRes.error });
    }

    const parsed = typeof aiRes.result === 'string' ? parseAiJsonResponse(aiRes.result) : aiRes.result;
    let rawItem = null;
    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) rawItem = parsed.questions[0];
    else if (Array.isArray(parsed) && parsed.length > 0) rawItem = parsed[0];
    else if (parsed && typeof parsed === 'object' && parsed.text) rawItem = parsed;

    const normalized = normalizeAiQuestion(rawItem, {
      defaultType: targetType,
      allowedTypes: [targetType],
      timeLimitSeconds: timeLimit,
      numericToleranceHint
    });
    if (!normalized) {
      return res.status(502).json({ error: 'ШІ не зміг коректно перегенерувати питання. Спробуйте ще раз.' });
    }

    res.json({ success: true, question: normalized });
  } catch (err) {
    res.status(500).json({ error: sanitizeGeminiMessage(err.message, getGeminiApiKey()) });
  }
});

app.post('/api/admin/gemini/prompt', requireAdmin, aiLimiter, async (req, res) => {
  try {
    const { prompt, expectJson, history, systemInstruction, timeoutMs } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Порожній запит' });
    }
    const callOptions = {
      expectJson: !!expectJson,
      maxOutputTokens: 8192,
      timeoutMs: Math.max(10000, Math.min(60000, parseInt(timeoutMs, 10) || 35000))
    };
    if (typeof systemInstruction === 'string' && systemInstruction.trim()) {
      callOptions.systemInstruction = systemInstruction.trim();
    }
    if (Array.isArray(history) && history.length > 0) {
      callOptions.contents = history.slice(-10).map(h => ({
        role: h?.role === 'model' ? 'model' : 'user',
        text: String(h?.text || '').slice(0, 8000)
      })).filter(h => h.text);
    }
    const aiRes = await callGeminiServer(prompt, callOptions);
    if (!aiRes.ok) {
      return res.status(aiRes.status || 502).json({ error: aiRes.error });
    }
    res.json({ success: true, result: aiRes.result });
  } catch (err) {
    res.status(500).json({ error: sanitizeGeminiMessage(err.message, getGeminiApiKey()) });
  }
});

app.post('/api/admin/sessions/:id/override-unlock', requireAdmin, async (req, res) => {
  const session = await db.adminOverrideUnlock(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  broadcastToAdmins({ type: 'session_unlocked', sessionId: req.params.id, trustScore: session.trustScore });
  sendToStudent(req.params.id, { type: 'admin_override_unlock', trustScore: session.trustScore });
  res.json({ success: true, session: sanitizeSessionForAdmin(session) });
});

app.post('/api/admin/sessions/:id/override-bypass', requireAdmin, async (req, res) => {
  const session = await db.adminOverrideBypass(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  sendToStudent(req.params.id, { type: 'admin_override_bypass', trustScore: session.trustScore });
  broadcastToAdmins({ type: 'session_bypassed', sessionId: req.params.id, trustScore: session.trustScore });
  res.json({ success: true, session: sanitizeSessionForAdmin(session) });
});

app.patch('/api/admin/sessions/:id/override-score', requireAdmin, async (req, res) => {
  const { score12 } = req.body;
  if (score12 === undefined || score12 === null || isNaN(Number(score12))) {
    return res.status(400).json({ error: 'Вкажіть оцінку від 1 до 12' });
  }
  const session = await db.adminOverrideScore(req.params.id, score12);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  broadcastToAdmins({ type: 'session_score_overridden', sessionId: req.params.id, score12: session.score12 });
  res.json({ success: true, session: sanitizeSessionForAdmin(session) });
});

app.post('/api/admin/sessions/:id/add-time', requireAdmin, async (req, res) => {
  const { minutes } = req.body;
  const mins = parseInt(minutes, 10) || 5;
  const session = await db.addSessionTime(req.params.id, mins);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  sendToStudent(req.params.id, { type: 'time_extended', minutes: mins });
  broadcastToAdmins({
    type: 'session_time_extended',
    sessionId: req.params.id,
    minutes: mins,
    durationMinutes: session.durationMinutes,
    extraTimeMinutes: session.extraTimeMinutes
  });
  res.json({ success: true, session: sanitizeSessionForAdmin(session), addedMinutes: mins });
});

app.delete('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  const ok = await db.deleteSession(req.params.id);
  if (!ok) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  broadcastToAdmins({ type: 'session_deleted', sessionId: req.params.id });
  res.json({ success: true });
});

app.delete('/api/admin/sessions', requireAdmin, async (req, res) => {
  const { classId, status } = req.query || req.body || {};
  if (classId || status) {
    const count = await db.deleteSessionsByFilter({ classId, status });
    broadcastToAdmins({ type: 'all_sessions_cleared' });
    return res.json({ success: true, count });
  }
  const count = await db.clearAllSessions();
  broadcastToAdmins({ type: 'all_sessions_cleared' });
  res.json({ success: true, count });
});

app.get('/api/admin/classes', requireAdmin, async (req, res) => {
  const classes = await db.getAllClasses();
  res.json(classes);
});

app.get('/api/admin/classes/:id', requireAdmin, async (req, res) => {
  const cls = await db.getClass(req.params.id);
  if (!cls) return res.status(404).json({ error: 'Клас не знайдено' });
  res.json(cls);
});

app.post('/api/admin/classes', requireAdmin, async (req, res) => {
  const { name, description, grade, subject } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Вкажіть назву класу' });
  const created = await db.createClass({ name: name.trim(), description, grade, subject });
  res.status(201).json(created);
});

app.put('/api/admin/classes/:id', requireAdmin, async (req, res) => {
  const updated = await db.updateClass(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Клас не знайдено' });
  res.json(updated);
});

app.delete('/api/admin/classes/:id', requireAdmin, async (req, res) => {
  const ok = await db.deleteClass(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Клас не знайдено' });
  res.json({ success: true });
});

app.post('/api/admin/classes/:id/students', requireAdmin, async (req, res) => {
  const { name, id: studentId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Вкажіть ім\'я учня' });
  const updated = await db.addStudentToClass(req.params.id, { name: name.trim(), id: studentId });
  if (!updated) return res.status(404).json({ error: 'Клас не знайдено' });
  res.json(updated);
});

app.delete('/api/admin/classes/:id/students/:studentId', requireAdmin, async (req, res) => {
  const updated = await db.removeStudentFromClass(req.params.id, req.params.studentId);
  if (!updated) return res.status(404).json({ error: 'Клас не знайдено' });
  res.json(updated);
});

app.post('/api/admin/classes/:id/tests', requireAdmin, async (req, res) => {
  const { testId } = req.body;
  if (!testId) return res.status(400).json({ error: 'Вкажіть ID тесту' });
  const updated = await db.assignTestToClass(req.params.id, testId);
  if (!updated) return res.status(404).json({ error: 'Клас не знайдено' });
  res.json(updated);
});

app.delete('/api/admin/classes/:id/tests/:testId', requireAdmin, async (req, res) => {
  const updated = await db.removeTestFromClass(req.params.id, req.params.testId);
  if (!updated) return res.status(404).json({ error: 'Клас не знайдено' });
  res.json(updated);
});

function getLocalNetworkIp() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch {}
  return 'localhost';
}

app.get('/api/tunnel', async (req, res) => {
  const localIp = getLocalNetworkIp();
  const localUrl = `http://${localIp}:${PORT}`;
  try {
    const tunnelRes = await fetch('http://127.0.0.1:4040/api/tunnels');
    if (tunnelRes.ok) {
      const data = await tunnelRes.json();
      if (data.tunnels && data.tunnels.length > 0) {
        const httpsTunnel = data.tunnels.find(t => t.public_url.startsWith('https://')) || data.tunnels[0];
        return res.json({
          active: true,
          type: 'ngrok',
          publicUrl: httpsTunnel.public_url,
          localUrl
        });
      }
    }
  } catch {}

  res.json({
    active: false,
    publicUrl: null,
    localUrl
  });
});

function readLocalManifest() {
  try {
    const vPath = path.join(__dirname, '..', 'version.json');
    if (fs.existsSync(vPath)) {
      return JSON.parse(fs.readFileSync(vPath, 'utf-8'));
    }
  } catch {}
  return {};
}

function readLocalVersion() {
  return readLocalManifest().version || '1.0.0';
}

function isNewerVersion(remote, local) {
  const parse = v => (v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const [rMaj = 0, rMin = 0, rPat = 0] = parse(remote);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

function readLocalAnnouncement() {
  try {
    const vPath = path.join(__dirname, '..', 'version.json');
    if (fs.existsSync(vPath)) {
      const v = JSON.parse(fs.readFileSync(vPath, 'utf-8'));
      return v.announcement || null;
    }
  } catch {}
  return null;
}

app.get('/api/admin/update/check', requireAdmin, async (req, res) => {
  const localManifest = readLocalManifest();
  const currentVersion = localManifest.version || '1.2.3';
  const simulate = req.query.simulate === '1' || process.env.SIMULATE_UPDATE === 'true';

  if (simulate) {
    return res.json({
      hasUpdate: true,
      currentVersion,
      latestVersion: '1.2.3',
      changelog: 'Оновлено: Каталог тестів, перемішування питань/відповідей (Shuffle), загальна пауза тестування, ШІ-оцінювання через Gemini.',
      downloadUrl: ''
    });
  }

  const manifestUrl = process.env.UPDATE_MANIFEST_URL || localManifest.updateManifestUrl || 'https://raw.githubusercontent.com/gaga050819/Test-for-everyone/main/version.json';
  const githubRepo = process.env.GITHUB_REPO || localManifest.githubRepo || 'gaga050819/Test-for-everyone';

  try {
    let remoteData = null;

    if (githubRepo) {
      try {
        const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/version.json?ref=main&_t=${Date.now()}`;
        const resp = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SecureExam-Updater',
            'Accept': 'application/vnd.github.v3.raw',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });
        if (resp.ok) {
          remoteData = await resp.json();
        }
      } catch {}
    }

    if (!remoteData && manifestUrl) {
      try {
        const fetchUrl = manifestUrl.includes('?') ? `${manifestUrl}&_t=${Date.now()}` : `${manifestUrl}?_t=${Date.now()}`;
        const resp = await fetch(fetchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SecureExam-Updater',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });
        if (resp.ok) {
          remoteData = await resp.json();
        }
      } catch {}
    }

    if (!remoteData && githubRepo) {
      try {
        const resp = await fetch(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SecureExam-Updater' }
        });
        if (resp.ok) {
          const gh = await resp.json();
          const zipAsset = (gh.assets || []).find(a => a.name.endsWith('.zip'));
          remoteData = {
            version: gh.tag_name ? gh.tag_name.replace(/^v/, '') : gh.name,
            changelog: gh.body || 'Нова версія системи SecureExam',
            downloadUrl: zipAsset ? zipAsset.browser_download_url : (gh.zipball_url || '')
          };
        }
      } catch {}
    }

    const localAnnouncement = readLocalAnnouncement();
    const effectiveAnnouncement = (remoteData && remoteData.announcement && remoteData.announcement.enabled)
      ? remoteData.announcement
      : (localAnnouncement && localAnnouncement.enabled ? localAnnouncement : null);

    const repo = githubRepo || 'gaga050819/Test-for-everyone';
    const fallbackDlUrl = repo ? `https://github.com/${repo}/archive/refs/heads/main.zip` : '';

    if (remoteData && remoteData.version) {
      const hasUpdate = isNewerVersion(remoteData.version, currentVersion);
      const dlUrl = remoteData.downloadUrl || fallbackDlUrl;
      return res.json({
        hasUpdate,
        currentVersion,
        latestVersion: remoteData.version,
        changelog: remoteData.changelog || 'Планове оновлення системи',
        downloadUrl: dlUrl,
        announcement: effectiveAnnouncement
      });
    }
  } catch {}

  const fallbackAnnouncement = readLocalAnnouncement();
  const fallbackRepo = githubRepo || 'gaga050819/Test-for-everyone';
  res.json({
    hasUpdate: false,
    currentVersion,
    latestVersion: currentVersion,
    changelog: '',
    downloadUrl: fallbackRepo ? `https://github.com/${fallbackRepo}/archive/refs/heads/main.zip` : '',
    announcement: fallbackAnnouncement && fallbackAnnouncement.enabled ? fallbackAnnouncement : null
  });
});

app.post('/api/admin/announcement', requireAdmin, async (req, res) => {
  const { announcement } = req.body;
  const vPath = path.join(__dirname, '..', 'version.json');
  let vObj = { version: '1.0.0', name: 'SecureExam' };
  try {
    if (fs.existsSync(vPath)) vObj = JSON.parse(fs.readFileSync(vPath, 'utf-8'));
    vObj.announcement = announcement;
    fs.writeFileSync(vPath, JSON.stringify(vObj, null, 2), 'utf-8');
    return res.json({ success: true, announcement: vObj.announcement });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});



let updateProgress = {
  active: false,
  percent: 0,
  stage: '',
  detail: '',
  error: null
};

app.get('/api/admin/update/progress', requireAdmin, (req, res) => {
  res.json(updateProgress);
});

app.post('/api/admin/update/apply', requireAdmin, async (req, res) => {
  const { targetVersion, downloadUrl, force } = req.body;
  const currentVersion = readLocalVersion();
  if (!force && targetVersion && !isNewerVersion(targetVersion, currentVersion)) {
    return res.status(400).json({ error: 'Поточна версія програми вже є найновішою. Оновлення не потрібне.' });
  }
  const rootDir = path.join(__dirname, '..');

  updateProgress = {
    active: true,
    percent: 5,
    stage: 'Створення резервної копії даних...',
    detail: 'Збереження data.json',
    error: null
  };

  try {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const dataFile = path.join(__dirname, 'data.json');
    if (fs.existsSync(dataFile)) {
      fs.copyFileSync(dataFile, path.join(backupDir, `data_backup_${Date.now()}.json`));
    }

    if (downloadUrl && downloadUrl.startsWith('http')) {
      const zipPath = path.join(rootDir, 'update_temp.zip');
      const tempExtractDir = path.join(rootDir, 'temp_update');

      updateProgress.percent = 15;
      updateProgress.stage = 'Підключення до GitHub...';
      updateProgress.detail = 'Очікування відповіді сервера';

      const response = await fetch(downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SecureExam-Updater'
        }
      });
      if (!response.ok) throw new Error('Помилка завантаження архіву оновлення (' + response.status + ')');

      updateProgress.percent = 45;
      updateProgress.stage = 'Завантаження архіву оновлення...';
      updateProgress.detail = 'Отримання файлів з інтернету';

      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(zipPath, Buffer.from(arrayBuffer));

      updateProgress.percent = 70;
      updateProgress.stage = 'Розпакування архіву оновлення...';
      updateProgress.detail = 'Вилучення оновлених файлів';

      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempExtractDir, { recursive: true });

      const { execSync } = await import('child_process');
      if (process.platform === 'win32') {
        const psCmd = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tempExtractDir.replace(/'/g, "''")}' -Force`;
        execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`, { stdio: 'pipe' });
      } else {
        execSync(`unzip -q -o "${zipPath}" -d "${tempExtractDir}"`, { stdio: 'pipe' });
      }

      let sourceFolder = tempExtractDir;
      const subItems = fs.readdirSync(tempExtractDir);
      if (subItems.length === 1 && fs.statSync(path.join(tempExtractDir, subItems[0])).isDirectory()) {
        sourceFolder = path.join(tempExtractDir, subItems[0]);
      }

      updateProgress.percent = 85;
      updateProgress.stage = 'Встановлення системних файлів...';
      updateProgress.detail = 'Копіювання компонентів';

      async function applyFiles(src, dest) {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
          const sPath = path.join(src, entry.name);
          const dPath = path.join(dest, entry.name);
          const rel = path.relative(rootDir, dPath).replace(/\\/g, '/').toLowerCase();

          if (rel === 'server/data.json' || rel === '.env' || rel.startsWith('.env') || rel === 'server/.env' || rel.startsWith('server/.env') || rel.startsWith('node_modules') || rel.startsWith('server/node_modules') || rel.startsWith('server/backups') || rel === 'server/admin_secret.json' || rel === 'update_temp.zip' || rel.startsWith('temp_update') || rel.startsWith('.runtime') || rel.startsWith('bin/runtime') || rel === 'bin/ngrok.exe' || rel === 'ngrok.exe') {
            continue;
          }

          if (entry.isDirectory()) {
            if (!fs.existsSync(dPath)) fs.mkdirSync(dPath, { recursive: true });
            await applyFiles(sPath, dPath);
          } else if (entry.name === 'start_win10.ps1') {
            const raw = fs.readFileSync(sPath);
            const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
            if (raw[0] !== 0xEF || raw[1] !== 0xBB || raw[2] !== 0xBF) {
              fs.writeFileSync(dPath, Buffer.concat([bom, raw]));
            } else {
              fs.writeFileSync(dPath, raw);
            }
          } else {
            fs.copyFileSync(sPath, dPath);
          }
        }
      }

      await applyFiles(sourceFolder, rootDir);

      try {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
        fs.rmSync(zipPath, { force: true });
      } catch {}
    }

    const vPath = path.join(rootDir, 'version.json');
    let vObj = { version: '1.2.3', name: 'SecureExam' };
    try {
      if (fs.existsSync(vPath)) vObj = JSON.parse(fs.readFileSync(vPath, 'utf-8'));
    } catch {}
    const newVer = targetVersion || vObj.version || '1.2.3';
    vObj.version = newVer;
    vObj.lastUpdated = Date.now();
    fs.writeFileSync(vPath, JSON.stringify(vObj, null, 2), 'utf-8');

    updateProgress.percent = 100;
    updateProgress.stage = 'Оновлення завершено! Перезапуск сервера...';
    updateProgress.detail = 'Перезавантаження сторінки';
    updateProgress.active = false;

    res.json({
      success: true,
      message: `Систему успішно оновлено до версії ${newVer}. Сервер перезавантажується...`,
      newVersion: newVer
    });

    setTimeout(async () => {
      try {
        if (process.platform === 'win32') {
          const cp = await import('child_process');
          const serverPath = path.join(__dirname, 'index.js');
          const nodeExe = process.execPath;
          const psCmd = `Start-Sleep -Seconds 2; Set-Location -LiteralPath '${rootDir.replace(/'/g, "''")}'; $active = Get-NetTCPConnection -LocalPort 3500 -State Listen -ErrorAction SilentlyContinue; if (-not $active) { Start-Process -FilePath '${nodeExe.replace(/'/g, "''")}' -ArgumentList '\"${serverPath.replace(/'/g, "''")}\"' -WorkingDirectory '${rootDir.replace(/'/g, "''")}' }`;
          cp.spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
            detached: true,
            stdio: 'ignore'
          }).unref();
        }
      } catch {}
      process.exit(100);
    }, 1000);

  } catch (err) {
    updateProgress.active = false;
    updateProgress.error = err.message;
    updateProgress.stage = 'Помилка оновлення';
    updateProgress.detail = err.message;
    res.status(500).json({ error: 'Помилка оновлення: ' + err.message });
  }
});

async function runAiGradingForSession(session, database) {
  if (!getGeminiApiKey()) return;
  const questions = session.questions || [];
  const answers = session.answers || {};

  let changed = false;
  let gradedCount = 0;

  for (const [qId, answerRecord] of Object.entries(answers)) {
    if (!answerRecord || !answerRecord.needsAiGrading) continue;
    if (gradedCount >= 25) break;
    const question = questions.find(q => q.id === qId);
    if (!question) continue;
    const userText = String(answerRecord.userAnswer || '').trim();
    if (!userText) {
      answerRecord.needsAiGrading = false;
      answerRecord.aiFeedback = 'Відповідь не надана';
      changed = true;
      continue;
    }

    gradedCount++;
    const prompt = `Ти — шкільний вчитель. Оціни відповідь учня.

Питання: ${String(question.text || '').slice(0, 1500)}
Відповідь учня: ${userText.slice(0, 1500)}
${question.correct ? `Еталонна відповідь (якщо є): ${String(question.correct).slice(0, 800)}` : ''}

Оціни відповідь від 0 до 1 (1 = повністю правильна, 0.5 = частково, 0 = неправильна).
Поверни ТІЛЬКИ JSON: {"score": 0.8, "feedback": "Коротке пояснення"}`;

    const aiRes = await callGeminiServer(prompt, { expectJson: true, temperature: 0.1, timeoutMs: 12000 });
    if (aiRes.ok) {
      const parsed = typeof aiRes.result === 'string' ? parseAiJsonResponse(aiRes.result) : aiRes.result;
      if (parsed && typeof parsed.score === 'number') {
        answerRecord.earnedPoints = Math.min(1, Math.max(0, parsed.score));
        answerRecord.isCorrect = answerRecord.earnedPoints >= 0.7;
        answerRecord.aiFeedback = String(parsed.feedback || '').slice(0, 500);
        answerRecord.needsAiGrading = false;
        changed = true;
      }
    }
  }

  if (changed) {
    let correctCount = 0;
    Object.values(answers).forEach(a => { correctCount += (a && a.earnedPoints ? a.earnedPoints : 0); });
    const totalQ = session.totalQuestions || 1;
    const scorePercentage = totalQ > 0 ? Math.round((correctCount / totalQ) * 100) : 0;
    const updated = await database.updateAiGradedSession(session.id, {
      answers,
      rawScore: correctCount,
      scorePercentage
    });
    const out = updated || session;
    broadcastToAdmins({
      type: 'session_ai_graded',
      sessionId: out.id,
      studentName: out.studentName,
      scorePercentage: out.scorePercentage,
      score12: out.score12
    });
  }
}

async function getTunnelUrl() {
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels');
    if (res.ok) {
      const data = await res.json();
      if (data.tunnels && data.tunnels.length > 0) {
        const httpsTunnel = data.tunnels.find(t => t.public_url.startsWith('https://')) || data.tunnels[0];
        return httpsTunnel.public_url;
      }
    }
  } catch {}
  return null;
}

function printStartupBanner({ port, httpsPort, hasHttps, localIp, tunnel, isPostgres, oneTimePassword, aiEnabled }) {
  const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
  const c = useColor
    ? {
        reset: '\x1b[0m',
        bold: '\x1b[1m',
        dim: '\x1b[90m',
        cyan: '\x1b[36m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        white: '\x1b[37m'
      }
    : { reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', white: '' };

  const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
  const sections = [
    [
      { label: 'Адмін (HTTP)', value: `http://localhost:${port}/admin.html`, tone: 'cyan' },
      hasHttps ? { label: 'Адмін (HTTPS)', value: `https://localhost:${httpsPort}/admin.html (SSL / камера)`, tone: 'cyan' } : null
    ],
    [
      { label: 'Wi-Fi (HTTP)', value: `http://${localIp}:${port}`, tone: 'white' },
      hasHttps ? { label: 'Wi-Fi (HTTPS)', value: `https://${localIp}:${httpsPort}`, tone: 'white' } : null,
      tunnel ? { label: 'Інтернет (Ngrok)', value: tunnel, tone: 'green' } : null
    ],
    [
      { label: 'База даних', value: isPostgres ? 'PostgreSQL (постійна)' : 'JSON (локальний файл)', tone: isPostgres ? 'green' : 'white' },
      oneTimePassword
        ? { label: 'Початковий пароль', value: oneTimePassword, tone: 'yellow' }
        : { label: 'Авторизація', value: 'Захищено (server/admin_secret.json)', tone: 'green' },
      { label: 'Gemini ШІ', value: aiEnabled ? 'Увімкнено' : 'Вимкнено', tone: aiEnabled ? 'green' : 'dim' }
    ]
  ].map(group => group.filter(Boolean)).filter(group => group.length > 0);

  const labelWidth = 19;
  const formattedRows = sections.map(group => group.map(item => {
    const paddedLabel = item.label.padEnd(labelWidth, ' ');
    const valColor = c[item.tone] || c.white;
    const rawLine = `  ${c.green}•${c.reset} ${c.dim}${paddedLabel}${c.reset} ${valColor}${item.value}${c.reset}`;
    return { rawLine, visibleLen: stripAnsi(rawLine).length };
  }));

  const titlePlain = 'SecureExam  •  Система безпечного тестування';
  const maxRowLen = formattedRows.flat().reduce((max, r) => Math.max(max, r.visibleLen), titlePlain.length + 4);
  const innerWidth = Math.max(66, maxRowLen + 2);

  const padBoxLine = (raw, visibleLen) => {
    const rightPad = Math.max(0, innerWidth - visibleLen);
    return `${c.cyan}│${c.reset}${raw}${' '.repeat(rightPad)}${c.cyan}│${c.reset}`;
  };

  const titleLeftPad = Math.floor((innerWidth - titlePlain.length) / 2);
  const titleRightPad = Math.max(0, innerWidth - titlePlain.length - titleLeftPad);
  const titleLine = `${c.cyan}│${c.reset}${' '.repeat(titleLeftPad)}${c.bold}${c.white}${titlePlain}${c.reset}${' '.repeat(titleRightPad)}${c.cyan}│${c.reset}`;

  const topBorder = `${c.cyan}┌${'─'.repeat(innerWidth)}┐${c.reset}`;
  const midBorder = `${c.cyan}├${'─'.repeat(innerWidth)}┤${c.reset}`;
  const subDivider = `${c.cyan}│${c.dim}${'─'.repeat(innerWidth)}${c.cyan}│${c.reset}`;
  const bottomBorder = `${c.cyan}└${'─'.repeat(innerWidth)}┘${c.reset}`;

  const lines = ['', topBorder, titleLine, midBorder];
  formattedRows.forEach((group, idx) => {
    if (idx > 0) lines.push(subDivider);
    group.forEach(row => lines.push(padBoxLine(row.rawLine, row.visibleLen)));
  });
  lines.push(bottomBorder, '');
  console.log(lines.join('\n'));
}

async function bootstrap() {
  await db.init();
  const sslData = ENABLE_LOCAL_HTTPS ? await getOrCreateSslCert() : null;
  if (sslData && sslData.cert && sslData.key) {
    try {
      httpsServer = https.createServer({ cert: sslData.cert, key: sslData.key }, app);
      httpsServer.on('upgrade', handleUpgrade);
      httpsServer.listen(HTTPS_PORT, () => {});
    } catch (err) {
      console.error('HTTPS setup error:', err);
    }
  }

  server.listen(PORT, '0.0.0.0', async () => {
    const localIp = getLocalNetworkIp();
    let tunnel = process.env.NODE_ENV === 'production' ? null : await getTunnelUrl();
    if (!tunnel && process.env.NODE_ENV !== 'production') {
      await new Promise(r => setTimeout(r, 2500));
      tunnel = await getTunnelUrl();
    }
    printStartupBanner({
      port: PORT,
      httpsPort: HTTPS_PORT,
      hasHttps: Boolean(httpsServer),
      localIp,
      tunnel,
      isPostgres: db.isPostgres(),
      oneTimePassword: generatedOneTimePassword,
      aiEnabled: Boolean(getGeminiApiKey())
    });
  });
}

bootstrap();

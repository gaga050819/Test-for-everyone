import './fetch-polyfill.js';
import express from 'express';
import http from 'http';
import https from 'https';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './database.js';

import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  try {
    const files = [path.join(__dirname, '..', '.env'), path.join(__dirname, '.env')];
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
              process.env[k] = v;
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
const AI_DISABLED_MESSAGE = 'Функції ШІ вимкнені у цій версії.';

const sslDir = path.join(__dirname, 'ssl');
const certPath = path.join(sslDir, 'cert.pem');
const keyPath = path.join(sslDir, 'key.pem');

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

const connectedClients = new Map();

wss.on('connection', (ws, req) => {
  let boundSessionId = null;

  ws.on('message', async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());

      if (message.type === 'register') {
        boundSessionId = message.sessionId;
        connectedClients.set(boundSessionId, {
          ws,
          role: message.role || 'student',
          lastSeen: Date.now()
        });

        broadcastToAdmins({
          type: 'student_status_change',
          sessionId: boundSessionId,
          status: 'online',
          timestamp: Date.now()
        });

        if (message.role === 'admin') {
          const onlineList = [];
          for (const [sId, c] of connectedClients.entries()) {
            if (c.role === 'student') {
              onlineList.push({
                sessionId: sId,
                lastSeen: c.lastSeen,
                latency: c.latency || 0,
                questionIndex: c.questionIndex || 1,
                totalQuestions: c.totalQuestions || 1
              });
            }
          }
          ws.send(JSON.stringify({
            type: 'online_students_snapshot',
            students: onlineList
          }));
          ws.send(JSON.stringify({
            type: 'exam_pause_changed',
            paused: globalExamPaused
          }));
        }

        if (boundSessionId) {
          const sess = await db.getSession(boundSessionId);
          if (sess && sess.proctorBypassed) {
            ws.send(JSON.stringify({
              type: 'admin_override_bypass',
              trustScore: sess.trustScore || 70
            }));
          }
        }
        if (globalExamPaused) {
          ws.send(JSON.stringify({ type: 'exam_paused', message: 'Екзамен тимчасово зупинений викладачем' }));
        }
        return;
      }

      if (message.type === 'student_progress') {
        if (boundSessionId) {
          const clientData = connectedClients.get(boundSessionId);
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
        }
        return;
      }

      if (message.type === 'ping') {
        const clientSent = message.clientTimestamp || Date.now();
        const serverNow = Date.now();
        const latency = message.latency || 0;

        if (boundSessionId) {
          const clientData = connectedClients.get(boundSessionId);
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
        }

        ws.send(JSON.stringify({
          type: 'pong',
          clientTimestamp: clientSent,
          serverTimestamp: serverNow
        }));
        return;
      }

      if (message.type === 'incident') {
        if (boundSessionId) {
          const recorded = await db.logIncident(boundSessionId, message.incident);
          broadcastToAdmins({
            type: 'new_incident',
            sessionId: boundSessionId,
            incident: recorded
          });
        }
        return;
      }

      if (message.type === 'teacher_warning') {
        const targetSessionId = message.sessionId;
        const targetClient = connectedClients.get(targetSessionId);
        if (targetClient && targetClient.ws && targetClient.ws.readyState === WebSocket.OPEN) {
          targetClient.ws.send(JSON.stringify({
            type: 'teacher_warning',
            message: message.message,
            level: message.level || 'warning',
            timestamp: Date.now()
          }));
        }
        await db.logIncident(targetSessionId, {
          category: 'teacher_warning',
          message: `Попередження від викладача: ${message.message}`,
          severity: message.level || 'warning'
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

  ws.on('close', async () => {
    if (boundSessionId) {
      connectedClients.delete(boundSessionId);
      broadcastToAdmins({
        type: 'student_status_change',
        sessionId: boundSessionId,
        status: 'disconnected',
        timestamp: Date.now()
      });
    }
  });
});

function broadcastToAdmins(payload) {
  const json = JSON.stringify(payload);
  for (const [, client] of connectedClients.entries()) {
    if (client.role === 'admin' && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(json);
    }
  }
}

const secretPath = path.join(__dirname, 'admin_secret.json');
const envPath = fs.existsSync(path.join(__dirname, '.env')) ? path.join(__dirname, '.env') : path.join(__dirname, '..', '.env');

function saveAdminPasswordToFile(pwd) {
  try {
    fs.writeFileSync(secretPath, JSON.stringify({ adminPassword: pwd, updatedAt: Date.now() }, null, 2), 'utf-8');
  } catch {}
  try {
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf-8');
      if (content.includes('ADMIN_PASSWORD=')) {
        content = content.replace(/ADMIN_PASSWORD=.*(\r?\n|$)/, `ADMIN_PASSWORD=${pwd}$1`);
      } else {
        content = content.trim() + `\r\nADMIN_PASSWORD=${pwd}\r\n`;
      }
      fs.writeFileSync(envPath, content, 'utf-8');
    }
  } catch {}
}

function getInitialAdminPassword() {
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim()) {
    saveAdminPasswordToFile(process.env.ADMIN_PASSWORD.trim());
    return process.env.ADMIN_PASSWORD.trim();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Set ADMIN_PASSWORD in the hosting provider environment before starting SecureExam.');
  }
  try {
    if (fs.existsSync(secretPath)) {
      const parsed = JSON.parse(fs.readFileSync(secretPath, 'utf-8'));
      if (parsed && parsed.adminPassword) {
        process.env.ADMIN_PASSWORD = parsed.adminPassword;
        return parsed.adminPassword;
      }
    }
  } catch {}
  const generated = Math.floor(10000000 + Math.random() * 90000000).toString();
  saveAdminPasswordToFile(generated);
  process.env.ADMIN_PASSWORD = generated;
  return generated;
}

let ADMIN_PASSWORD = getInitialAdminPassword();

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.headers['authorization'];
  if (token === ADMIN_PASSWORD || token === `Bearer ${ADMIN_PASSWORD}`) {
    return next();
  }
  return res.status(401).json({ error: 'Несанкціонований доступ' });
}

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password === 'string' && password.trim() === ADMIN_PASSWORD) {
    return res.json({ success: true, token: ADMIN_PASSWORD });
  }
  return res.status(401).json({ error: 'Невірний пароль' });
});

app.get('/api/admin/verify-token', requireAdmin, (req, res) => {
  res.json({ valid: true });
});

app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || currentPassword.trim() !== ADMIN_PASSWORD) {
    return res.status(400).json({ error: 'Поточний пароль введено невірно' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 4) {
    return res.status(400).json({ error: 'Новий пароль має містити щонайменше 4 символи' });
  }
  const cleanNew = newPassword.trim();
  ADMIN_PASSWORD = cleanNew;
  process.env.ADMIN_PASSWORD = cleanNew;
  saveAdminPasswordToFile(cleanNew);
  res.json({ success: true, message: 'Пароль успішно змінено', token: cleanNew });
});

app.post('/api/support/submit', supportLimiter, async (req, res) => {
  const { type, title, description, name, contact } = req.body || {};
  if (!type || !title || !description) return res.status(400).json({ error: 'Заповніть усі поля' });
  const ticket = {
    id: 'ticket_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
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

app.post('/api/dev/debug-mode', (req, res) => {
  const key = (req.body && req.body.key ? req.body.key : '').trim();
  if (key !== 'Honda2020!05081988') {
    return res.status(403).json({ error: 'Невірний ключ доступу' });
  }
  globalDebugBypass = !globalDebugBypass;
  if (globalDebugBypass) {
    connectedClients.forEach(client => {
      if (client.ws && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'admin_override_bypass', trustScore: 100 }));
      }
    });
  }
  res.json({ success: true, debugMode: globalDebugBypass });
});

app.get('/api/dev/debug-mode', (req, res) => {
  res.json({ debugMode: globalDebugBypass });
});

app.post('/api/admin/pause-exam', requireAdmin, (req, res) => {
  globalExamPaused = true;
  connectedClients.forEach((client) => {
    if (client.role === 'student' && client.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'exam_paused',
        message: req.body.message || 'Екзамен тимчасово зупинений викладачем'
      }));
    }
  });
  broadcastToAdmins({ type: 'exam_pause_changed', paused: true });
  res.json({ success: true, paused: true });
});

app.post('/api/admin/resume-exam', requireAdmin, (req, res) => {
  globalExamPaused = false;
  connectedClients.forEach((client) => {
    if (client.role === 'student' && client.ws && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: 'exam_resumed' }));
    }
  });
  broadcastToAdmins({ type: 'exam_pause_changed', paused: false });
  res.json({ success: true, paused: false });
});

app.get('/api/admin/pause-state', requireAdmin, (req, res) => {
  res.json({ paused: globalExamPaused });
});

app.post('/api/sessions/start', sessionStartLimiter, async (req, res) => {
  const { studentName, studentId, testId, clientInfo, resumeSessionId, avatar } = req.body;

  if (resumeSessionId) {
    const existing = await db.getSession(resumeSessionId);
    if (existing && existing.status === 'in_progress') {
      const sanitizedQuestions = (existing.questions || []).map(sanitizeQuestionForStudent);
      return res.json({
        id: existing.id,
        testId: existing.testId,
        studentName: existing.studentName,
        studentId: existing.studentId,
        avatar: existing.avatar || null,
        startedAt: existing.startedAt,
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

  const sessionId = 'ses_' + Math.random().toString(36).substring(2, 10);
  const session = await db.createSession({
    id: sessionId,
    testId,
    studentName,
    studentId: studentId || ('ID-' + Math.floor(100000 + Math.random() * 900000)),
    avatar: avatar || null,
    clientIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
    clientInfo: clientInfo || {},
    proctorBypassed: globalDebugBypass || !!req.body.proctorBypassed
  });

  const rawQuestions = session.questions || test.questions || [];
  const sanitizedQuestions = rawQuestions.map(sanitizeQuestionForStudent);

  res.json({
    id: session.id,
    testId: session.testId,
    studentName: session.studentName,
    studentId: session.studentId,
    avatar: session.avatar || null,
    startedAt: session.startedAt,
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
  const test = await db.getTest(session.testId);
  const rawQuestions = session.questions || (test ? test.questions : []) || [];
  const sanitizedQuestions = rawQuestions.map(sanitizeQuestionForStudent);
  res.json({
    id: session.id,
    testId: session.testId,
    studentName: session.studentName,
    studentId: session.studentId,
    startedAt: session.startedAt,
    durationMinutes: (test && test.durationMinutes) || 15,
    status: session.status,
    trustScore: session.trustScore,
    proctorBypassed: globalDebugBypass || !!session.proctorBypassed,
    partialAnswers: session.partialAnswers || {},
    questions: sanitizedQuestions
  });
});

app.post('/api/sessions/:id/answers', async (req, res) => {
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
  res.json({ status: 'ok', uptime: process.uptime() });
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

  const result = await db.submitTest(sessionId, { answers: answers || {}, questionTimings: questionTimings || {} });
  if (!result) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }

  broadcastToAdmins({
    type: 'session_completed',
    sessionId,
    result
  });

  const answerReviewAvailable = result.status === 'completed' && !!result.answers;
  const wrongAnswers = Object.fromEntries(
    Object.entries(result.answers || {}).filter(([, answer]) => answer && !answer.isCorrect)
  );

  res.json({
    id: result.id,
    studentName: result.studentName,
    studentId: result.studentId,
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
  res.json(sessions);
});

app.get('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  const session = await db.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }

  const incidents = await db.getSessionIncidents(req.params.id);
  const pings = await db.getSessionPings(req.params.id);

  res.json({
    session,
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
  if (req.body.questions !== undefined && Array.isArray(req.body.questions)) test.questions = req.body.questions;
  if (req.body.shuffleQuestions !== undefined) test.shuffleQuestions = !!req.body.shuffleQuestions;
  if (req.body.shuffleOptions !== undefined) test.shuffleOptions = !!req.body.shuffleOptions;
  await db.saveTest(test);
  res.json(test);
});

app.post('/api/admin/tests/:id/questions', requireAdmin, async (req, res) => {
  const { text, options, correct, timeLimitSeconds, type, matchingPairs, orderingItems, blanks, hotspotTarget, imageUrl, images, correctKeywords, useAiGrading } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Питання повинно містити текст' });
  }

  const qType = type || 'single';
  let processedCorrect = 0;

  if (qType === 'multiple') {
    processedCorrect = Array.isArray(correct) ? correct.map(Number).filter(n => !isNaN(n)) : [0];
  } else if (qType === 'matching') {
    processedCorrect = typeof correct === 'object' && correct !== null ? correct : {};
  } else if (qType === 'ordering') {
    processedCorrect = Array.isArray(orderingItems) ? orderingItems : (Array.isArray(options) ? options : []);
  } else if (qType === 'short_answer') {
    processedCorrect = typeof correct === 'string' ? correct.trim() : String(correct || '');
  } else if (qType === 'true_false') {
    processedCorrect = Number(correct) === 1 ? 1 : 0;
  } else {
    processedCorrect = parseInt(correct, 10);
    if (isNaN(processedCorrect) || processedCorrect < 0) processedCorrect = 0;
  }

  const finalImages = Array.isArray(images) ? images : (imageUrl ? [imageUrl] : []);
  const newQ = await db.addQuestion(req.params.id, {
    text: text.trim(),
    images: finalImages,
    imageUrl: finalImages[0] || (imageUrl || ''),
    options: Array.isArray(options) ? options : [],
    matchingPairs: Array.isArray(matchingPairs) ? matchingPairs : [],
    orderingItems: Array.isArray(orderingItems) ? orderingItems : [],
    blanks: Array.isArray(blanks) ? blanks : [],
    hotspotTarget: hotspotTarget || null,
    correct: processedCorrect,
    correctKeywords: Array.isArray(correctKeywords) ? correctKeywords : (typeof processedCorrect === 'string' ? processedCorrect.split(',').map(s => s.trim()).filter(Boolean) : []),
    timeLimitSeconds: parseInt(timeLimitSeconds, 10) || 60,
    type: qType,
    useAiGrading: qType === 'short_answer' ? (useAiGrading || false) : false
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

    const qType = q.type || 'single';
    let processedCorrect = 0;

    if (qType === 'multiple') {
      processedCorrect = Array.isArray(q.correct) ? q.correct.map(Number).filter(n => !isNaN(n)) : [0];
    } else if (qType === 'matching') {
      processedCorrect = typeof q.correct === 'object' && q.correct !== null ? q.correct : {};
    } else if (qType === 'ordering') {
      processedCorrect = Array.isArray(q.orderingItems) ? q.orderingItems : (Array.isArray(q.options) ? q.options : []);
    } else if (qType === 'short_answer') {
      processedCorrect = typeof q.correct === 'string' ? q.correct.trim() : String(q.correct || '');
    } else if (qType === 'true_false') {
      processedCorrect = Number(q.correct) === 1 ? 1 : 0;
    } else {
      processedCorrect = parseInt(q.correct, 10);
      if (isNaN(processedCorrect) || processedCorrect < 0) processedCorrect = 0;
    }

    const qImages = Array.isArray(q.images) ? q.images : (q.imageUrl ? [q.imageUrl] : []);
    const newQuestion = {
      id: 'q_' + Math.random().toString(36).substring(2, 9),
      text: q.text.trim(),
      type: qType,
      images: qImages,
      imageUrl: qImages[0] || (q.imageUrl || ''),
      options: Array.isArray(q.options) ? q.options : [],
      matchingPairs: Array.isArray(q.matchingPairs) ? q.matchingPairs : [],
      orderingItems: Array.isArray(q.orderingItems) ? q.orderingItems : [],
      blanks: Array.isArray(q.blanks) ? q.blanks : [],
      hotspotTarget: q.hotspotTarget || null,
      correct: processedCorrect,
      correctKeywords: Array.isArray(q.correctKeywords) ? q.correctKeywords : (typeof processedCorrect === 'string' ? processedCorrect.split(',').map(s => s.trim()).filter(Boolean) : []),
      timeLimitSeconds: parseInt(q.timeLimitSeconds, 10) || 60
    };
    test.questions.push(newQuestion);
    added.push(newQuestion);
  }

  await db.saveTest(test);
  res.json({ success: true, count: added.length, questions: added });
});

app.put('/api/admin/tests/:id/questions/:qId', requireAdmin, async (req, res) => {
  const { text, options, correct, timeLimitSeconds, type, matchingPairs, orderingItems, blanks, hotspotTarget, imageUrl, images, correctKeywords, useAiGrading } = req.body;
  const qType = type || 'single';
  let processedCorrect = 0;

  if (qType === 'multiple') {
    processedCorrect = Array.isArray(correct) ? correct.map(Number).filter(n => !isNaN(n)) : [0];
  } else if (qType === 'matching') {
    processedCorrect = typeof correct === 'object' && correct !== null ? correct : {};
  } else if (qType === 'ordering') {
    processedCorrect = Array.isArray(orderingItems) ? orderingItems : (Array.isArray(options) ? options : []);
  } else if (qType === 'short_answer') {
    processedCorrect = typeof correct === 'string' ? correct.trim() : String(correct || '');
  } else if (qType === 'true_false') {
    processedCorrect = Number(correct) === 1 ? 1 : 0;
  } else {
    processedCorrect = parseInt(correct, 10);
    if (isNaN(processedCorrect) || processedCorrect < 0) processedCorrect = 0;
  }

  const finalImages = images !== undefined ? (Array.isArray(images) ? images : (images ? [images] : [])) : undefined;
  const updated = await db.updateQuestion(req.params.id, req.params.qId, {
    text,
    images: finalImages,
    imageUrl: finalImages && finalImages.length > 0 ? finalImages[0] : imageUrl,
    options,
    matchingPairs,
    orderingItems,
    blanks: blanks !== undefined ? (Array.isArray(blanks) ? blanks : []) : undefined,
    hotspotTarget: hotspotTarget !== undefined ? hotspotTarget : undefined,
    correct: processedCorrect,
    correctKeywords: Array.isArray(correctKeywords) ? correctKeywords : (typeof processedCorrect === 'string' ? processedCorrect.split(',').map(s => s.trim()).filter(Boolean) : []),
    timeLimitSeconds,
    type: qType
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
    const cleanName = 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8) + '.' + ext;
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
  const targetClient = connectedClients.get(sessionId);
  let delivered = false;
  if (targetClient && targetClient.ws && targetClient.ws.readyState === WebSocket.OPEN) {
    targetClient.ws.send(JSON.stringify({
      type: 'teacher_warning',
      message: message.trim(),
      level: level || 'warning',
      timestamp: Date.now()
    }));
    delivered = true;
  }
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

app.post('/api/admin/ai-parse-import', requireAdmin, async (req, res) => {
  try {
    const { rawText } = req.body;
    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'Введіть текст тесту для розпізнавання' });
    }

    const fallbackQuestions = [];
    const blocks = rawText.split(/(?=(?:^|\n)\s*(?:\d+[\.\)]|Питання\s*\d+[\.:]?))/i).map(b => b.trim()).filter(Boolean);

    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      const qText = lines[0].replace(/^\d+[\.\)]\s*|^Питання\s*\d+[\.:]?\s*/i, '').trim();
      const optLines = lines.slice(1);
      const options = [];
      let correctIdx = 0;

      optLines.forEach((ol, idx) => {
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

    res.status(400).json({ error: 'Не вдалося розпізнати питання. Перевірте, що кожне питання має окремий рядок із варіантами відповіді.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

app.post('/api/admin/generate-test', requireAdmin, (req, res) => {
  res.status(410).json({ error: AI_DISABLED_MESSAGE });
});

app.post('/api/admin/gemini/prompt', requireAdmin, (req, res) => {
  res.status(410).json({ error: AI_DISABLED_MESSAGE });
});

app.post('/api/admin/sessions/:id/override-unlock', requireAdmin, async (req, res) => {
  const session = await db.adminOverrideUnlock(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  broadcastToAdmins({ type: 'session_unlocked', sessionId: req.params.id, trustScore: session.trustScore });
  const studentClient = connectedClients.get(req.params.id);
  if (studentClient && studentClient.ws.readyState === WebSocket.OPEN) {
    studentClient.ws.send(JSON.stringify({ type: 'admin_override_unlock', trustScore: session.trustScore }));
  }
  res.json({ success: true, session });
});

app.post('/api/admin/sessions/:id/override-bypass', requireAdmin, async (req, res) => {
  const session = await db.adminOverrideBypass(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  const studentClient = connectedClients.get(req.params.id);
  if (studentClient && studentClient.ws.readyState === WebSocket.OPEN) {
    studentClient.ws.send(JSON.stringify({ type: 'admin_override_bypass', trustScore: session.trustScore }));
  }
  broadcastToAdmins({ type: 'session_bypassed', sessionId: req.params.id, trustScore: session.trustScore });
  res.json({ success: true, session });
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
  res.json({ success: true, session });
});

app.post('/api/admin/sessions/:id/add-time', requireAdmin, async (req, res) => {
  const { minutes } = req.body;
  const mins = parseInt(minutes, 10) || 5;
  const session = await db.addSessionTime(req.params.id, mins);
  if (!session) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  const studentClient = connectedClients.get(req.params.id);
  if (studentClient && studentClient.ws.readyState === WebSocket.OPEN) {
    studentClient.ws.send(JSON.stringify({ type: 'time_extended', minutes: mins }));
  }
  broadcastToAdmins({
    type: 'session_time_extended',
    sessionId: req.params.id,
    minutes: mins,
    durationMinutes: session.durationMinutes,
    extraTimeMinutes: session.extraTimeMinutes
  });
  res.json({ success: true, session, addedMinutes: mins });
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: readLocalVersion(), timestamp: Date.now() });
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
    detail: 'Збереження data.json та .env',
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
    const envFile = fs.existsSync(path.join(__dirname, '.env')) ? path.join(__dirname, '.env') : path.join(rootDir, '.env');
    if (fs.existsSync(envFile)) {
      fs.copyFileSync(envFile, path.join(backupDir, `env_backup_${Date.now()}.json`));
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
    console.log('\n==========================================================');
    console.log('       СИСТЕМА БЕЗПЕЧНОГО ТЕСТУВАННЯ ЗАПУЩЕНА');
    console.log('==========================================================');
    console.log(`[+] Адмін-панель (HTTP):    http://localhost:${PORT}/admin.html`);
    if (httpsServer) {
      console.log(`[+] Адмін-панель (HTTPS):   https://localhost:${HTTPS_PORT}/admin.html (Камера/SSL)`);
    }
    console.log('[+] Пароль викладача збережений у server/admin_secret.json; значення приховане.');
    console.log(`[+] Локальна мережа (Wi-Fi): http://${localIp}:${PORT}`);
    if (httpsServer) {
      console.log(`[+] Wi-Fi HTTPS:            https://${localIp}:${HTTPS_PORT}`);
    }
    if (tunnel) {
      console.log(`[+] Інтернет (Ngrok тунель): ${tunnel}`);
    }
    console.log('==========================================================\n');
  });
}

bootstrap();

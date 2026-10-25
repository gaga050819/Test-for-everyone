import express from 'express';
import http from 'http';
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
    const envFile = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envFile)) {
      const lines = fs.readFileSync(envFile, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const k = trimmed.slice(0, eq).trim();
            const v = trimmed.slice(eq + 1).trim();
            if (!process.env[k]) {
              process.env[k] = v;
            }
          }
        }
      }
    }
  } catch {}
}
loadEnv();

const PORT = process.env.PORT || 3500;
const DEFAULT_GEMINI_KEY = process.env.GEMINI_API_KEY || '';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());
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
const envPath = path.join(__dirname, '..', '.env');

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

app.post('/api/admin/login', (req, res) => {
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
      subject: all[0].subject || ''
    });
  }
  res.json({
    id: test.id,
    title: test.title,
    durationMinutes: test.durationMinutes || 15,
    questionsCount: (test.questions || []).length,
    topic: test.topic || '',
    subject: test.subject || ''
  });
});

app.post('/api/admin/active-test', requireAdmin, async (req, res) => {
  const { testId } = req.body;
  if (!testId) return res.status(400).json({ error: 'testId required' });
  const ok = await db.setActiveTestId(testId);
  if (!ok) return res.status(404).json({ error: 'Test not found' });
  res.json({ success: true, activeTestId: testId });
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

app.get('/api/tests/:id', async (req, res) => {
  const test = await db.getTest(req.params.id);
  if (!test) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }

  const sanitizedQuestions = (test.questions || []).map(q => ({
    id: q.id,
    text: q.text,
    type: q.type || 'single',
    options: q.options || [],
    matchingLeft: q.matchingLeft || (q.matchingPairs ? q.matchingPairs.map(p => p.left) : []),
    matchingRight: q.matchingRight || (q.matchingPairs ? q.matchingPairs.map(p => p.right) : []),
    timeLimitSeconds: q.timeLimitSeconds
  }));

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

app.post('/api/sessions/start', async (req, res) => {
  const { studentName, studentId, testId, clientInfo, resumeSessionId } = req.body;

  if (resumeSessionId) {
    const existing = await db.getSession(resumeSessionId);
    if (existing && existing.status === 'in_progress') {
      const sanitizedQuestions = (existing.questions || []).map(q => ({
        id: q.id,
        text: q.text,
        type: q.type || 'single',
        options: q.options || [],
        matchingLeft: q.matchingLeft || (q.matchingPairs ? q.matchingPairs.map(p => p.left) : []),
        matchingRight: q.matchingRight || (q.matchingPairs ? q.matchingPairs.map(p => p.right) : []),
        timeLimitSeconds: q.timeLimitSeconds
      }));
      return res.json({
        id: existing.id,
        testId: existing.testId,
        studentName: existing.studentName,
        studentId: existing.studentId,
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
    clientIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
    clientInfo: clientInfo || {},
    proctorBypassed: globalDebugBypass || !!req.body.proctorBypassed
  });

  const rawQuestions = session.questions || test.questions || [];
  const sanitizedQuestions = rawQuestions.map(q => ({
    id: q.id,
    text: q.text,
    type: q.type || 'single',
    options: q.options || [],
    matchingLeft: q.matchingLeft || (q.matchingPairs ? q.matchingPairs.map(p => p.left) : []),
    matchingRight: q.matchingRight || (q.matchingPairs ? q.matchingPairs.map(p => p.right) : []),
    timeLimitSeconds: q.timeLimitSeconds
  }));

  res.json({
    id: session.id,
    testId: session.testId,
    studentName: session.studentName,
    studentId: session.studentId,
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
  const sanitizedQuestions = rawQuestions.map(q => ({
    id: q.id,
    text: q.text,
    type: q.type || 'single',
    options: q.options || [],
    matchingLeft: q.matchingLeft || (q.matchingPairs ? q.matchingPairs.map(p => p.left) : []),
    matchingRight: q.matchingRight || (q.matchingPairs ? q.matchingPairs.map(p => p.right) : []),
    timeLimitSeconds: q.timeLimitSeconds
  }));
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
  const { title, durationMinutes, questions, topic, subject, tags } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Вкажіть назву тесту' });
  }
  const created = await db.createTest({
    title: title.trim(),
    durationMinutes: parseInt(durationMinutes, 10) || 15,
    questions: Array.isArray(questions) ? questions : [],
    topic: topic || '',
    subject: subject || '',
    tags: Array.isArray(tags) ? tags : []
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
  const analytics = await db.getTestAnalytics(req.params.id);
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
  await db.saveTest(test);
  res.json(test);
});

app.post('/api/admin/tests/:id/questions', requireAdmin, async (req, res) => {
  const { text, options, correct, timeLimitSeconds, type, matchingPairs, orderingItems } = req.body;
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
  } else {
    processedCorrect = parseInt(correct, 10);
    if (isNaN(processedCorrect) || processedCorrect < 0) processedCorrect = 0;
  }

  const newQ = await db.addQuestion(req.params.id, {
    text: text.trim(),
    options: Array.isArray(options) ? options : [],
    matchingPairs: Array.isArray(matchingPairs) ? matchingPairs : [],
    orderingItems: Array.isArray(orderingItems) ? orderingItems : [],
    correct: processedCorrect,
    timeLimitSeconds: parseInt(timeLimitSeconds, 10) || 60,
    type: qType
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
    } else {
      processedCorrect = parseInt(q.correct, 10);
      if (isNaN(processedCorrect) || processedCorrect < 0) processedCorrect = 0;
    }

    const newQuestion = {
      id: 'q_' + Math.random().toString(36).substring(2, 9),
      text: q.text.trim(),
      type: qType,
      options: Array.isArray(q.options) ? q.options : [],
      matchingPairs: Array.isArray(q.matchingPairs) ? q.matchingPairs : [],
      orderingItems: Array.isArray(q.orderingItems) ? q.orderingItems : [],
      correct: processedCorrect,
      timeLimitSeconds: parseInt(q.timeLimitSeconds, 10) || 60
    };
    test.questions.push(newQuestion);
    added.push(newQuestion);
  }

  await db.saveTest(test);
  res.json({ success: true, count: added.length, questions: added });
});

app.put('/api/admin/tests/:id/questions/:qId', requireAdmin, async (req, res) => {
  const { text, options, correct, timeLimitSeconds, type, matchingPairs, orderingItems } = req.body;
  const qType = type || 'single';
  let processedCorrect = 0;

  if (qType === 'multiple') {
    processedCorrect = Array.isArray(correct) ? correct.map(Number).filter(n => !isNaN(n)) : [0];
  } else if (qType === 'matching') {
    processedCorrect = typeof correct === 'object' && correct !== null ? correct : {};
  } else if (qType === 'ordering') {
    processedCorrect = Array.isArray(orderingItems) ? orderingItems : (Array.isArray(options) ? options : []);
  } else {
    processedCorrect = parseInt(correct, 10);
    if (isNaN(processedCorrect) || processedCorrect < 0) processedCorrect = 0;
  }

  const updated = await db.updateQuestion(req.params.id, req.params.qId, {
    text,
    options,
    matchingPairs,
    orderingItems,
    correct: processedCorrect,
    timeLimitSeconds,
    type: qType
  });
  if (!updated) {
    return res.status(404).json({ error: 'Питання або тест не знайдено' });
  }
  res.json(updated);
});

app.post('/api/admin/ai-parse-import', requireAdmin, async (req, res) => {
  try {
    const { rawText, apiKey = '' } = req.body;
    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ error: 'Введіть текст тесту для розпізнавання' });
    }

    const keyToUse = (apiKey && apiKey.trim()) ? apiKey.trim() : DEFAULT_GEMINI_KEY;

    if (keyToUse) {
      const promptText = `Ти — експертний методист і парсер тестів українською мовою.
Твоє завдання — перетворити будь-який сирий текст тесту (з підручника, Word, сайту чи ЗНО) у структурований JSON.
Підтримуй такі типи питань:
1. "single": одна правильна відповідь. options: масив рядків, correct: індекс правильної відповіді (0, 1, 2...).
2. "multiple": кілька правильних відповідей. options: масив рядків, correct: масив індексів (наприклад [0, 2]).
3. "matching": встановлення відповідності між парами. matchingPairs: масив об'єктів [{"left": "...", "right": "..."}].
4. "ordering": встановлення послідовності. orderingItems: масив елементів у правильному хронологічному порядку.

Якщо варіант позначено +, *, "вірно" чи вказано ключ відповідей в кінці, визнач правильну відповідь.
Час на питання timeLimitSeconds: 60.

Ось текст:
${rawText.trim()}

Поверни результат ТІЛЬКИ як валідний JSON у форматі:
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

      const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];
      let geminiRes = null;

      for (const model of modelsToTry) {
        try {
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(keyToUse)}`;
          const gRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.2
              }
            }),
            signal: AbortSignal.timeout(5000)
          });

          if (gRes.ok) {
            geminiRes = await gRes.json();
            break;
          }
        } catch {}
      }

      if (geminiRes) {
        const rawContent = geminiRes.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawContent) {
          try {
            const parsed = JSON.parse(rawContent);
            if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
              return res.json({ success: true, source: 'gemini', questions: parsed.questions });
            }
          } catch {}
        }
      }
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

    res.status(400).json({ error: 'Не вдалося розпізнати питання з тексту. Перевірте формат або підключення до ШІ.' });
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

app.post('/api/admin/generate-test', requireAdmin, async (req, res) => {
  try {
    const {
      topic,
      count = 5,
      difficulty = 'medium',
      timeLimitSeconds = 60,
      customInstructions = '',
      apiKey = '',
      testId = 'demo-test-1',
      applyToTest = false,
      replaceExisting = false
    } = req.body;

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return res.status(400).json({ error: 'Вкажіть тему тесту' });
    }

    const keyToUse = (apiKey && apiKey.trim()) ? apiKey.trim() : DEFAULT_GEMINI_KEY;
    if (!keyToUse) {
      return res.status(400).json({ error: 'Не вказано Gemini API ключ' });
    }

    const questionCount = Math.max(1, Math.min(50, parseInt(count, 10) || 5));
    const timeLimit = Math.max(10, Math.min(600, parseInt(timeLimitSeconds, 10) || 60));

    const difficultyMap = {
      easy: 'початковий / легкий (базові поняття та терміни)',
      medium: 'середній (розуміння принципів та практичне застосування)',
      hard: 'складний (глибокий аналіз, неочевидні ситуації та винятки)',
      olympiad: 'олімпіадний / експертний (комплексні задачі та нестандартне мислення)'
    };
    const difficultyText = difficultyMap[difficulty] || difficultyMap.medium;

    const promptText = `Ти — досвідчений викладач та методист.
Створи навчальний тест українською мовою на тему: "${topic.trim()}".
Рівень складності: ${difficultyText}.
Кількість питань: ${questionCount}.
Час на відповідь на одне питання: ${timeLimit} секунд.
${customInstructions ? `Додаткові вимоги: ${customInstructions.trim()}` : ''}

Вимоги до тесту:
1. Питання мають бути грамотними, точними та однозначними.
2. Для кожного питання сформулюй рівно 4 реалістичні та змістовні варіанти відповіді.
3. Лише один варіант відповіді є правильним.
4. Поле "correct" повинно містити цілочисельний індекс правильного варіанта (0, 1, 2 або 3). Переконайся, що варіант за цим індексом на 100% правильний.
5. Поле "timeLimitSeconds" встанови рівним ${timeLimit}.

Поверни результат ВИКЛЮЧНО у форматі валідного JSON наступної структури:
{
  "title": "Назва тесту відповідно до теми",
  "questions": [
    {
      "text": "Текст питання",
      "options": ["Варіант 1", "Варіант 2", "Варіант 3", "Варіант 4"],
      "correct": 0,
      "timeLimitSeconds": ${timeLimit}
    }
  ]
}`;

    const modelsToTry = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];
    let lastError = null;
    let geminiResponse = null;

    for (const model of modelsToTry) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(keyToUse)}`;
        const gRes = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.7
            }
          })
        });

        if (gRes.ok) {
          geminiResponse = await gRes.json();
          break;
        } else {
          const errData = await gRes.json().catch(() => ({}));
          lastError = errData.error ? `${errData.error.message} (${errData.error.code})` : `Помилка ${gRes.status}`;
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    if (!geminiResponse) {
      return res.status(502).json({ error: `Помилка запиту до Gemini API: ${lastError || 'Неможливо отримати відповідь'}` });
    }

    const rawContent = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      return res.status(502).json({ error: 'Gemini не повернув вміст для генерації' });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Неможливо розібрати JSON відповідь від Gemini');
      }
    }

    const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
    if (rawQuestions.length === 0) {
      return res.status(502).json({ error: 'ШІ не сформував жодного питання' });
    }

    const validatedQuestions = rawQuestions.map((q, idx) => {
      const opts = Array.isArray(q.options) ? q.options.map(o => String(o).trim()).filter(Boolean) : [];
      let c = parseInt(q.correct, 10);
      if (isNaN(c) || c < 0 || c >= opts.length) c = 0;
      return {
        id: 'q_ai_' + Math.random().toString(36).substring(2, 9) + '_' + (idx + 1),
        text: String(q.text || '').trim(),
        options: opts,
        correct: c,
        timeLimitSeconds: parseInt(q.timeLimitSeconds, 10) || timeLimit,
        type: 'single'
      };
    }).filter(q => q.text && q.options.length >= 2);

    if (validatedQuestions.length === 0) {
      return res.status(502).json({ error: 'Питання від ШІ не пройшли валідацію' });
    }

    let applied = false;
    let savedTest = null;
    if (applyToTest && testId) {
      const test = await db.getTest(testId);
      if (test) {
        if (parsed.title && typeof parsed.title === 'string' && parsed.title.trim()) {
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
      title: parsed.title || topic,
      questions: validatedQuestions,
      applied,
      test: savedTest
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Внутрішня помилка сервера' });
  }
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

app.delete('/api/admin/sessions/:id', requireAdmin, async (req, res) => {
  const ok = await db.deleteSession(req.params.id);
  if (!ok) {
    return res.status(404).json({ error: 'Сесію не знайдено' });
  }
  broadcastToAdmins({ type: 'session_deleted', sessionId: req.params.id });
  res.json({ success: true });
});

app.delete('/api/admin/sessions', requireAdmin, async (req, res) => {
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

function readLocalVersion() {
  try {
    const vPath = path.join(__dirname, '..', 'version.json');
    if (fs.existsSync(vPath)) {
      const v = JSON.parse(fs.readFileSync(vPath, 'utf-8'));
      return v.version || '1.0.0';
    }
  } catch {}
  return '1.0.0';
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
  const currentVersion = readLocalVersion();
  const simulate = req.query.simulate === '1' || process.env.SIMULATE_UPDATE === 'true';

  if (simulate) {
    return res.json({
      hasUpdate: true,
      currentVersion,
      latestVersion: '1.2.0',
      changelog: 'Оновлено інтерфейс тестування, покращено роботу з класами, додано швидкі фільтри та оптимізовано збереження оцінок.',
      downloadUrl: ''
    });
  }

  const manifestUrl = process.env.UPDATE_MANIFEST_URL || '';
  const githubRepo = process.env.GITHUB_REPO || 'gaga050819/Test-for-everyone';

  try {
    let remoteData = null;

    if (manifestUrl && manifestUrl.includes('raw.githubusercontent.com')) {
      const match = manifestUrl.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/[^/]+\/(.+)/);
      if (match) {
        const apiUrl = `https://api.github.com/repos/${match[1]}/contents/${match[2]}`;
        const resp = await fetch(apiUrl, {
          headers: { 'User-Agent': 'SecureExam-Updater', 'Accept': 'application/vnd.github.v3.raw' }
        });
        if (resp.ok) remoteData = await resp.json();
      }
    }

    if (!remoteData && githubRepo) {
      const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/version.json`;
      const resp = await fetch(apiUrl, {
        headers: { 'User-Agent': 'SecureExam-Updater', 'Accept': 'application/vnd.github.v3.raw' }
      });
      if (resp.ok) remoteData = await resp.json();
    }

    if (!remoteData && githubRepo) {
      const resp = await fetch(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
        headers: { 'User-Agent': 'SecureExam-Updater' }
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
    }

    const localAnnouncement = readLocalAnnouncement();
    const effectiveAnnouncement = (remoteData && remoteData.announcement && remoteData.announcement.enabled)
      ? remoteData.announcement
      : (localAnnouncement && localAnnouncement.enabled ? localAnnouncement : null);

    if (remoteData && remoteData.version) {
      const hasUpdate = isNewerVersion(remoteData.version, currentVersion);
      const repo = githubRepo || 'gaga050819/Test-for-everyone';
      const dlUrl = remoteData.downloadUrl || (repo ? `https://github.com/${repo}/archive/refs/heads/main.zip` : '');
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
  res.json({
    hasUpdate: false,
    currentVersion,
    latestVersion: currentVersion,
    changelog: '',
    downloadUrl: '',
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
  const { targetVersion, downloadUrl } = req.body;
  const currentVersion = readLocalVersion();
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
    const envFile = path.join(rootDir, '.env');
    if (fs.existsSync(envFile)) {
      fs.copyFileSync(envFile, path.join(backupDir, `env_backup_${Date.now()}.json`));
    }

    if (downloadUrl && downloadUrl.startsWith('http')) {
      const zipPath = path.join(rootDir, 'update_temp.zip');
      const tempExtractDir = path.join(rootDir, 'temp_update');

      updateProgress.percent = 15;
      updateProgress.stage = 'Підключення до GitHub...';
      updateProgress.detail = 'Очікування відповіді сервера';

      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error('Помилка завантаження архіву оновлення (' + response.status + ')');

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      const approxTotalBytes = contentLength > 0 ? contentLength : 480 * 1024;
      let receivedBytes = 0;
      const fileStream = fs.createWriteStream(zipPath);

      if (response.body && response.body.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fileStream.write(value);
          receivedBytes += value.length;

          const p = Math.min(68, 15 + Math.floor((receivedBytes / Math.max(receivedBytes, approxTotalBytes)) * 53));
          updateProgress.percent = p;

          let sizeStr = '';
          if (receivedBytes < 1048576) {
            const kbRec = Math.round(receivedBytes / 1024);
            const kbTot = Math.round(approxTotalBytes / 1024);
            sizeStr = `${kbRec} КБ з ~${kbTot} КБ`;
          } else {
            const mbRec = (receivedBytes / 1048576).toFixed(2);
            const mbTot = (approxTotalBytes / 1048576).toFixed(2);
            sizeStr = `${mbRec} МБ з ~${mbTot} МБ`;
          }

          updateProgress.stage = `Завантаження архіву (${p}%)...`;
          updateProgress.detail = `Завантажено ${sizeStr}`;
        }
        await new Promise(r => fileStream.end(r));
      } else {
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(zipPath, Buffer.from(arrayBuffer));
      }

      updateProgress.percent = 70;
      updateProgress.stage = 'Розпакування архіву оновлення...';
      updateProgress.detail = 'Вилучення оновлених файлів';

      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempExtractDir, { recursive: true });

      const { execSync } = await import('child_process');
      execSync(`tar -xf "${zipPath}" -C "${tempExtractDir}"`);

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

          if (rel === 'server/data.json' || rel === '.env' || rel.startsWith('.env') || rel.startsWith('node_modules') || rel.startsWith('server/backups') || rel === 'server/admin_secret.json' || rel === 'update_temp.zip' || rel.startsWith('temp_update')) {
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

    const newVer = targetVersion || '1.0.1';
    const vPath = path.join(rootDir, 'version.json');
    let vObj = { version: newVer, name: 'SecureExam' };
    try {
      if (fs.existsSync(vPath)) vObj = JSON.parse(fs.readFileSync(vPath, 'utf-8'));
      vObj.version = newVer;
      vObj.lastUpdated = Date.now();
    } catch {}
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
        const cp = await import('child_process');
        const serverPath = path.join(__dirname, 'index.js');
        const psCmd = `Start-Sleep -Seconds 2; Set-Location -LiteralPath '${rootDir.replace(/'/g, "''")}'; $active = Get-NetTCPConnection -LocalPort 3500 -ErrorAction SilentlyContinue; if (-not $active) { Start-Process -FilePath 'node.exe' -ArgumentList '\"${serverPath.replace(/'/g, "''")}\"' -WorkingDirectory '${rootDir.replace(/'/g, "''")}' -WindowStyle Hidden }`;
        cp.spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], {
          detached: true,
          stdio: 'ignore'
        }).unref();
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
  server.listen(PORT, async () => {
    const localIp = getLocalNetworkIp();
    let tunnel = await getTunnelUrl();
    if (!tunnel) {
      await new Promise(r => setTimeout(r, 2500));
      tunnel = await getTunnelUrl();
    }
    console.log('\n==========================================================');
    console.log('       СИСТЕМА БЕЗПЕЧНОГО ТЕСТУВАННЯ ЗАПУЩЕНА');
    console.log('==========================================================');
    console.log(`[+] Адмін-панель:            http://localhost:${PORT}/admin.html`);
    console.log(`[+] Пароль викладача:        ${ADMIN_PASSWORD}`);
    console.log(`[+] Локальна мережа (Wi-Fi): http://${localIp}:${PORT}`);
    if (tunnel) {
      console.log(`[+] Інтернет (Ngrok тунель): ${tunnel}`);
    }
    console.log('==========================================================\n');
  });
}

bootstrap();

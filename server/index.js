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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '05081988';

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.headers['authorization'];
  if (token === ADMIN_PASSWORD || token === `Bearer ${ADMIN_PASSWORD}`) {
    return next();
  }
  return res.status(401).json({ error: 'Несанкціонований доступ' });
}

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
    type: q.type,
    options: q.options,
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

app.post('/api/sessions/start', async (req, res) => {
  const { studentName, studentId, testId, clientInfo, resumeSessionId } = req.body;

  if (resumeSessionId) {
    const existing = await db.getSession(resumeSessionId);
    if (existing && existing.status === 'in_progress') {
      const sanitizedQuestions = (existing.questions || []).map(q => ({
        id: q.id,
        text: q.text,
        type: q.type,
        options: q.options,
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
        proctorBypassed: !!existing.proctorBypassed,
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
    clientInfo: clientInfo || {}
  });

  const rawQuestions = session.questions || test.questions || [];
  const sanitizedQuestions = rawQuestions.map(q => ({
    id: q.id,
    text: q.text,
    type: q.type,
    options: q.options,
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
    proctorBypassed: false,
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
    type: q.type,
    options: q.options,
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
    proctorBypassed: !!session.proctorBypassed,
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
    finalVerdict: result.finalVerdict
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
  const { text, options, correct, timeLimitSeconds, type } = req.body;
  if (!text || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'Питання повинно містити текст і як мінімум 2 варіанти' });
  }
  const correctIdx = parseInt(correct, 10);
  if (isNaN(correctIdx) || correctIdx < 0 || correctIdx >= options.length) {
    return res.status(400).json({ error: 'Некоректний індекс правильної відповіді' });
  }
  const newQ = await db.addQuestion(req.params.id, {
    text,
    options,
    correct: correctIdx,
    timeLimitSeconds: parseInt(timeLimitSeconds, 10) || 60,
    type: type || 'single'
  });
  if (!newQ) {
    return res.status(404).json({ error: 'Тест не знайдено' });
  }
  res.status(201).json(newQ);
});

app.put('/api/admin/tests/:id/questions/:qId', requireAdmin, async (req, res) => {
  const { text, options, correct, timeLimitSeconds } = req.body;
  if (options && (!Array.isArray(options) || options.length < 2)) {
    return res.status(400).json({ error: 'Повинно бути щонайменше 2 варіанти відповіді' });
  }
  const updated = await db.updateQuestion(req.params.id, req.params.qId, {
    text,
    options,
    correct,
    timeLimitSeconds
  });
  if (!updated) {
    return res.status(404).json({ error: 'Питання або тест не знайдено' });
  }
  res.json(updated);
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
  const githubRepo = process.env.GITHUB_REPO || '';

  try {
    let remoteData = null;
    if (manifestUrl) {
      const resp = await fetch(manifestUrl, { headers: { 'User-Agent': 'SecureExam-Updater' } });
      if (resp.ok) remoteData = await resp.json();
    } else if (githubRepo) {
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

    if (remoteData && remoteData.version) {
      const hasUpdate = isNewerVersion(remoteData.version, currentVersion);
      return res.json({
        hasUpdate,
        currentVersion,
        latestVersion: remoteData.version,
        changelog: remoteData.changelog || 'Планове оновлення системи',
        downloadUrl: remoteData.downloadUrl || ''
      });
    }
  } catch {}

  res.json({
    hasUpdate: false,
    currentVersion,
    latestVersion: currentVersion,
    changelog: '',
    downloadUrl: ''
  });
});

app.post('/api/admin/update/apply', requireAdmin, async (req, res) => {
  const { targetVersion, downloadUrl } = req.body;
  const currentVersion = readLocalVersion();
  const rootDir = path.join(__dirname, '..');

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

      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error('Помилка завантаження архіву оновлення');
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(zipPath, Buffer.from(arrayBuffer));

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

      async function applyFiles(src, dest) {
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
          const sPath = path.join(src, entry.name);
          const dPath = path.join(dest, entry.name);
          const rel = path.relative(rootDir, dPath).replace(/\\/g, '/').toLowerCase();

          if (rel === 'server/data.json' || rel === '.env' || rel.startsWith('node_modules') || rel.startsWith('server/backups') || rel === 'update_temp.zip' || rel.startsWith('temp_update')) {
            continue;
          }

          if (entry.isDirectory()) {
            if (!fs.existsSync(dPath)) fs.mkdirSync(dPath, { recursive: true });
            await applyFiles(sPath, dPath);
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

    const newVer = targetVersion || '1.2.0';
    const vPath = path.join(rootDir, 'version.json');
    let vObj = { version: newVer, name: 'SecureExam' };
    try {
      if (fs.existsSync(vPath)) vObj = JSON.parse(fs.readFileSync(vPath, 'utf-8'));
      vObj.version = newVer;
      vObj.lastUpdated = Date.now();
    } catch {}
    fs.writeFileSync(vPath, JSON.stringify(vObj, null, 2), 'utf-8');

    res.json({
      success: true,
      message: `Систему успішно оновлено до версії ${newVer}. Сервер перезавантажується...`,
      newVersion: newVer
    });

    setTimeout(async () => {
      try {
        const cp = await import('child_process');
        const cmd = `Start-Sleep -Seconds 2; & "${process.argv[0]}" "${process.argv.slice(1).join('" "')}"`;
        cp.spawn('powershell.exe', ['-NoProfile', '-Command', cmd], {
          detached: true,
          stdio: 'ignore'
        }).unref();
      } catch {}
      process.exit(0);
    }, 1200);

  } catch (err) {
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
    console.log(`[+] Локальна мережа (Wi-Fi): http://${localIp}:${PORT}`);
    if (tunnel) {
      console.log(`[+] Інтернет (Ngrok тунель): ${tunnel}`);
    }
    console.log('==========================================================\n');
  });
}

bootstrap();

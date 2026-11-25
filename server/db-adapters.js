import {
  DatabaseAdapter,
  generateSecureId,
  parseNumericInput,
  generateDefaultAvatar,
  buildDefaultDemoTest,
  normalizeQuestionData,
  buildSessionQuestions,
  computeFinalVerdict,
  evaluateTestSubmission,
  buildLeaderboardList,
  buildTestAnalytics
} from './database.js';

function mapTestRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    durationMinutes: row.duration_minutes || 15,
    topic: row.topic || '',
    subject: row.subject || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    shuffleQuestions: !!row.shuffle_questions,
    shuffleOptions: !!row.shuffle_options,
    questions: Array.isArray(row.questions) ? row.questions : []
  };
}

function mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    testId: row.test_id,
    studentName: row.student_name,
    studentId: row.student_id,
    clientIp: row.client_ip,
    status: row.status,
    trustScore: Number(row.trust_score),
    startedAt: Number(row.started_at),
    submittedAt: row.submitted_at ? Number(row.submitted_at) : null,
    scorePercentage: row.score_percentage !== null && row.score_percentage !== undefined ? Number(row.score_percentage) : undefined,
    rawScore: row.raw_score !== null && row.raw_score !== undefined ? Number(row.raw_score) : undefined,
    totalQuestions: row.total_questions !== null && row.total_questions !== undefined ? Number(row.total_questions) : undefined,
    answers: row.answers || {},
    finalVerdict: row.final_verdict || null,
    networkStats: row.network_stats || { totalPings: 0, averageLatency: 0, packetLossCount: 0, disconnectsCount: 0 },
    studentToken: row.student_token || null,
    avatar: row.avatar || generateDefaultAvatar(row.student_name),
    clientInfo: row.client_info || {},
    proctorBypassed: !!row.proctor_bypassed,
    partialAnswers: row.partial_answers || {},
    questions: Array.isArray(row.questions) ? row.questions : [],
    questionTimings: row.question_timings || {},
    incidentsCount: Number(row.incidents_count || 0),
    score12: row.score12 !== null && row.score12 !== undefined ? Number(row.score12) : undefined,
    score12ManualOverride: !!row.score12_manual_override,
    durationMinutes: row.duration_minutes !== null && row.duration_minutes !== undefined ? Number(row.duration_minutes) : undefined,
    extraTimeMinutes: Number(row.extra_time_minutes || 0),
    isPaused: !!row.is_paused,
    pauseMessage: row.pause_message || '',
    pausedAt: row.paused_at ? Number(row.paused_at) : null,
    totalPausedMs: Number(row.total_paused_ms || 0),
    retakeAllowed: !!row.retake_allowed,
    retakeUsed: !!row.retake_used,
    retakeGrantedAt: row.retake_granted_at ? Number(row.retake_granted_at) : null,
    attemptNumber: Number(row.attempt_number || 1),
    previousSessionId: row.previous_session_id || null
  };
}

function mapClassRow(row) {
  if (!row) return null;
  const assignedTests = Array.isArray(row.assigned_tests) ? row.assigned_tests : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    grade: row.grade || '10',
    subject: row.subject || 'Географія',
    createdAt: Number(row.created_at || Date.now()),
    students: Array.isArray(row.students) ? row.students : [],
    assignedTests,
    testIds: assignedTests
  };
}

export class PostgresDatabaseAdapter extends DatabaseAdapter {
  constructor(pgPool) {
    super();
    this.pool = pgPool;
  }

  isPostgres() {
    return true;
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tests (
        id VARCHAR(64) PRIMARY KEY,
        title TEXT NOT NULL,
        duration_minutes INT NOT NULL DEFAULT 15,
        topic TEXT DEFAULT '',
        subject TEXT DEFAULT '',
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE,
        shuffle_options BOOLEAN NOT NULL DEFAULT FALSE,
        questions JSONB NOT NULL DEFAULT '[]'::jsonb
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(64) PRIMARY KEY,
        test_id VARCHAR(64),
        student_name TEXT NOT NULL,
        student_id TEXT NOT NULL,
        client_ip TEXT,
        status VARCHAR(32) NOT NULL,
        trust_score INT NOT NULL,
        started_at BIGINT NOT NULL,
        submitted_at BIGINT,
        score_percentage INT,
        raw_score DOUBLE PRECISION,
        total_questions INT,
        answers JSONB,
        final_verdict JSONB,
        network_stats JSONB,
        student_token TEXT,
        avatar JSONB,
        client_info JSONB,
        proctor_bypassed BOOLEAN DEFAULT FALSE,
        partial_answers JSONB DEFAULT '{}'::jsonb,
        questions JSONB DEFAULT '[]'::jsonb,
        question_timings JSONB DEFAULT '{}'::jsonb,
        incidents_count INT DEFAULT 0,
        score12 INT,
        score12_manual_override BOOLEAN DEFAULT FALSE,
        duration_minutes INT,
        extra_time_minutes INT DEFAULT 0,
        is_paused BOOLEAN DEFAULT FALSE,
        pause_message TEXT DEFAULT '',
        paused_at BIGINT,
        total_paused_ms BIGINT DEFAULT 0,
        retake_allowed BOOLEAN DEFAULT FALSE,
        retake_used BOOLEAN DEFAULT FALSE,
        retake_granted_at BIGINT,
        attempt_number INT DEFAULT 1,
        previous_session_id VARCHAR(64)
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(64),
        timestamp BIGINT NOT NULL,
        category VARCHAR(64),
        type VARCHAR(64),
        message TEXT,
        severity VARCHAR(32),
        penalty INT DEFAULT 0,
        network_state JSONB,
        raw_data JSONB
      );

      CREATE TABLE IF NOT EXISTS pings (
        id BIGSERIAL PRIMARY KEY,
        session_id VARCHAR(64),
        timestamp BIGINT NOT NULL,
        latency INT NOT NULL,
        status VARCHAR(32) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS classes (
        id VARCHAR(64) PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        grade TEXT DEFAULT '10',
        subject TEXT DEFAULT 'Географія',
        created_at BIGINT NOT NULL,
        students JSONB NOT NULL DEFAULT '[]'::jsonb,
        assigned_tests JSONB NOT NULL DEFAULT '[]'::jsonb
      );

      CREATE TABLE IF NOT EXISTS support_tickets (
        id VARCHAR(64) PRIMARY KEY,
        type TEXT,
        title TEXT,
        description TEXT,
        name TEXT,
        contact TEXT,
        created_at TEXT,
        status VARCHAR(32) DEFAULT 'new'
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(64) PRIMARY KEY,
        value JSONB NOT NULL
      );

      ALTER TABLE tests ADD COLUMN IF NOT EXISTS topic TEXT DEFAULT '';
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT '';
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE tests ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS student_token TEXT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS avatar JSONB;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_info JSONB;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS proctor_bypassed BOOLEAN DEFAULT FALSE;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS partial_answers JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS questions JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS question_timings JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS incidents_count INT DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS score12 INT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS score12_manual_override BOOLEAN DEFAULT FALSE;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS duration_minutes INT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS extra_time_minutes INT DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT FALSE;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pause_message TEXT DEFAULT '';
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS paused_at BIGINT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_paused_ms BIGINT DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retake_allowed BOOLEAN DEFAULT FALSE;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retake_used BOOLEAN DEFAULT FALSE;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retake_granted_at BIGINT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attempt_number INT DEFAULT 1;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS previous_session_id VARCHAR(64);
      ALTER TABLE sessions ALTER COLUMN raw_score TYPE DOUBLE PRECISION;

      CREATE INDEX IF NOT EXISTS idx_incidents_session ON incidents(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_pings_session ON pings(session_id, id);
      CREATE INDEX IF NOT EXISTS idx_sessions_test ON sessions(test_id, started_at);
    `);

    const countRes = await this.pool.query('SELECT COUNT(*)::int AS cnt FROM tests');
    if ((countRes.rows[0]?.cnt || 0) === 0) {
      await this.saveTest(buildDefaultDemoTest());
    }
  }

  async getTest(testId) {
    const res = await this.pool.query('SELECT * FROM tests WHERE id = $1', [testId]);
    return mapTestRow(res.rows[0]);
  }

  async getAllTests() {
    const res = await this.pool.query('SELECT * FROM tests');
    return res.rows.map(mapTestRow);
  }

  async getActiveTestId() {
    const res = await this.pool.query("SELECT value FROM app_settings WHERE key = 'activeTestId'");
    const activeId = res.rows[0]?.value?.id;
    if (activeId) {
      const exists = await this.getTest(activeId);
      if (exists) return activeId;
    }
    const firstRes = await this.pool.query('SELECT id FROM tests LIMIT 1');
    return firstRes.rows[0]?.id || 'demo-test-1';
  }

  async setActiveTestId(testId) {
    const test = await this.getTest(testId);
    if (!test) return false;
    await this.pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('activeTestId', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ id: testId })]
    );
    return true;
  }

  async getLiteMode() {
    const res = await this.pool.query("SELECT value FROM app_settings WHERE key = 'liteMode'");
    return !!res.rows[0]?.value?.enabled;
  }

  async setLiteMode(val) {
    await this.pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('liteMode', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ enabled: !!val })]
    );
  }

  async createTest(testData) {
    const id = testData.id || generateSecureId('test_', 6);
    const newTest = {
      id,
      title: testData.title || 'Новий тест',
      durationMinutes: parseInt(testData.durationMinutes, 10) || 15,
      topic: testData.topic || '',
      subject: testData.subject || '',
      tags: Array.isArray(testData.tags) ? testData.tags : [],
      shuffleQuestions: !!testData.shuffleQuestions,
      shuffleOptions: !!testData.shuffleOptions,
      questions: Array.isArray(testData.questions) ? testData.questions : []
    };
    return this.saveTest(newTest);
  }

  async deleteTest(testId) {
    const res = await this.pool.query('DELETE FROM tests WHERE id = $1', [testId]);
    return res.rowCount > 0;
  }

  async saveTest(test) {
    await this.pool.query(
      `INSERT INTO tests (id, title, duration_minutes, topic, subject, tags, shuffle_questions, shuffle_options, questions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         duration_minutes = EXCLUDED.duration_minutes,
         topic = EXCLUDED.topic,
         subject = EXCLUDED.subject,
         tags = EXCLUDED.tags,
         shuffle_questions = EXCLUDED.shuffle_questions,
         shuffle_options = EXCLUDED.shuffle_options,
         questions = EXCLUDED.questions`,
      [
        test.id,
        test.title,
        parseInt(test.durationMinutes, 10) || 15,
        test.topic || '',
        test.subject || '',
        JSON.stringify(Array.isArray(test.tags) ? test.tags : []),
        !!test.shuffleQuestions,
        !!test.shuffleOptions,
        JSON.stringify(Array.isArray(test.questions) ? test.questions : [])
      ]
    );
    return this.getTest(test.id);
  }

  async addQuestion(testId, questionData) {
    const test = await this.getTest(testId);
    if (!test) return null;
    if (!test.questions) test.questions = [];
    const newQuestion = normalizeQuestionData(questionData);
    test.questions.push(newQuestion);
    await this.saveTest(test);
    return newQuestion;
  }

  async updateQuestion(testId, questionId, questionData) {
    const test = await this.getTest(testId);
    if (!test || !test.questions) return null;
    const idx = test.questions.findIndex(q => q.id === questionId);
    if (idx === -1) return null;
    const current = test.questions[idx];
    const currentImages = current.images || (current.imageUrl ? [current.imageUrl] : []);
    const newImages = questionData.images !== undefined
      ? (Array.isArray(questionData.images) ? questionData.images : (questionData.images ? [questionData.images] : []))
      : currentImages;
    const type = questionData.type !== undefined ? questionData.type : (current.type || 'single');
    const updated = {
      ...current,
      text: questionData.text !== undefined ? questionData.text : current.text,
      type,
      images: newImages,
      imageUrl: questionData.imageUrl !== undefined ? questionData.imageUrl : (newImages[0] || current.imageUrl || ''),
      options: questionData.options !== undefined ? questionData.options : current.options,
      matchingPairs: questionData.matchingPairs !== undefined ? questionData.matchingPairs : current.matchingPairs,
      orderingItems: questionData.orderingItems !== undefined ? questionData.orderingItems : current.orderingItems,
      blanks: questionData.blanks !== undefined ? (Array.isArray(questionData.blanks) ? questionData.blanks : []) : (current.blanks || []),
      hotspotTarget: questionData.hotspotTarget !== undefined ? questionData.hotspotTarget : (current.hotspotTarget || null),
      correct: questionData.correct !== undefined ? questionData.correct : current.correct,
      correctKeywords: questionData.correctKeywords !== undefined ? questionData.correctKeywords : (current.correctKeywords || []),
      timeLimitSeconds: questionData.timeLimitSeconds !== undefined ? parseInt(questionData.timeLimitSeconds, 10) : current.timeLimitSeconds
    };
    if (type === 'numeric') {
      const targetNum = parseNumericInput(updated.correct);
      const tolSource = questionData.numericTolerance !== undefined ? questionData.numericTolerance : current.numericTolerance;
      updated.correct = targetNum !== null ? targetNum : 0;
      updated.numericTolerance = Math.max(0, Math.abs(parseNumericInput(tolSource) ?? 0));
    }
    test.questions[idx] = updated;
    await this.saveTest(test);
    return test.questions[idx];
  }

  async deleteQuestion(testId, questionId) {
    const test = await this.getTest(testId);
    if (!test || !test.questions) return false;
    const initialLen = test.questions.length;
    test.questions = test.questions.filter(q => q.id !== questionId);
    if (test.questions.length !== initialLen) {
      await this.saveTest(test);
      return true;
    }
    return false;
  }

  async createSession(session) {
    const originalTest = await this.getTest(session.testId);
    const randomizedQuestions = buildSessionQuestions(originalTest);
    const startedAt = Date.now();
    const avatar = (session.avatar && session.avatar.value) ? session.avatar : generateDefaultAvatar(session.studentName);
    const netStats = { totalPings: 0, averageLatency: 0, packetLossCount: 0, disconnectsCount: 0 };

    await this.pool.query(
      `INSERT INTO sessions (
        id, test_id, student_name, student_id, client_ip, status, trust_score, started_at,
        network_stats, student_token, avatar, client_info, proctor_bypassed, partial_answers,
        questions, incidents_count, is_paused, pause_message, total_paused_ms,
        retake_allowed, retake_used, attempt_number, previous_session_id, duration_minutes
      ) VALUES (
        $1, $2, $3, $4, $5, 'in_progress', 100, $6,
        $7, $8, $9, $10, $11, '{}'::jsonb,
        $12, 0, FALSE, '', 0,
        FALSE, FALSE, $13, $14, $15
      )`,
      [
        session.id,
        session.testId,
        session.studentName,
        session.studentId,
        session.clientIp,
        startedAt,
        JSON.stringify(netStats),
        session.studentToken || null,
        JSON.stringify(avatar),
        JSON.stringify(session.clientInfo || {}),
        !!session.proctorBypassed,
        JSON.stringify(randomizedQuestions),
        session.attemptNumber || 1,
        session.previousSessionId || null,
        originalTest ? (originalTest.durationMinutes || 15) : 15
      ]
    );
    return this.getSession(session.id);
  }

  async getSession(sessionId) {
    const res = await this.pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    return mapSessionRow(res.rows[0]);
  }

  async getAllSessions() {
    const res = await this.pool.query('SELECT * FROM sessions ORDER BY started_at DESC');
    return res.rows.map(mapSessionRow);
  }

  async findLatestFinishedSessionForStudent(testId, studentName, studentId) {
    const res = await this.pool.query(
      `SELECT * FROM sessions
       WHERE test_id = $1
         AND status IN ('completed', 'disqualified')
         AND LOWER(TRIM(student_name)) = LOWER(TRIM($2))
         AND LOWER(TRIM(student_id)) = LOWER(TRIM($3))
       ORDER BY COALESCE(submitted_at, started_at) DESC
       LIMIT 1`,
      [testId, studentName || '', studentId || '']
    );
    return mapSessionRow(res.rows[0]);
  }

  async allowSessionRetake(sessionId) {
    const res = await this.pool.query(
      `UPDATE sessions
       SET retake_allowed = TRUE, retake_used = FALSE, retake_granted_at = $1
       WHERE id = $2
       RETURNING *`,
      [Date.now(), sessionId]
    );
    return mapSessionRow(res.rows[0]);
  }

  async consumeRetakePermission(sessionId) {
    const res = await this.pool.query(
      `UPDATE sessions
       SET retake_allowed = FALSE, retake_used = TRUE
       WHERE id = $1
       RETURNING *`,
      [sessionId]
    );
    return mapSessionRow(res.rows[0]);
  }

  async setSessionPaused(sessionId, paused, message = '') {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    if (paused) {
      const pausedAt = session.isPaused ? (session.pausedAt || Date.now()) : Date.now();
      const pauseMsg = (message || session.pauseMessage || 'Тестування тимчасово призупинено викладачем').trim();
      const res = await this.pool.query(
        `UPDATE sessions SET is_paused = TRUE, paused_at = $1, pause_message = $2 WHERE id = $3 RETURNING *`,
        [pausedAt, pauseMsg, sessionId]
      );
      return mapSessionRow(res.rows[0]);
    } else {
      let totalPausedMs = session.totalPausedMs || 0;
      if (session.isPaused && session.pausedAt) {
        totalPausedMs += Math.max(0, Date.now() - session.pausedAt);
      }
      const res = await this.pool.query(
        `UPDATE sessions SET is_paused = FALSE, paused_at = NULL, pause_message = '', total_paused_ms = $1 WHERE id = $2 RETURNING *`,
        [totalPausedMs, sessionId]
      );
      return mapSessionRow(res.rows[0]);
    }
  }

  async logIncident(sessionId, incident) {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const id = generateSecureId('inc_', 6);
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO incidents (
        id, session_id, timestamp, category, type, message, severity, penalty, network_state, raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        sessionId,
        now,
        incident.category || 'info',
        incident.type || 'notice',
        incident.message || '',
        incident.severity || 'info',
        incident.penalty || 0,
        JSON.stringify(incident.networkState || {}),
        JSON.stringify(incident)
      ]
    );

    if (incident.type === 'split_screen_fatal_violation') {
      await this.pool.query(
        `UPDATE sessions SET trust_score = 0, status = 'disqualified', incidents_count = incidents_count + 1 WHERE id = $1`,
        [sessionId]
      );
    } else if (incident.penalty) {
      await this.pool.query(
        `UPDATE sessions SET trust_score = GREATEST(0, trust_score - $1), incidents_count = incidents_count + 1 WHERE id = $2`,
        [incident.penalty, sessionId]
      );
    } else {
      await this.pool.query(
        `UPDATE sessions SET incidents_count = incidents_count + 1 WHERE id = $1`,
        [sessionId]
      );
    }

    return { id, sessionId, timestamp: now, ...incident };
  }

  async recordPing(sessionId, pingData) {
    const session = await this.getSession(sessionId);
    if (!session) return;

    await this.pool.query(
      'INSERT INTO pings (session_id, timestamp, latency, status) VALUES ($1, $2, $3, $4)',
      [sessionId, Date.now(), pingData.latency || 0, pingData.status || 'ok']
    );

    await this.pool.query(
      `DELETE FROM pings WHERE session_id = $1 AND id NOT IN (
         SELECT id FROM pings WHERE session_id = $1 ORDER BY id DESC LIMIT 100
       )`,
      [sessionId]
    );

    const pingsRes = await this.pool.query('SELECT latency, status FROM pings WHERE session_id = $1', [sessionId]);
    const pings = pingsRes.rows;
    const validPings = pings.filter(p => p.status === 'ok');
    const totalLatency = validPings.reduce((sum, p) => sum + Number(p.latency), 0);
    const prevStats = session.networkStats || {};
    const updatedStats = {
      totalPings: pings.length,
      averageLatency: validPings.length > 0 ? Math.round(totalLatency / validPings.length) : 0,
      packetLossCount: (prevStats.packetLossCount || 0) + ((pingData.status === 'timeout' || pingData.status === 'failed') ? 1 : 0),
      disconnectsCount: prevStats.disconnectsCount || 0
    };
    await this.pool.query('UPDATE sessions SET network_stats = $1 WHERE id = $2', [JSON.stringify(updatedStats), sessionId]);
  }

  async submitTest(sessionId, submission) {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const test = await this.getTest(session.testId);
    const incidents = await this.getSessionIncidents(sessionId);
    const result = evaluateTestSubmission(session, test, submission, incidents);

    let totalPausedMs = session.totalPausedMs || 0;
    if (session.isPaused && session.pausedAt) {
      totalPausedMs += Math.max(0, Date.now() - session.pausedAt);
    }

    await this.pool.query(
      `UPDATE sessions SET
        status = $1,
        submitted_at = $2,
        answers = $3,
        question_timings = $4,
        raw_score = $5,
        total_questions = $6,
        score_percentage = $7,
        score12 = $8,
        trust_score = $9,
        final_verdict = $10,
        is_paused = FALSE,
        paused_at = NULL,
        pause_message = '',
        total_paused_ms = $11
       WHERE id = $12`,
      [
        result.status,
        result.submittedAt,
        JSON.stringify(result.answers),
        JSON.stringify(result.questionTimings),
        result.rawScore,
        result.totalQuestions,
        result.scorePercentage,
        result.score12,
        result.trustScore,
        JSON.stringify(result.finalVerdict),
        totalPausedMs,
        sessionId
      ]
    );

    return this.getSession(sessionId);
  }

  async adminOverrideUnlock(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    await this.pool.query(
      `UPDATE sessions SET status = 'in_progress', trust_score = GREATEST(trust_score, 70), final_verdict = NULL WHERE id = $1`,
      [sessionId]
    );
    await this.pool.query(
      `UPDATE incidents SET type = 'split_screen_admin_overridden' WHERE session_id = $1 AND type = 'split_screen_fatal_violation'`,
      [sessionId]
    );
    return this.getSession(sessionId);
  }

  async adminOverrideBypass(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    await this.pool.query(
      `UPDATE sessions SET status = 'in_progress', proctor_bypassed = TRUE, trust_score = GREATEST(trust_score, 70), final_verdict = NULL WHERE id = $1`,
      [sessionId]
    );
    await this.pool.query(
      `UPDATE incidents SET type = 'split_screen_admin_overridden' WHERE session_id = $1 AND type = 'split_screen_fatal_violation'`,
      [sessionId]
    );
    return this.getSession(sessionId);
  }

  async savePartialAnswers(sessionId, answers) {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const merged = { ...(session.partialAnswers || {}), ...answers };
    await this.pool.query('UPDATE sessions SET partial_answers = $1 WHERE id = $2', [JSON.stringify(merged), sessionId]);
    return merged;
  }

  async adminOverrideScore(sessionId, newScore12) {
    const s12 = Math.max(1, Math.min(12, Math.round(Number(newScore12))));
    const res = await this.pool.query(
      `UPDATE sessions SET score12 = $1, score12_manual_override = TRUE WHERE id = $2 RETURNING *`,
      [s12, sessionId]
    );
    return mapSessionRow(res.rows[0]);
  }

  async addSessionTime(sessionId, minutes) {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const addMins = parseInt(minutes, 10) || 5;
    const nextExtra = (session.extraTimeMinutes || 0) + addMins;
    const nextDuration = session.durationMinutes ? session.durationMinutes + addMins : null;
    await this.pool.query(
      `UPDATE sessions SET extra_time_minutes = $1, duration_minutes = COALESCE($2, duration_minutes) WHERE id = $3`,
      [nextExtra, nextDuration, sessionId]
    );
    return this.getSession(sessionId);
  }

  async deleteSession(sessionId) {
    const res = await this.pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    if (res.rowCount === 0) return false;
    await this.pool.query('DELETE FROM incidents WHERE session_id = $1', [sessionId]);
    await this.pool.query('DELETE FROM pings WHERE session_id = $1', [sessionId]);
    return true;
  }

  async clearAllSessions() {
    const cntRes = await this.pool.query('SELECT COUNT(*)::int AS cnt FROM sessions');
    const count = cntRes.rows[0]?.cnt || 0;
    await this.pool.query('DELETE FROM pings');
    await this.pool.query('DELETE FROM incidents');
    await this.pool.query('DELETE FROM sessions');
    return count;
  }

  async deleteSessionsByFilter(filter = {}) {
    const { classId, status } = filter;
    const all = await this.getAllSessions();
    const toDeleteIds = [];
    all.forEach(s => {
      let match = true;
      if (classId && s.studentId !== classId && s.classId !== classId) match = false;
      if (status) {
        if (status === 'incomplete' && (s.status === 'completed' || s.status === 'disqualified')) match = false;
        if (status === 'completed' && s.status !== 'completed') match = false;
        if (status === 'disqualified' && s.status !== 'disqualified') match = false;
      }
      if (match) toDeleteIds.push(s.id);
    });
    if (toDeleteIds.length === 0) return 0;
    await this.pool.query('DELETE FROM pings WHERE session_id = ANY($1)', [toDeleteIds]);
    await this.pool.query('DELETE FROM incidents WHERE session_id = ANY($1)', [toDeleteIds]);
    await this.pool.query('DELETE FROM sessions WHERE id = ANY($1)', [toDeleteIds]);
    return toDeleteIds.length;
  }

  async getSessionIncidents(sessionId) {
    const res = await this.pool.query('SELECT * FROM incidents WHERE session_id = $1 ORDER BY timestamp ASC', [sessionId]);
    return res.rows.map(row => ({
      ...(row.raw_data || {}),
      id: row.id,
      sessionId: row.session_id,
      timestamp: Number(row.timestamp),
      category: row.category,
      type: row.type,
      message: row.message,
      severity: row.severity,
      penalty: row.penalty || 0,
      networkState: row.network_state || {}
    }));
  }

  async getSessionPings(sessionId) {
    const res = await this.pool.query('SELECT timestamp, latency, status FROM pings WHERE session_id = $1 ORDER BY id ASC', [sessionId]);
    return res.rows.map(r => ({
      timestamp: Number(r.timestamp),
      latency: Number(r.latency),
      status: r.status
    }));
  }

  async getLeaderboard(testId = null) {
    const allSessions = await this.getAllSessions();
    const allTests = await this.getAllTests();
    const testsMap = {};
    allTests.forEach(t => { testsMap[t.id] = t; });
    return buildLeaderboardList(allSessions, testsMap, testId);
  }

  async getTestAnalytics(testId, classId = '') {
    const test = await this.getTest(testId);
    if (!test) return null;
    const allSessions = await this.getAllSessions();
    return buildTestAnalytics(test, allSessions, classId);
  }

  async getAllClasses() {
    const res = await this.pool.query('SELECT * FROM classes ORDER BY created_at ASC');
    return res.rows.map(mapClassRow);
  }

  async getClass(classId) {
    const res = await this.pool.query('SELECT * FROM classes WHERE id = $1', [classId]);
    return mapClassRow(res.rows[0]);
  }

  async createClass(classData) {
    const id = generateSecureId('class_', 6);
    const assignedTests = classData.assignedTests || classData.testIds || [];
    const createdAt = Date.now();
    await this.pool.query(
      `INSERT INTO classes (id, name, description, grade, subject, created_at, students, assigned_tests)
       VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $7)`,
      [
        id,
        classData.name || 'Новий клас',
        classData.description || '',
        classData.grade || '10',
        classData.subject || 'Географія',
        createdAt,
        JSON.stringify(assignedTests)
      ]
    );
    return this.getClass(id);
  }

  async updateClass(classId, classData) {
    const cls = await this.getClass(classId);
    if (!cls) return null;
    const name = classData.name !== undefined ? classData.name : cls.name;
    const description = classData.description !== undefined ? classData.description : cls.description;
    const grade = classData.grade !== undefined ? classData.grade : cls.grade;
    const subject = classData.subject !== undefined ? classData.subject : cls.subject;
    await this.pool.query(
      `UPDATE classes SET name = $1, description = $2, grade = $3, subject = $4 WHERE id = $5`,
      [name, description, grade, subject, classId]
    );
    return this.getClass(classId);
  }

  async deleteClass(classId) {
    const res = await this.pool.query('DELETE FROM classes WHERE id = $1', [classId]);
    return res.rowCount > 0;
  }

  async addStudentToClass(classId, student) {
    const cls = await this.getClass(classId);
    if (!cls) return null;
    const students = cls.students || [];
    if (!students.some(s => s.id === student.id)) {
      students.push({
        id: student.id || generateSecureId('std_', 6),
        name: student.name || 'Учень',
        addedAt: Date.now()
      });
      await this.pool.query('UPDATE classes SET students = $1 WHERE id = $2', [JSON.stringify(students), classId]);
    }
    return this.getClass(classId);
  }

  async removeStudentFromClass(classId, studentId) {
    const cls = await this.getClass(classId);
    if (!cls) return null;
    const students = (cls.students || []).filter(s => s.id !== studentId);
    await this.pool.query('UPDATE classes SET students = $1 WHERE id = $2', [JSON.stringify(students), classId]);
    return this.getClass(classId);
  }

  async assignTestToClass(classId, testId) {
    const cls = await this.getClass(classId);
    if (!cls) return null;
    const assigned = cls.assignedTests || [];
    if (!assigned.includes(testId)) {
      assigned.push(testId);
      await this.pool.query('UPDATE classes SET assigned_tests = $1 WHERE id = $2', [JSON.stringify(assigned), classId]);
    }
    return this.getClass(classId);
  }

  async removeTestFromClass(classId, testId) {
    const cls = await this.getClass(classId);
    if (!cls) return null;
    const assigned = (cls.assignedTests || []).filter(id => id !== testId);
    await this.pool.query('UPDATE classes SET assigned_tests = $1 WHERE id = $2', [JSON.stringify(assigned), classId]);
    return this.getClass(classId);
  }

  async saveSupportTicket(ticket) {
    await this.pool.query(
      `INSERT INTO support_tickets (id, type, title, description, name, contact, created_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        ticket.id,
        ticket.type,
        ticket.title,
        ticket.description,
        ticket.name,
        ticket.contact,
        ticket.createdAt,
        ticket.status || 'new'
      ]
    );
    return ticket;
  }

  async getSupportTickets() {
    const res = await this.pool.query('SELECT * FROM support_tickets ORDER BY created_at DESC');
    return res.rows.map(r => ({
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description,
      name: r.name,
      contact: r.contact,
      createdAt: r.created_at,
      status: r.status
    }));
  }

  async deleteSupportTicket(ticketId) {
    const res = await this.pool.query('DELETE FROM support_tickets WHERE id = $1', [ticketId]);
    return res.rowCount > 0;
  }
}

import { DatabaseAdapter } from './database.js';

export class PostgresDatabaseAdapter extends DatabaseAdapter {
  constructor(pgPool) {
    super();
    this.pool = pgPool;
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tests (
        id VARCHAR(64) PRIMARY KEY,
        title TEXT NOT NULL,
        duration_minutes INT NOT NULL,
        questions JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(64) PRIMARY KEY,
        test_id VARCHAR(64) REFERENCES tests(id),
        student_name TEXT NOT NULL,
        student_id TEXT NOT NULL,
        client_ip TEXT,
        status VARCHAR(32) NOT NULL,
        trust_score INT NOT NULL,
        started_at BIGINT NOT NULL,
        submitted_at BIGINT,
        score_percentage INT,
        raw_score INT,
        total_questions INT,
        answers JSONB,
        final_verdict JSONB,
        network_stats JSONB
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id VARCHAR(64) PRIMARY KEY,
        session_id VARCHAR(64) REFERENCES sessions(id),
        timestamp BIGINT NOT NULL,
        category VARCHAR(64) NOT NULL,
        type VARCHAR(64) NOT NULL,
        message TEXT NOT NULL,
        severity VARCHAR(32) NOT NULL,
        penalty INT,
        network_state JSONB,
        raw_data JSONB
      );

      CREATE TABLE IF NOT EXISTS pings (
        id BIGSERIAL PRIMARY KEY,
        session_id VARCHAR(64) REFERENCES sessions(id),
        timestamp BIGINT NOT NULL,
        latency INT NOT NULL,
        status VARCHAR(32) NOT NULL
      );
    `);
  }

  async getTest(testId) {
    const res = await this.pool.query('SELECT * FROM tests WHERE id = $1', [testId]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      title: row.title,
      durationMinutes: row.duration_minutes,
      questions: row.questions
    };
  }

  async saveTest(test) {
    await this.pool.query(
      `INSERT INTO tests (id, title, duration_minutes, questions)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         duration_minutes = EXCLUDED.duration_minutes,
         questions = EXCLUDED.questions`,
      [test.id, test.title, test.durationMinutes, JSON.stringify(test.questions)]
    );
    return test;
  }

  async createSession(session) {
    const startedAt = Date.now();
    await this.pool.query(
      `INSERT INTO sessions (
        id, test_id, student_name, student_id, client_ip, status, trust_score, started_at, network_stats
      ) VALUES ($1, $2, $3, $4, $5, 'in_progress', 100, $6, $7)`,
      [
        session.id,
        session.testId,
        session.studentName,
        session.studentId,
        session.clientIp,
        startedAt,
        JSON.stringify({ totalPings: 0, averageLatency: 0, packetLossCount: 0, disconnectsCount: 0 })
      ]
    );
    return this.getSession(session.id);
  }

  async getSession(sessionId) {
    const res = await this.pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      testId: row.test_id,
      studentName: row.student_name,
      studentId: row.student_id,
      clientIp: row.client_ip,
      status: row.status,
      trustScore: row.trust_score,
      startedAt: Number(row.started_at),
      submittedAt: row.submitted_at ? Number(row.submitted_at) : null,
      scorePercentage: row.score_percentage,
      rawScore: row.raw_score,
      totalQuestions: row.total_questions,
      answers: row.answers || {},
      finalVerdict: row.final_verdict,
      networkStats: row.network_stats || {}
    };
  }

  async getAllSessions() {
    const res = await this.pool.query('SELECT * FROM sessions ORDER BY started_at DESC');
    return res.rows.map(row => ({
      id: row.id,
      testId: row.test_id,
      studentName: row.student_name,
      studentId: row.student_id,
      clientIp: row.client_ip,
      status: row.status,
      trustScore: row.trust_score,
      startedAt: Number(row.started_at),
      submittedAt: row.submitted_at ? Number(row.submitted_at) : null,
      scorePercentage: row.score_percentage,
      rawScore: row.raw_score,
      totalQuestions: row.total_questions,
      answers: row.answers || {},
      finalVerdict: row.final_verdict,
      networkStats: row.network_stats || {}
    }));
  }

  async logIncident(sessionId, incident) {
    const id = 'inc_' + Math.random().toString(36).substring(2, 9);
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO incidents (
        id, session_id, timestamp, category, type, message, severity, penalty, network_state, raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        sessionId,
        now,
        incident.category,
        incident.type,
        incident.message,
        incident.severity || 'info',
        incident.penalty || 0,
        JSON.stringify(incident.networkState || {}),
        JSON.stringify(incident)
      ]
    );

    if (incident.penalty) {
      await this.pool.query(
        'UPDATE sessions SET trust_score = GREATEST(0, trust_score - $1) WHERE id = $2',
        [incident.penalty, sessionId]
      );
    }

    return { id, sessionId, timestamp: now, ...incident };
  }

  async recordPing(sessionId, pingData) {
    await this.pool.query(
      'INSERT INTO pings (session_id, timestamp, latency, status) VALUES ($1, $2, $3, $4)',
      [sessionId, Date.now(), pingData.latency, pingData.status]
    );
  }

  async submitTest(sessionId, submission) {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const test = await this.getTest(session.testId);
    let correctCount = 0;
    const gradedAnswers = {};

    if (test && test.questions) {
      test.questions.forEach((q) => {
        const userAnswer = submission.answers[q.id];
        const isCorrect = userAnswer !== undefined && userAnswer === q.correct;
        if (isCorrect) correctCount++;
        gradedAnswers[q.id] = { userAnswer, correctAnswer: q.correct, isCorrect };
      });
    }

    const totalQuestions = test ? test.questions.length : 0;
    const scorePercentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    const incidentsRes = await this.pool.query('SELECT * FROM incidents WHERE session_id = $1', [sessionId]);
    const incidents = incidentsRes.rows;
    const cheatingIncidents = incidents.filter(i => i.category === 'cheating_attempt' || i.category === 'focus_loss' || i.category === 'devtools_opened');
    const networkIncidents = incidents.filter(i => i.category === 'network_issue');

    let finalVerdict;
    if (session.trustScore < 40 || cheatingIncidents.length >= 3) {
      finalVerdict = {
        decision: 'REJECTED_HIGH_CHEATING_RISK',
        reason: 'Виявлено багаторазові критичні порушення академічної доброчесності.',
        cheatingCount: cheatingIncidents.length,
        networkCount: networkIncidents.length
      };
    } else if (cheatingIncidents.length > 0) {
      finalVerdict = {
        decision: 'REVIEW_REQUIRED',
        reason: 'Потрібна перевірка: підозріла активність при стабільному інтернет-з\'єднанні.',
        cheatingCount: cheatingIncidents.length,
        networkCount: networkIncidents.length
      };
    } else if (networkIncidents.length > 0) {
      finalVerdict = {
        decision: 'APPROVED_WITH_NETWORK_NOTICES',
        reason: 'Тест пройдено доброчесно. Зафіксовані мережеві перебої не є спробою обману.',
        cheatingCount: 0,
        networkCount: networkIncidents.length
      };
    } else {
      finalVerdict = {
        decision: 'PERFECT_INTEGRITY',
        reason: 'Тест пройдено без жодних порушень доброчесності.',
        cheatingCount: 0,
        networkCount: 0
      };
    }

    await this.pool.query(
      `UPDATE sessions SET
        status = 'completed',
        submitted_at = $1,
        score_percentage = $2,
        raw_score = $3,
        total_questions = $4,
        answers = $5,
        final_verdict = $6
       WHERE id = $7`,
      [Date.now(), scorePercentage, correctCount, totalQuestions, JSON.stringify(gradedAnswers), JSON.stringify(finalVerdict), sessionId]
    );

    return this.getSession(sessionId);
  }
}

export class MongoDatabaseAdapter extends DatabaseAdapter {
  constructor(mongoClient, dbName = 'secure_exam') {
    super();
    this.client = mongoClient;
    this.dbName = dbName;
  }

  get db() {
    return this.client.db(this.dbName);
  }

  async init() {
    await this.db.collection('tests').createIndex({ id: 1 }, { unique: true });
    await this.db.collection('sessions').createIndex({ id: 1 }, { unique: true });
    await this.db.collection('incidents').createIndex({ sessionId: 1, timestamp: -1 });
    await this.db.collection('pings').createIndex({ sessionId: 1, timestamp: -1 });
  }

  async getTest(testId) {
    return this.db.collection('tests').findOne({ id: testId });
  }

  async saveTest(test) {
    await this.db.collection('tests').updateOne({ id: test.id }, { $set: test }, { upsert: true });
    return test;
  }

  async createSession(session) {
    const doc = {
      ...session,
      startedAt: Date.now(),
      status: 'in_progress',
      trustScore: 100,
      incidentsCount: 0,
      answers: {},
      networkStats: { totalPings: 0, averageLatency: 0, packetLossCount: 0, disconnectsCount: 0 }
    };
    await this.db.collection('sessions').insertOne(doc);
    return doc;
  }

  async getSession(sessionId) {
    return this.db.collection('sessions').findOne({ id: sessionId });
  }

  async getAllSessions() {
    return this.db.collection('sessions').find().sort({ startedAt: -1 }).toArray();
  }

  async logIncident(sessionId, incident) {
    const doc = {
      id: 'inc_' + Math.random().toString(36).substring(2, 9),
      sessionId,
      timestamp: Date.now(),
      ...incident
    };
    await this.db.collection('incidents').insertOne(doc);

    if (incident.penalty) {
      await this.db.collection('sessions').updateOne(
        { id: sessionId },
        { $inc: { trustScore: -incident.penalty, incidentsCount: 1 } }
      );
    }
    return doc;
  }

  async recordPing(sessionId, pingData) {
    await this.db.collection('pings').insertOne({
      sessionId,
      timestamp: Date.now(),
      latency: pingData.latency,
      status: pingData.status
    });
  }

  async submitTest(sessionId, submission) {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const test = await this.getTest(session.testId);
    let correctCount = 0;
    const gradedAnswers = {};

    if (test && test.questions) {
      test.questions.forEach((q) => {
        const userAnswer = submission.answers[q.id];
        const isCorrect = userAnswer !== undefined && userAnswer === q.correct;
        if (isCorrect) correctCount++;
        gradedAnswers[q.id] = { userAnswer, correctAnswer: q.correct, isCorrect };
      });
    }

    const totalQuestions = test ? test.questions.length : 0;
    const scorePercentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    await this.db.collection('sessions').updateOne(
      { id: sessionId },
      {
        $set: {
          status: 'completed',
          submittedAt: Date.now(),
          answers: gradedAnswers,
          rawScore: correctCount,
          totalQuestions,
          scorePercentage
        }
      }
    );

    return this.getSession(sessionId);
  }
}

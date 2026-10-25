import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'data.json');

export class DatabaseAdapter {
  async init() {}
  async getTest(testId) {}
  async saveTest(test) {}
  async createSession(session) {}
  async getSession(sessionId) {}
  async getAllSessions() {}
  async logIncident(sessionId, incident) {}
  async recordPing(sessionId, pingData) {}
  async submitTest(sessionId, submission) {}
  async getAllClasses() {}
  async getClass(classId) {}
  async createClass(classData) {}
  async updateClass(classId, classData) {}
  async deleteClass(classId) {}
  async addStudentToClass(classId, student) {}
  async removeStudentFromClass(classId, studentId) {}
  async assignTestToClass(classId, testId) {}
  async removeTestFromClass(classId, testId) {}
}

export class JsonFileDatabaseAdapter extends DatabaseAdapter {
  constructor(filePath = DATA_FILE) {
    super();
    this.filePath = filePath;
    this.data = {
      tests: {},
      sessions: {},
      incidents: [],
      pings: {},
      classes: {}
    };
  }

  async init() {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
      if (!this.data.classes) this.data.classes = {};
    } catch {
      await this.seedDefaultData();
      await this.persist();
    }
  }

  async persist() {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error(err);
    }
  }

  async seedDefaultData() {
    const defaultTest = {
      id: 'demo-test-1',
      title: 'Підсумковий екзамен: Комп\'ютерні системи та безпека',
      durationMinutes: 15,
      questions: [
        {
          id: 'q1',
          text: 'Який мережевий протокол забезпечує захищене шифроване з\'єднання на транспортному рівні?',
          type: 'single',
          options: ['HTTP', 'TLS/SSL', 'FTP', 'Telnet'],
          correct: 1,
          timeLimitSeconds: 60
        },
        {
          id: 'q2',
          text: 'Яка основна відмінність між атаками DoS та DDoS?',
          type: 'single',
          options: [
            'У протоколі шифрування',
            'DDoS здійснюється розподілено з багатьох джерел одночасно',
            'DoS використовує лише фізичний кабель',
            'DDoS не впливає на пропускну здатність'
          ],
          correct: 1,
          timeLimitSeconds: 60
        },
        {
          id: 'q3',
          text: 'Що таке RTT (Round Trip Time) у моніторингу мережі?',
          type: 'single',
          options: [
            'Час, необхідний пакету даних для подорожі туди й назад до сервера',
            'Кількість ядер у центральному процесорі',
            'Розмір буфера відеокарти',
            'Швидкість запису на жорсткий диск'
          ],
          correct: 0,
          timeLimitSeconds: 60
        },
        {
          id: 'q4',
          text: 'Який механізм браузера відстежує стан видимості вкладки для виявлення перемикання?',
          type: 'single',
          options: [
            'Page Visibility API (document.visibilityState)',
            'WebGL Renderer',
            'Canvas API',
            'Battery Status API'
          ],
          correct: 0,
          timeLimitSeconds: 60
        },
        {
          id: 'q5',
          text: 'Що з наведеного НЕ вважається надійним методом автентифікації без додаткових факторів?',
          type: 'single',
          options: [
            'Лише простий статичний пароль із 6 символів',
            'Апаратний FIDO2 ключ',
            'Двофакторна автентифікація з TOTP',
            'Біометричний сканер відбитка через WebAuthn'
          ],
          correct: 0,
          timeLimitSeconds: 60
        }
      ]
    };
    this.data.tests['demo-test-1'] = defaultTest;
  }

  async getTest(testId) {
    return this.data.tests[testId] || null;
  }

  async getAllTests() {
    return Object.values(this.data.tests);
  }

  async getActiveTestId() {
    if (this.data.activeTestId && this.data.tests[this.data.activeTestId]) {
      return this.data.activeTestId;
    }
    const firstId = Object.keys(this.data.tests)[0];
    return firstId || 'demo-test-1';
  }

  async setActiveTestId(testId) {
    if (this.data.tests[testId]) {
      this.data.activeTestId = testId;
      await this.persist();
      return true;
    }
    return false;
  }

  async createTest(testData) {
    const id = testData.id || ('test_' + Math.random().toString(36).substring(2, 9));
    const newTest = {
      id,
      title: testData.title || 'Новий тест',
      durationMinutes: parseInt(testData.durationMinutes, 10) || 15,
      questions: Array.isArray(testData.questions) ? testData.questions : [],
      topic: testData.topic || '',
      subject: testData.subject || '',
      tags: Array.isArray(testData.tags) ? testData.tags : []
    };
    this.data.tests[id] = newTest;
    await this.persist();
    return newTest;
  }

  async deleteTest(testId) {
    if (!this.data.tests[testId]) return false;
    delete this.data.tests[testId];
    await this.persist();
    return true;
  }

  async saveTest(test) {
    this.data.tests[test.id] = test;
    await this.persist();
    return test;
  }

  async addQuestion(testId, questionData) {
    const test = this.data.tests[testId];
    if (!test) return null;
    if (!test.questions) test.questions = [];
    const newQuestion = {
      id: questionData.id || ('q_' + Math.random().toString(36).substring(2, 9)),
      text: questionData.text,
      type: questionData.type || 'single',
      options: questionData.options || [],
      matchingPairs: questionData.matchingPairs || [],
      orderingItems: questionData.orderingItems || [],
      correct: questionData.correct !== undefined ? questionData.correct : 0,
      timeLimitSeconds: parseInt(questionData.timeLimitSeconds, 10) || 60
    };
    test.questions.push(newQuestion);
    await this.persist();
    return newQuestion;
  }

  async updateQuestion(testId, questionId, questionData) {
    const test = this.data.tests[testId];
    if (!test || !test.questions) return null;
    const idx = test.questions.findIndex(q => q.id === questionId);
    if (idx === -1) return null;
    test.questions[idx] = {
      ...test.questions[idx],
      text: questionData.text !== undefined ? questionData.text : test.questions[idx].text,
      type: questionData.type !== undefined ? questionData.type : (test.questions[idx].type || 'single'),
      options: questionData.options !== undefined ? questionData.options : test.questions[idx].options,
      matchingPairs: questionData.matchingPairs !== undefined ? questionData.matchingPairs : test.questions[idx].matchingPairs,
      orderingItems: questionData.orderingItems !== undefined ? questionData.orderingItems : test.questions[idx].orderingItems,
      correct: questionData.correct !== undefined ? questionData.correct : test.questions[idx].correct,
      timeLimitSeconds: questionData.timeLimitSeconds !== undefined ? parseInt(questionData.timeLimitSeconds, 10) : test.questions[idx].timeLimitSeconds
    };
    await this.persist();
    return test.questions[idx];
  }

  async deleteQuestion(testId, questionId) {
    const test = this.data.tests[testId];
    if (!test || !test.questions) return false;
    const initialLen = test.questions.length;
    test.questions = test.questions.filter(q => q.id !== questionId);
    if (test.questions.length !== initialLen) {
      await this.persist();
      return true;
    }
    return false;
  }

  async createSession(session) {
    const originalTest = this.data.tests[session.testId];
    let randomizedQuestions = [];
    if (originalTest && originalTest.questions) {
      randomizedQuestions = originalTest.questions.map(q => {
        const type = q.type || 'single';

        if (type === 'multiple') {
          const rawOpts = Array.isArray(q.options) ? q.options : [];
          const indexedOptions = rawOpts.map((opt, originalIdx) => ({ opt, originalIdx }));
          for (let i = indexedOptions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indexedOptions[i], indexedOptions[j]] = [indexedOptions[j], indexedOptions[i]];
          }
          const origCorrectArr = Array.isArray(q.correct) ? q.correct.map(Number) : [Number(q.correct) || 0];
          const newCorrectArr = origCorrectArr.map(oldIdx => {
            return indexedOptions.findIndex(o => o.originalIdx === oldIdx);
          }).filter(idx => idx !== -1).sort((a, b) => a - b);

          return {
            id: q.id,
            text: q.text,
            type: 'multiple',
            options: indexedOptions.map(o => o.opt),
            correct: newCorrectArr,
            timeLimitSeconds: q.timeLimitSeconds
          };
        }

        if (type === 'matching') {
          const pairs = Array.isArray(q.matchingPairs) ? q.matchingPairs : [];
          const leftItems = pairs.map((p, idx) => ({ id: idx, text: p.left || '' }));
          const rightItems = pairs.map((p, idx) => ({ originalIdx: idx, text: p.right || '' }));
          for (let i = rightItems.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rightItems[i], rightItems[j]] = [rightItems[j], rightItems[i]];
          }
          const correctMap = {};
          leftItems.forEach(left => {
            const newRightIdx = rightItems.findIndex(r => r.originalIdx === left.id);
            correctMap[left.id] = newRightIdx;
          });

          return {
            id: q.id,
            text: q.text,
            type: 'matching',
            matchingPairs: pairs,
            matchingLeft: leftItems.map(l => l.text),
            matchingRight: rightItems.map(r => r.text),
            correct: correctMap,
            timeLimitSeconds: q.timeLimitSeconds
          };
        }

        if (type === 'ordering') {
          const rawItems = Array.isArray(q.orderingItems) && q.orderingItems.length > 0
            ? q.orderingItems
            : (Array.isArray(q.options) ? q.options : []);
          const indexed = rawItems.map((text, originalOrder) => ({ text, originalOrder }));
          for (let i = indexed.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
          }
          return {
            id: q.id,
            text: q.text,
            type: 'ordering',
            orderingItems: rawItems,
            options: indexed.map(item => item.text),
            correct: rawItems,
            timeLimitSeconds: q.timeLimitSeconds
          };
        }

        const rawOpts = Array.isArray(q.options) ? q.options : [];
        const indexedOptions = rawOpts.map((opt, originalIdx) => ({ opt, originalIdx }));
        for (let i = indexedOptions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indexedOptions[i], indexedOptions[j]] = [indexedOptions[j], indexedOptions[i]];
        }
        const newCorrectIdx = indexedOptions.findIndex(o => o.originalIdx === q.correct);
        return {
          id: q.id,
          text: q.text,
          type: 'single',
          options: indexedOptions.map(o => o.opt),
          correct: newCorrectIdx >= 0 ? newCorrectIdx : 0,
          timeLimitSeconds: q.timeLimitSeconds
        };
      });

      for (let i = randomizedQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [randomizedQuestions[i], randomizedQuestions[j]] = [randomizedQuestions[j], randomizedQuestions[i]];
      }
    }

    this.data.sessions[session.id] = {
      ...session,
      startedAt: Date.now(),
      status: 'in_progress',
      trustScore: 100,
      incidentsCount: 0,
      answers: {},
      questions: randomizedQuestions,
      networkStats: {
        totalPings: 0,
        averageLatency: 0,
        packetLossCount: 0,
        disconnectsCount: 0
      }
    };
    this.data.pings[session.id] = [];
    await this.persist();
    return this.data.sessions[session.id];
  }

  async getSession(sessionId) {
    return this.data.sessions[sessionId] || null;
  }

  async getAllSessions() {
    return Object.values(this.data.sessions);
  }

  async logIncident(sessionId, incident) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;

    const incidentRecord = {
      id: 'inc_' + Math.random().toString(36).substring(2, 9),
      sessionId,
      timestamp: Date.now(),
      ...incident
    };

    this.data.incidents.push(incidentRecord);
    session.incidentsCount += 1;

    if (incident.penalty) {
      session.trustScore = Math.max(0, session.trustScore - incident.penalty);
    }

    if (incident.type === 'split_screen_fatal_violation') {
      session.trustScore = 0;
      session.status = 'disqualified';
    }

    await this.persist();
    return incidentRecord;
  }

  async recordPing(sessionId, pingData) {
    const session = this.data.sessions[sessionId];
    if (!session) return;

    if (!this.data.pings[sessionId]) {
      this.data.pings[sessionId] = [];
    }

    this.data.pings[sessionId].push({
      timestamp: Date.now(),
      latency: pingData.latency,
      status: pingData.status
    });

    if (this.data.pings[sessionId].length > 100) {
      this.data.pings[sessionId].shift();
    }

    const pings = this.data.pings[sessionId];
    const validPings = pings.filter(p => p.status === 'ok');
    const totalLatency = validPings.reduce((sum, p) => sum + p.latency, 0);

    session.networkStats.totalPings = pings.length;
    session.networkStats.averageLatency = validPings.length > 0 ? Math.round(totalLatency / validPings.length) : 0;
    if (pingData.status === 'timeout' || pingData.status === 'failed') {
      session.networkStats.packetLossCount += 1;
    }
  }

  async submitTest(sessionId, submission) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;

    const test = this.data.tests[session.testId];
    const questions = (session.questions && session.questions.length > 0) ? session.questions : (test ? test.questions : []);
    const sessionIncidents = this.data.incidents.filter(i => i.sessionId === session.id);
    const hasSplitScreen = sessionIncidents.some(i => i.type === 'split_screen_fatal_violation');

    if (hasSplitScreen) {
      session.status = 'disqualified';
      session.submittedAt = Date.now();
      session.answers = {};
      session.rawScore = 0;
      session.totalQuestions = questions.length;
      session.scorePercentage = 0;
      session.score12 = 1;
      session.trustScore = 0;
      session.finalVerdict = {
        decision: 'ANNULLED_SPLIT_SCREEN',
        reason: 'Тест анульовано за недоброчесність: розділення екрана (Split Screen) не було вимкнено протягом 10 секунд!',
        cheatingCount: sessionIncidents.filter(i => i.category === 'cheating_attempt' || i.category === 'devtools_opened').length,
        networkCount: sessionIncidents.filter(i => i.category === 'network_issue').length
      };
      await this.persist();
      return session;
    }

    let correctCount = 0;
    const gradedAnswers = {};

    questions.forEach((q) => {
      const userAnswer = submission.answers[q.id];
      let isCorrect = false;
      let earnedPoints = 0;

      if (q.type === 'multiple') {
        const correctArr = Array.isArray(q.correct) ? q.correct.map(Number).sort((a, b) => a - b) : [];
        const userArr = Array.isArray(userAnswer) ? userAnswer.map(Number).sort((a, b) => a - b) : [];
        if (correctArr.length > 0 && userArr.length === correctArr.length && userArr.every((v, i) => v === correctArr[i])) {
          isCorrect = true;
          earnedPoints = 1;
        } else if (correctArr.length > 0 && userArr.length > 0) {
          const matched = userArr.filter(v => correctArr.includes(v)).length;
          const wrong = userArr.filter(v => !correctArr.includes(v)).length;
          earnedPoints = Math.max(0, (matched - wrong) / correctArr.length);
          if (earnedPoints >= 0.99) isCorrect = true;
        }
      } else if (q.type === 'matching') {
        if (userAnswer && typeof userAnswer === 'object' && q.correct && typeof q.correct === 'object') {
          const keys = Object.keys(q.correct);
          let matchSuccess = 0;
          keys.forEach(k => {
            if (String(userAnswer[k]) === String(q.correct[k])) {
              matchSuccess++;
            }
          });
          earnedPoints = keys.length > 0 ? (matchSuccess / keys.length) : 0;
          if (earnedPoints >= 0.99) isCorrect = true;
        }
      } else if (q.type === 'ordering') {
        if (Array.isArray(userAnswer) && Array.isArray(q.correct)) {
          if (userAnswer.length === q.correct.length && userAnswer.every((v, i) => String(v) === String(q.correct[i]))) {
            isCorrect = true;
            earnedPoints = 1;
          } else {
            let correctPositions = 0;
            userAnswer.forEach((v, i) => {
              if (String(v) === String(q.correct[i])) correctPositions++;
            });
            earnedPoints = q.correct.length > 0 ? (correctPositions / q.correct.length) : 0;
            if (earnedPoints >= 0.99) isCorrect = true;
          }
        }
      } else {
        if (userAnswer !== undefined && Number(userAnswer) === Number(q.correct)) {
          isCorrect = true;
          earnedPoints = 1;
        }
      }

      correctCount += earnedPoints;
      const timeSpent = (submission.questionTimings && submission.questionTimings[q.id]) ? submission.questionTimings[q.id] : 0;
      gradedAnswers[q.id] = {
        userAnswer,
        correctAnswer: q.correct,
        isCorrect,
        earnedPoints: Math.round(earnedPoints * 100) / 100,
        timeSpent
      };
    });

    const totalQuestions = questions.length;
    const scorePercentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const score12 = calculate12Scale(correctCount, totalQuestions);

    session.status = 'completed';
    session.submittedAt = Date.now();
    session.answers = gradedAnswers;
    session.questionTimings = submission.questionTimings || {};
    session.rawScore = correctCount;
    session.totalQuestions = totalQuestions;
    session.scorePercentage = scorePercentage;
    session.score12 = score12;
    session.finalVerdict = this.calculateFinalVerdict(session);

    await this.persist();
    return session;
  }

  calculateFinalVerdict(session) {
    const sessionIncidents = this.data.incidents.filter(i => i.sessionId === session.id);
    const cheatingIncidents = sessionIncidents.filter(i => i.category === 'cheating_attempt' || i.category === 'focus_loss' || i.category === 'devtools_opened');
    const networkIncidents = sessionIncidents.filter(i => i.category === 'network_issue');

    const splitScreenViolation = sessionIncidents.some(i => i.type === 'split_screen_fatal_violation');
    if (splitScreenViolation) {
      return {
        decision: 'ANNULLED_SPLIT_SCREEN',
        reason: 'Тест анульовано за недоброчесність: розділення екрана (Split Screen) не було вимкнено протягом 10 секунд!',
        cheatingCount: cheatingIncidents.length,
        networkCount: networkIncidents.length
      };
    }

    if (session.trustScore < 20 || cheatingIncidents.length >= 6) {
      return {
        decision: 'REJECTED_HIGH_CHEATING_RISK',
        reason: 'Виявлено багаторазові критичні порушення академічної доброчесності (згортання вікна, спроба копіювання чи використання сторонніх інструментів).',
        cheatingCount: cheatingIncidents.length,
        networkCount: networkIncidents.length
      };
    }

    if (cheatingIncidents.length > 0) {
      return {
        decision: 'REVIEW_REQUIRED',
        reason: 'Потрібна перевірка викладачем: зафіксовано підозрілу активність при стабільному інтернет-з\'єднанні.',
        cheatingCount: cheatingIncidents.length,
        networkCount: networkIncidents.length
      };
    }

    if (networkIncidents.length > 0) {
      return {
        decision: 'APPROVED_WITH_NETWORK_NOTICES',
        reason: 'Тест пройдено доброчесно. Зафіксовані технічні перебої з інтернетом не були спробою обману.',
        cheatingCount: 0,
        networkCount: networkIncidents.length
      };
    }

    return {
      decision: 'PERFECT_INTEGRITY',
      reason: 'Тест пройдено з бездоганною доброчесністю (100% активності у вікні тесту).',
      cheatingCount: 0,
      networkCount: 0
    };
  }

  async adminOverrideUnlock(sessionId) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    session.status = 'in_progress';
    session.trustScore = Math.max(session.trustScore, 70);
    session.finalVerdict = null;
    const incidents = this.data.incidents.filter(i => i.sessionId === sessionId);
    incidents.forEach(i => {
      if (i.type === 'split_screen_fatal_violation') i.type = 'split_screen_admin_overridden';
    });
    await this.persist();
    return session;
  }

  async adminOverrideBypass(sessionId) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    session.status = 'in_progress';
    session.proctorBypassed = true;
    session.trustScore = Math.max(session.trustScore, 70);
    session.finalVerdict = null;
    const incidents = this.data.incidents.filter(i => i.sessionId === sessionId);
    incidents.forEach(i => {
      if (i.type === 'split_screen_fatal_violation') i.type = 'split_screen_admin_overridden';
    });
    await this.persist();
    return session;
  }

  async savePartialAnswers(sessionId, answers) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    if (!session.partialAnswers) session.partialAnswers = {};
    session.partialAnswers = { ...session.partialAnswers, ...answers };
    await this.persist();
    return session.partialAnswers;
  }

  async deleteSession(sessionId) {
    if (!this.data.sessions[sessionId]) return false;
    delete this.data.sessions[sessionId];
    this.data.incidents = this.data.incidents.filter(i => i.sessionId !== sessionId);
    if (this.data.pings) delete this.data.pings[sessionId];
    await this.persist();
    return true;
  }

  async clearAllSessions() {
    const count = Object.keys(this.data.sessions).length;
    this.data.sessions = {};
    this.data.incidents = [];
    this.data.pings = {};
    await this.persist();
    return count;
  }

  async getSessionIncidents(sessionId) {
    return this.data.incidents.filter(i => i.sessionId === sessionId);
  }

  async getSessionPings(sessionId) {
    return this.data.pings[sessionId] || [];
  }

  async getLeaderboard(testId = null) {
    const all = Object.values(this.data.sessions);
    const completed = all.filter(s => s.status === 'completed' && (!testId || s.testId === testId));
    completed.sort((a, b) => {
      const s12A = a.score12 !== undefined ? a.score12 : 1;
      const s12B = b.score12 !== undefined ? b.score12 : 1;
      if (s12B !== s12A) return s12B - s12A;
      const pctA = a.scorePercentage !== undefined ? a.scorePercentage : 0;
      const pctB = b.scorePercentage !== undefined ? b.scorePercentage : 0;
      if (pctB !== pctA) return pctB - pctA;
      const trA = a.trustScore !== undefined ? a.trustScore : 100;
      const trB = b.trustScore !== undefined ? b.trustScore : 100;
      if (trB !== trA) return trB - trA;
      const durA = (a.submittedAt && a.startedAt) ? (a.submittedAt - a.startedAt) : 99999999;
      const durB = (b.submittedAt && b.startedAt) ? (b.submittedAt - b.startedAt) : 99999999;
      return durA - durB;
    });

    return completed.map((s, idx) => {
      const durationSeconds = (s.submittedAt && s.startedAt) ? Math.max(1, Math.round((s.submittedAt - s.startedAt) / 1000)) : 0;
      const test = this.data.tests[s.testId];
      return {
        rank: idx + 1,
        sessionId: s.id,
        testId: s.testId,
        testTitle: test ? test.title : 'Тест',
        studentName: s.studentName,
        studentId: s.studentId,
        score12: s.score12 !== undefined ? s.score12 : 1,
        scorePercentage: s.scorePercentage || 0,
        rawScore: s.rawScore || 0,
        totalQuestions: s.totalQuestions || 0,
        trustScore: s.trustScore !== undefined ? s.trustScore : 100,
        durationSeconds,
        submittedAt: s.submittedAt
      };
    });
  }

  async getTestAnalytics(testId) {
    const test = this.data.tests[testId];
    if (!test) return null;
    const testSessions = Object.values(this.data.sessions).filter(s => s.testId === testId);
    const totalSessions = testSessions.length;
    const completedSessions = testSessions.filter(s => s.status === 'completed');

    const avgScore12 = completedSessions.length > 0
      ? Math.round((completedSessions.reduce((acc, s) => acc + (s.score12 || 0), 0) / completedSessions.length) * 10) / 10
      : 0;
    const avgScorePercent = completedSessions.length > 0
      ? Math.round(completedSessions.reduce((acc, s) => acc + (s.scorePercentage || 0), 0) / completedSessions.length)
      : 0;
    const avgTrustScore = testSessions.length > 0
      ? Math.round(testSessions.reduce((acc, s) => acc + (s.trustScore !== undefined ? s.trustScore : 100), 0) / testSessions.length)
      : 100;

    const questions = test.questions || [];
    const questionsAnalytics = questions.map((q, qIdx) => {
      let answeredCount = 0;
      let correctCount = 0;
      let totalTime = 0;
      let timeCount = 0;
      const optionCounts = (q.options || []).map(() => 0);

      completedSessions.forEach(s => {
        const ansObj = s.answers && s.answers[q.id];
        const timeVal = (s.questionTimings && s.questionTimings[q.id]) || (ansObj && ansObj.timeSpent) || 0;
        if (timeVal > 0) {
          totalTime += timeVal;
          timeCount++;
        }
        if (ansObj && ansObj.userAnswer !== undefined) {
          answeredCount++;
          if (ansObj.isCorrect) correctCount++;
          if (ansObj.userAnswer >= 0 && ansObj.userAnswer < optionCounts.length) {
            optionCounts[ansObj.userAnswer]++;
          }
        }
      });

      const successRate = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
      const avgTimeSeconds = timeCount > 0 ? Math.round(totalTime / timeCount) : 0;

      const optionBreakdown = (q.options || []).map((opt, optIdx) => {
        const count = optionCounts[optIdx] || 0;
        const percent = answeredCount > 0 ? Math.round((count / answeredCount) * 100) : 0;
        return {
          optionIndex: optIdx,
          text: opt,
          count,
          percent,
          isCorrect: optIdx === q.correct
        };
      });

      return {
        id: q.id,
        index: qIdx + 1,
        text: q.text,
        type: q.type || 'single',
        correct: q.correct,
        answeredCount,
        correctCount,
        incorrectCount: answeredCount - correctCount,
        successRate,
        avgTimeSeconds,
        optionBreakdown
      };
    });

    return {
      testId: test.id,
      testTitle: test.title,
      durationMinutes: test.durationMinutes,
      totalQuestions: questions.length,
      totalParticipants: totalSessions,
      completedCount: completedSessions.length,
      disqualifiedCount: totalSessions - completedSessions.length,
      avgScore12,
      avgScorePercent,
      avgTrustScore,
      questionsAnalytics
    };
  }

  async getAllClasses() {
    return Object.values(this.data.classes || {}).map(cls => {
      const tests = cls.assignedTests || cls.testIds || [];
      cls.assignedTests = tests;
      cls.testIds = tests;
      return cls;
    });
  }

  async getClass(classId) {
    const cls = (this.data.classes || {})[classId] || null;
    if (cls) {
      const tests = cls.assignedTests || cls.testIds || [];
      cls.assignedTests = tests;
      cls.testIds = tests;
    }
    return cls;
  }

  async createClass(classData) {
    if (!this.data.classes) this.data.classes = {};
    const id = 'class_' + Math.random().toString(36).substring(2, 9);
    const tests = classData.assignedTests || classData.testIds || [];
    const newClass = {
      id,
      name: classData.name || 'Новий клас',
      description: classData.description || '',
      grade: classData.grade || '10',
      subject: classData.subject || 'Географія',
      createdAt: Date.now(),
      students: [],
      assignedTests: tests,
      testIds: tests
    };
    this.data.classes[id] = newClass;
    await this.persist();
    return newClass;
  }

  async updateClass(classId, classData) {
    if (!this.data.classes) this.data.classes = {};
    const cls = this.data.classes[classId];
    if (!cls) return null;
    if (classData.name !== undefined) cls.name = classData.name;
    if (classData.description !== undefined) cls.description = classData.description;
    if (classData.grade !== undefined) cls.grade = classData.grade;
    if (classData.subject !== undefined) cls.subject = classData.subject;
    await this.persist();
    return cls;
  }

  async deleteClass(classId) {
    if (!this.data.classes || !this.data.classes[classId]) return false;
    delete this.data.classes[classId];
    await this.persist();
    return true;
  }

  async addStudentToClass(classId, student) {
    if (!this.data.classes) this.data.classes = {};
    const cls = this.data.classes[classId];
    if (!cls) return null;
    if (!cls.students) cls.students = [];
    const existing = cls.students.find(s => s.id === student.id);
    if (existing) return cls;
    cls.students.push({
      id: student.id || ('std_' + Math.random().toString(36).substring(2, 9)),
      name: student.name || 'Учень',
      addedAt: Date.now()
    });
    await this.persist();
    return cls;
  }

  async removeStudentFromClass(classId, studentId) {
    if (!this.data.classes) this.data.classes = {};
    const cls = this.data.classes[classId];
    if (!cls || !cls.students) return null;
    cls.students = cls.students.filter(s => s.id !== studentId);
    await this.persist();
    return cls;
  }

  async assignTestToClass(classId, testId) {
    if (!this.data.classes) this.data.classes = {};
    const cls = this.data.classes[classId];
    if (!cls) return null;
    if (!cls.assignedTests) cls.assignedTests = cls.testIds || [];
    if (!cls.testIds) cls.testIds = cls.assignedTests;
    if (!cls.assignedTests.includes(testId)) {
      cls.assignedTests.push(testId);
      if (!cls.testIds.includes(testId)) cls.testIds.push(testId);
      await this.persist();
    }
    return cls;
  }

  async removeTestFromClass(classId, testId) {
    if (!this.data.classes) this.data.classes = {};
    const cls = this.data.classes[classId];
    if (!cls) return null;
    cls.assignedTests = (cls.assignedTests || cls.testIds || []).filter(id => id !== testId);
    cls.testIds = cls.assignedTests;
    await this.persist();
    return cls;
  }
}

export function calculate12Scale(rawScore, totalQuestions) {
  if (!totalQuestions || totalQuestions <= 0) return 1;
  if (!rawScore || rawScore <= 0) return 1;
  const ratio = rawScore / totalQuestions;
  return Math.min(12, Math.max(1, Math.round(ratio * 12)));
}

export const db = new JsonFileDatabaseAdapter();

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = process.env.SECUREEXAM_DATA_FILE
  ? path.resolve(process.env.SECUREEXAM_DATA_FILE)
  : path.join(__dirname, 'data.json');

export function generateSecureId(prefix = '', byteLength = 10) {
  return `${prefix}${crypto.randomBytes(byteLength).toString('hex')}`;
}

export function parseNumericInput(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
    return null;
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export class DatabaseAdapter {
  async init() {}
  async getTest(testId) {}
  async getAllTests() {}
  async getActiveTestId() {}
  async setActiveTestId(testId) {}
  async getLiteMode() {}
  async setLiteMode(val) {}
  async createTest(testData) {}
  async deleteTest(testId) {}
  async saveTest(test) {}
  async addQuestion(testId, questionData) {}
  async updateQuestion(testId, questionId, questionData) {}
  async deleteQuestion(testId, questionId) {}
  async createSession(session) {}
  async getSession(sessionId) {}
  async getAllSessions() {}
  async findLatestFinishedSessionForStudent(testId, studentName, studentId) {}
  async allowSessionRetake(sessionId) {}
  async consumeRetakePermission(sessionId) {}
  async setSessionPaused(sessionId, paused, message) {}
  async logIncident(sessionId, incident) {}
  async recordPing(sessionId, pingData) {}
  async submitTest(sessionId, submission) {}
  async updateAiGradedSession(sessionId, payload) {}
  async adminOverrideUnlock(sessionId) {}
  async adminOverrideBypass(sessionId) {}
  async savePartialAnswers(sessionId, answers) {}
  async adminOverrideScore(sessionId, newScore12) {}
  async addSessionTime(sessionId, minutes) {}
  async deleteSession(sessionId) {}
  async clearAllSessions() {}
  async deleteSessionsByFilter(filter) {}
  async getSessionIncidents(sessionId) {}
  async getSessionPings(sessionId) {}
  async getLeaderboard(testId) {}
  async getTestAnalytics(testId, classId) {}
  async getAllClasses() {}
  async getClass(classId) {}
  async createClass(classData) {}
  async updateClass(classId, classData) {}
  async deleteClass(classId) {}
  async addStudentToClass(classId, student) {}
  async removeStudentFromClass(classId, studentId) {}
  async assignTestToClass(classId, testId) {}
  async removeTestFromClass(classId, testId) {}
  async saveSupportTicket(ticket) {}
  async getSupportTickets() {}
  async deleteSupportTicket(ticketId) {}
  isPostgres() { return false; }
}

export function generateDefaultAvatar(name) {
  const colors = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444'];
  const clean = (name || '').trim();
  let initials = '?';
  if (clean) {
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      initials = (parts[0][0] + parts[1][0]).toUpperCase();
    } else {
      initials = clean.substring(0, 2).toUpperCase();
    }
  }
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  const color = colors[Math.abs(hash) % colors.length];
  return { type: 'initials', value: initials, color };
}

export function calculate12Scale(rawScore, totalQuestions) {
  if (!totalQuestions || totalQuestions <= 0) return 1;
  if (!rawScore || rawScore <= 0) return 1;
  const ratio = rawScore / totalQuestions;
  return Math.min(12, Math.max(1, Math.round(ratio * 12)));
}

export function buildDefaultDemoTest() {
  return {
    id: 'demo-test-1',
    title: 'Підсумковий екзамен: Комп\'ютерні системи та безпека',
    durationMinutes: 15,
    topic: '',
    subject: '',
    tags: [],
    shuffleQuestions: false,
    shuffleOptions: false,
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
        text: 'Що таке RTT (Round Trip Time) у моніторигу мережі?',
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
          'Двофакторна автентиція з TOTP',
          'Біометричний сканер відбитка через WebAuthn'
        ],
        correct: 0,
        timeLimitSeconds: 60
      }
    ]
  };
}

export function normalizeQuestionData(questionData, fallbackId) {
  const images = Array.isArray(questionData.images)
    ? questionData.images
    : (questionData.imageUrl ? [questionData.imageUrl] : []);
  const type = questionData.type || 'single';
  const base = {
    id: questionData.id || fallbackId || generateSecureId('q_', 6),
    text: questionData.text,
    type,
    images,
    imageUrl: questionData.imageUrl || (images[0] || ''),
    options: Array.isArray(questionData.options) ? questionData.options : [],
    matchingPairs: Array.isArray(questionData.matchingPairs) ? questionData.matchingPairs : [],
    orderingItems: Array.isArray(questionData.orderingItems) ? questionData.orderingItems : [],
    blanks: Array.isArray(questionData.blanks) ? questionData.blanks : [],
    hotspotTarget: questionData.hotspotTarget || null,
    hotspotPrompt: questionData.hotspotPrompt || '',
    correct: questionData.correct !== undefined ? questionData.correct : 0,
    correctKeywords: Array.isArray(questionData.correctKeywords) ? questionData.correctKeywords : [],
    points: Math.max(1, parseInt(questionData.points, 10) || 1),
    explanation: questionData.explanation ? String(questionData.explanation).trim() : '',
    timeLimitSeconds: parseInt(questionData.timeLimitSeconds, 10) || 60
  };
  if (type === 'numeric') {
    const targetNum = parseNumericInput(questionData.correct);
    const rawTol = Math.max(0, Math.abs(parseNumericInput(questionData.numericTolerance) ?? 0));
    const tolEnabled = questionData.numericToleranceEnabled !== undefined ? !!questionData.numericToleranceEnabled : rawTol > 0;
    const tolNum = tolEnabled ? rawTol : 0;
    base.correct = targetNum !== null ? targetNum : 0;
    base.numericToleranceEnabled = tolEnabled && tolNum > 0;
    base.numericTolerance = tolNum;
  } else if (type === 'short_answer') {
    base.useAiGrading = !!questionData.useAiGrading;
  }
  return base;
}

export function buildSessionQuestions(originalTest) {
  if (!originalTest || !Array.isArray(originalTest.questions)) return [];
  const randomizedQuestions = originalTest.questions.map(q => {
    const type = q.type || 'single';
    const images = Array.isArray(q.images) && q.images.length > 0 ? q.images : (q.imageUrl ? [q.imageUrl] : []);
    const imageUrl = q.imageUrl || images[0] || '';

    if (type === 'short_answer') {
      return {
        id: q.id,
        text: q.text,
        type: 'short_answer',
        imageUrl,
        images,
        options: [],
        correct: q.correct !== undefined ? q.correct : '',
        correctKeywords: Array.isArray(q.correctKeywords) ? q.correctKeywords : [],
        useAiGrading: !!q.useAiGrading,
        timeLimitSeconds: q.timeLimitSeconds
      };
    }

    if (type === 'numeric') {
      const rawTol = Math.max(0, Math.abs(parseNumericInput(q.numericTolerance) ?? 0));
      const tolEnabled = q.numericToleranceEnabled !== undefined ? !!q.numericToleranceEnabled : rawTol > 0;
      const effectiveTol = tolEnabled ? rawTol : 0;
      return {
        id: q.id,
        text: q.text,
        type: 'numeric',
        imageUrl,
        images,
        correct: parseNumericInput(q.correct) ?? 0,
        numericToleranceEnabled: tolEnabled && effectiveTol > 0,
        numericTolerance: effectiveTol,
        timeLimitSeconds: q.timeLimitSeconds
      };
    }

    if (type === 'true_false') {
      return {
        id: q.id,
        text: q.text,
        type: 'true_false',
        imageUrl,
        images,
        options: ['Неправда', 'Правда'],
        correct: Number(q.correct) === 1 ? 1 : 0,
        timeLimitSeconds: q.timeLimitSeconds
      };
    }

    if (type === 'multiple') {
      const rawOpts = Array.isArray(q.options) ? q.options : [];
      const indexedOptions = rawOpts.map((opt, originalIdx) => ({ opt, originalIdx }));
      if (originalTest.shuffleOptions) {
        for (let i = indexedOptions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indexedOptions[i], indexedOptions[j]] = [indexedOptions[j], indexedOptions[i]];
        }
      }
      const origCorrectArr = Array.isArray(q.correct) ? q.correct.map(Number) : [Number(q.correct) || 0];
      const newCorrectArr = origCorrectArr.map(oldIdx => {
        return indexedOptions.findIndex(o => o.originalIdx === oldIdx);
      }).filter(idx => idx !== -1).sort((a, b) => a - b);

      return {
        id: q.id,
        text: q.text,
        type: 'multiple',
        imageUrl,
        images,
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
        imageUrl,
        images,
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
        imageUrl,
        images,
        orderingItems: rawItems,
        options: indexed.map(item => item.text),
        correct: rawItems,
        timeLimitSeconds: q.timeLimitSeconds
      };
    }

    if (type === 'fill_blanks') {
      return {
        id: q.id,
        text: q.text,
        type: 'fill_blanks',
        imageUrl,
        images,
        blanks: Array.isArray(q.blanks) ? q.blanks : [],
        timeLimitSeconds: q.timeLimitSeconds
      };
    }

    if (type === 'hotspot') {
      return {
        id: q.id,
        text: q.text,
        type: 'hotspot',
        imageUrl,
        images,
        hotspotTarget: q.hotspotTarget || null,
        hotspotPrompt: q.hotspotPrompt || 'Клікніть на правильну область на зображенні',
        timeLimitSeconds: q.timeLimitSeconds
      };
    }

    const rawOpts = Array.isArray(q.options) ? q.options : [];
    const indexedOptions = rawOpts.map((opt, originalIdx) => ({ opt, originalIdx }));
    if (originalTest.shuffleOptions) {
      for (let i = indexedOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indexedOptions[i], indexedOptions[j]] = [indexedOptions[j], indexedOptions[i]];
      }
    }
    const newCorrectIdx = originalTest.shuffleOptions
      ? indexedOptions.findIndex(o => o.originalIdx === q.correct)
      : q.correct;
    return {
      id: q.id,
      text: q.text,
      type: 'single',
      imageUrl,
      images,
      options: indexedOptions.map(o => o.opt),
      correct: newCorrectIdx >= 0 ? newCorrectIdx : 0,
      timeLimitSeconds: q.timeLimitSeconds
    };
  });

  if (originalTest.shuffleQuestions) {
    for (let i = randomizedQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [randomizedQuestions[i], randomizedQuestions[j]] = [randomizedQuestions[j], randomizedQuestions[i]];
    }
  }

  return randomizedQuestions;
}

export function computeFinalVerdict(session, sessionIncidents) {
  const incidents = Array.isArray(sessionIncidents) ? sessionIncidents : [];
  const cheatingIncidents = incidents.filter(i => i.category === 'cheating_attempt' || i.category === 'focus_loss' || i.category === 'devtools_opened');
  const networkIncidents = incidents.filter(i => i.category === 'network_issue');

  const splitScreenViolation = incidents.some(i => i.type === 'split_screen_fatal_violation');
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

export function evaluateTestSubmission(session, test, submission, sessionIncidents) {
  const questions = (session.questions && session.questions.length > 0) ? session.questions : (test ? test.questions : []);
  const hasSplitScreen = (sessionIncidents || []).some(i => i.type === 'split_screen_fatal_violation');

  if (hasSplitScreen) {
    return {
      status: 'disqualified',
      submittedAt: Date.now(),
      answers: {},
      questionTimings: submission.questionTimings || {},
      rawScore: 0,
      totalQuestions: questions.length,
      scorePercentage: 0,
      score12: 1,
      trustScore: 0,
      finalVerdict: {
        decision: 'ANNULLED_SPLIT_SCREEN',
        reason: 'Тест анульовано за недоброчесність: розділення екрана (Split Screen) не було вимкнено протягом 10 секунд!',
        cheatingCount: sessionIncidents.filter(i => i.category === 'cheating_attempt' || i.category === 'devtools_opened').length,
        networkCount: sessionIncidents.filter(i => i.category === 'network_issue').length
      }
    };
  }

  let correctCount = 0;
  const gradedAnswers = {};

  questions.forEach((q) => {
    const userAnswer = submission.answers ? submission.answers[q.id] : undefined;
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
    } else if (q.type === 'short_answer') {
      if (q.useAiGrading) {
        earnedPoints = 0;
        isCorrect = false;
      } else {
        const userText = String(userAnswer || '').trim().toLowerCase();
        const validList = Array.isArray(q.correctKeywords) && q.correctKeywords.length > 0
          ? q.correctKeywords.map(k => String(k).trim().toLowerCase())
          : String(q.correct || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (userText && validList.includes(userText)) {
          isCorrect = true;
          earnedPoints = 1;
        }
      }
    } else if (q.type === 'numeric') {
      const targetVal = parseNumericInput(q.correct);
      const tolerance = q.numericToleranceEnabled === false
        ? 0
        : Math.max(0, Math.abs(parseNumericInput(q.numericTolerance) ?? 0));
      const studentVal = parseNumericInput(userAnswer);
      if (studentVal !== null && targetVal !== null && Math.abs(studentVal - targetVal) <= tolerance + 1e-9) {
        isCorrect = true;
        earnedPoints = 1;
      }
    } else if (q.type === 'fill_blanks') {
      const blanks = Array.isArray(q.blanks) ? q.blanks : [];
      if (blanks.length > 0 && typeof userAnswer === 'object' && userAnswer !== null) {
        let matchedBlanks = 0;
        blanks.forEach((b, bIdx) => {
          const uVal = String(userAnswer[bIdx] || '').trim().toLowerCase();
          const targets = Array.isArray(b.answers) ? b.answers.map(s => String(s).trim().toLowerCase()) : [String(b.answer || '').trim().toLowerCase()];
          if (targets.includes(uVal)) matchedBlanks++;
        });
        earnedPoints = matchedBlanks / blanks.length;
        if (earnedPoints >= 0.99) isCorrect = true;
      }
    } else if (q.type === 'hotspot') {
      if (userAnswer && typeof userAnswer === 'object' && q.hotspotTarget) {
        const dx = (Number(userAnswer.x) || 0) - (Number(q.hotspotTarget.x) || 0);
        const dy = (Number(userAnswer.y) || 0) - (Number(q.hotspotTarget.y) || 0);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rad = Number(q.hotspotTarget.radius) || 15;
        if (dist <= rad) {
          isCorrect = true;
          earnedPoints = 1;
        }
      }
    } else if (q.type === 'true_false') {
      if (userAnswer !== undefined && Number(userAnswer) === Number(q.correct)) {
        isCorrect = true;
        earnedPoints = 1;
      }
    } else {
      if (userAnswer !== undefined && Number(userAnswer) === Number(q.correct)) {
        isCorrect = true;
        earnedPoints = 1;
      }
    }

    correctCount += earnedPoints;
    const timeSpent = (submission.questionTimings && submission.questionTimings[q.id]) ? submission.questionTimings[q.id] : 0;
    const entry = {
      userAnswer,
      correctAnswer: q.correct,
      isCorrect,
      earnedPoints: Math.round(earnedPoints * 100) / 100,
      timeSpent,
      needsAiGrading: !!(q.type === 'short_answer' && q.useAiGrading)
    };
    if (q.type === 'numeric') {
      const tolVal = q.numericToleranceEnabled === false
        ? 0
        : Math.max(0, Math.abs(parseNumericInput(q.numericTolerance) ?? 0));
      entry.numericToleranceEnabled = tolVal > 0;
      entry.numericTolerance = tolVal;
    }
    gradedAnswers[q.id] = entry;
  });

  const totalQuestions = questions.length;
  const scorePercentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const score12 = calculate12Scale(correctCount, totalQuestions);
  const finalVerdict = computeFinalVerdict(session, sessionIncidents);

  return {
    status: 'completed',
    submittedAt: Date.now(),
    answers: gradedAnswers,
    questionTimings: submission.questionTimings || {},
    rawScore: correctCount,
    totalQuestions,
    scorePercentage,
    score12,
    trustScore: session.trustScore,
    finalVerdict
  };
}

export function buildLeaderboardList(allSessions, testsMap, testId = null) {
  const completed = allSessions.filter(s => s.status === 'completed' && (!testId || s.testId === testId));
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
    const test = testsMap[s.testId];
    return {
      rank: idx + 1,
      sessionId: s.id,
      testId: s.testId,
      testTitle: test ? test.title : 'Тест',
      studentName: s.studentName,
      studentId: s.studentId,
      avatar: s.avatar || generateDefaultAvatar(s.studentName),
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

export function buildTestAnalytics(test, allSessions, classId = '') {
  if (!test) return null;
  const allTestSessions = allSessions.filter(s => s.testId === test.id);
  const availableClasses = [...new Set(allTestSessions.map(s => s.studentId).filter(Boolean))].sort();
  let testSessions = allTestSessions;
  if (classId) {
    testSessions = testSessions.filter(s => s.studentId === classId || s.classId === classId);
  }
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
        if (typeof ansObj.userAnswer === 'number' && ansObj.userAnswer >= 0 && ansObj.userAnswer < optionCounts.length) {
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
      numericTolerance: q.numericTolerance,
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
    questionsAnalytics,
    availableClasses,
    selectedClass: classId || ''
  };
}

export class JsonFileDatabaseAdapter extends DatabaseAdapter {
  constructor(filePath = DATA_FILE) {
    super();
    this.filePath = filePath;
    this._persistQueue = Promise.resolve();
    this.data = {
      tests: {},
      sessions: {},
      incidents: [],
      pings: {},
      classes: {},
      supportTickets: []
    };
  }

  async init() {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
      if (!this.data.tests) this.data.tests = {};
      if (!this.data.sessions) this.data.sessions = {};
      if (!this.data.incidents) this.data.incidents = [];
      if (!this.data.pings) this.data.pings = {};
      if (!this.data.classes) this.data.classes = {};
      if (!this.data.supportTickets) this.data.supportTickets = [];
    } catch {
      await this.seedDefaultData();
      await this.persist();
    }
  }

  persist() {
    this._persistQueue = this._persistQueue.then(async () => {
      try {
        await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch (err) {
        console.error(err);
      }
    });
    return this._persistQueue;
  }

  async seedDefaultData() {
    this.data.tests['demo-test-1'] = buildDefaultDemoTest();
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

  async getLiteMode() {
    return !!this.data.liteMode;
  }

  async setLiteMode(val) {
    this.data.liteMode = !!val;
    await this.persist();
  }

  async createTest(testData) {
    const id = testData.id || generateSecureId('test_', 6);
    const newTest = {
      id,
      title: testData.title || 'Новий тест',
      durationMinutes: parseInt(testData.durationMinutes, 10) || 15,
      questions: Array.isArray(testData.questions) ? testData.questions : [],
      topic: testData.topic || '',
      subject: testData.subject || '',
      tags: Array.isArray(testData.tags) ? testData.tags : [],
      shuffleQuestions: !!testData.shuffleQuestions,
      shuffleOptions: !!testData.shuffleOptions
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
    const newQuestion = normalizeQuestionData(questionData);
    test.questions.push(newQuestion);
    await this.persist();
    return newQuestion;
  }

  async updateQuestion(testId, questionId, questionData) {
    const test = this.data.tests[testId];
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
      points: questionData.points !== undefined ? Math.max(1, parseInt(questionData.points, 10) || 1) : (current.points || 1),
      explanation: questionData.explanation !== undefined ? String(questionData.explanation || '').trim() : (current.explanation || ''),
      timeLimitSeconds: questionData.timeLimitSeconds !== undefined ? parseInt(questionData.timeLimitSeconds, 10) : current.timeLimitSeconds
    };
    if (type === 'numeric') {
      const targetNum = parseNumericInput(updated.correct);
      const tolSource = questionData.numericTolerance !== undefined ? questionData.numericTolerance : current.numericTolerance;
      updated.correct = targetNum !== null ? targetNum : 0;
      updated.numericTolerance = Math.max(0, Math.abs(parseNumericInput(tolSource) ?? 0));
    }
    test.questions[idx] = updated;
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
    const randomizedQuestions = buildSessionQuestions(originalTest);

    this.data.sessions[session.id] = {
      ...session,
      avatar: (session.avatar && session.avatar.value) ? session.avatar : generateDefaultAvatar(session.studentName),
      startedAt: Date.now(),
      status: 'in_progress',
      trustScore: 100,
      incidentsCount: 0,
      answers: {},
      questions: randomizedQuestions,
      isPaused: false,
      pauseMessage: '',
      pausedAt: null,
      totalPausedMs: 0,
      retakeAllowed: false,
      retakeUsed: false,
      attemptNumber: session.attemptNumber || 1,
      previousSessionId: session.previousSessionId || null,
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

  async findLatestFinishedSessionForStudent(testId, studentName, studentId) {
    const normName = String(studentName || '').trim().toLowerCase();
    const normId = String(studentId || '').trim().toLowerCase();
    const matches = Object.values(this.data.sessions).filter(s => {
      if (s.testId !== testId) return false;
      if (s.status !== 'completed' && s.status !== 'disqualified') return false;
      return String(s.studentName || '').trim().toLowerCase() === normName &&
        String(s.studentId || '').trim().toLowerCase() === normId;
    });
    matches.sort((a, b) => (b.submittedAt || b.startedAt || 0) - (a.submittedAt || a.startedAt || 0));
    return matches[0] || null;
  }

  async allowSessionRetake(sessionId) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    session.retakeAllowed = true;
    session.retakeUsed = false;
    session.retakeGrantedAt = Date.now();
    await this.persist();
    return session;
  }

  async consumeRetakePermission(sessionId) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    session.retakeAllowed = false;
    session.retakeUsed = true;
    await this.persist();
    return session;
  }

  async setSessionPaused(sessionId, paused, message = '') {
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    if (paused) {
      if (!session.isPaused) {
        session.isPaused = true;
        session.pausedAt = Date.now();
      }
      session.pauseMessage = (message || session.pauseMessage || 'Тестування тимчасово призупинено викладачем').trim();
    } else {
      if (session.isPaused && session.pausedAt) {
        session.totalPausedMs = (session.totalPausedMs || 0) + Math.max(0, Date.now() - session.pausedAt);
      }
      session.isPaused = false;
      session.pausedAt = null;
      session.pauseMessage = '';
    }
    await this.persist();
    return session;
  }

  async logIncident(sessionId, incident) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;

    const incidentRecord = {
      id: generateSecureId('inc_', 6),
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
    const sessionIncidents = this.data.incidents.filter(i => i.sessionId === session.id);
    const result = evaluateTestSubmission(session, test, submission, sessionIncidents);

    if (session.isPaused && session.pausedAt) {
      session.totalPausedMs = (session.totalPausedMs || 0) + Math.max(0, Date.now() - session.pausedAt);
    }
    session.isPaused = false;
    session.pausedAt = null;
    session.pauseMessage = '';
    session.status = result.status;
    session.submittedAt = result.submittedAt;
    session.answers = result.answers;
    session.questionTimings = result.questionTimings;
    session.rawScore = result.rawScore;
    session.totalQuestions = result.totalQuestions;
    session.scorePercentage = result.scorePercentage;
    session.score12 = result.score12;
    session.trustScore = result.trustScore;
    session.finalVerdict = result.finalVerdict;

    await this.persist();
    return session;
  }

  async updateAiGradedSession(sessionId, payload) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    if (payload.answers) session.answers = payload.answers;
    if (payload.rawScore !== undefined) session.rawScore = payload.rawScore;
    if (payload.scorePercentage !== undefined) session.scorePercentage = payload.scorePercentage;
    if (!session.score12ManualOverride) {
      session.score12 = calculate12Scale(session.rawScore || 0, session.totalQuestions || 0);
    }
    await this.persist();
    return session;
  }

  calculateFinalVerdict(session) {
    const sessionIncidents = this.data.incidents.filter(i => i.sessionId === session.id);
    return computeFinalVerdict(session, sessionIncidents);
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

  async adminOverrideScore(sessionId, newScore12) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    const s12 = Math.max(1, Math.min(12, Math.round(Number(newScore12))));
    session.score12 = s12;
    session.score12ManualOverride = true;
    await this.persist();
    return session;
  }

  async addSessionTime(sessionId, minutes) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    const addMins = parseInt(minutes, 10) || 5;
    session.extraTimeMinutes = (session.extraTimeMinutes || 0) + addMins;
    if (session.durationMinutes) {
      session.durationMinutes += addMins;
    }
    await this.persist();
    return session;
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

  async deleteSessionsByFilter(filter = {}) {
    const { classId, status } = filter;
    const toDeleteIds = [];
    Object.values(this.data.sessions).forEach(s => {
      let match = true;
      if (classId && s.studentId !== classId && s.classId !== classId) match = false;
      if (status) {
        if (status === 'incomplete' && (s.status === 'completed' || s.status === 'disqualified')) match = false;
        if (status === 'completed' && s.status !== 'completed') match = false;
        if (status === 'disqualified' && s.status !== 'disqualified') match = false;
      }
      if (match) toDeleteIds.push(s.id);
    });
    for (const sid of toDeleteIds) {
      delete this.data.sessions[sid];
      if (this.data.pings) delete this.data.pings[sid];
    }
    this.data.incidents = this.data.incidents.filter(i => !toDeleteIds.includes(i.sessionId));
    await this.persist();
    return toDeleteIds.length;
  }

  async getSessionIncidents(sessionId) {
    return this.data.incidents.filter(i => i.sessionId === sessionId);
  }

  async getSessionPings(sessionId) {
    return this.data.pings[sessionId] || [];
  }

  async getLeaderboard(testId = null) {
    return buildLeaderboardList(Object.values(this.data.sessions), this.data.tests, testId);
  }

  async getTestAnalytics(testId, classId = '') {
    return buildTestAnalytics(this.data.tests[testId], Object.values(this.data.sessions), classId);
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
    const id = generateSecureId('class_', 6);
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
      id: student.id || generateSecureId('std_', 6),
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

  async saveSupportTicket(ticket) {
    if (!this.data.supportTickets) this.data.supportTickets = [];
    this.data.supportTickets.unshift(ticket);
    await this.persist();
    return ticket;
  }

  async getSupportTickets() {
    return this.data.supportTickets || [];
  }

  async deleteSupportTicket(ticketId) {
    if (!this.data.supportTickets) return false;
    const initialLen = this.data.supportTickets.length;
    this.data.supportTickets = this.data.supportTickets.filter(t => t.id !== ticketId);
    if (this.data.supportTickets.length !== initialLen) {
      await this.persist();
      return true;
    }
    return false;
  }
}

class DatabaseFacade {
  constructor() {
    this.adapter = new JsonFileDatabaseAdapter();
  }

  async init() {
    const dbUrl = (process.env.DATABASE_URL || '').trim();
    if (dbUrl) {
      try {
        const pgModule = await import('pg');
        const Pool = pgModule.Pool || pgModule.default?.Pool;
        const { PostgresDatabaseAdapter } = await import('./db-adapters.js');
        const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl);
        const sslConfig = process.env.DATABASE_SSL === 'false'
          ? false
          : (isLocal && process.env.DATABASE_SSL !== 'true' ? false : { rejectUnauthorized: false });
        const pool = new Pool({
          connectionString: dbUrl,
          ssl: sslConfig,
          max: 10,
          idleTimeoutMillis: 30000
        });
        const pgAdapter = new PostgresDatabaseAdapter(pool);
        await pgAdapter.init();
        this.adapter = pgAdapter;
        return;
      } catch (err) {
        console.error('PostgreSQL init error:', err);
        throw err;
      }
    }
    this.adapter = new JsonFileDatabaseAdapter();
    await this.adapter.init();
  }
}

const facade = new DatabaseFacade();

export const db = new Proxy(facade, {
  get(target, prop) {
    if (prop === 'init') {
      return () => target.init();
    }
    const impl = target.adapter;
    const val = impl[prop];
    if (typeof val === 'function') {
      return val.bind(impl);
    }
    return val;
  }
});

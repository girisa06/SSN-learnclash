import { checkQuizAnswer, createChallenge as postChallenge, createQuiz as postQuiz, getChallenges as fetchChallenges, getStudentStats, submitChallengeScore, updateMastery } from "./api.js";

const DIFFICULTIES = ["easy", "medium", "hard"];
const POINTS = { easy: 1, medium: 2, hard: 3 };

function normalizeDifficulty(value) {
  const difficulty = String(value ?? "medium").toLowerCase();
  return DIFFICULTIES.includes(difficulty) ? difficulty : "medium";
}

function masteryForTopic(stats, topic) {
  if (typeof stats?.p_know === "number") return stats.p_know;
  const topics = stats?.mastery ?? stats?.topics ?? [];
  const match = Array.isArray(topics)
    ? topics.find((item) => item.topic === topic || item.name === topic)
    : topics?.[topic];
  const value = typeof match === "number" ? match : match?.p_know ?? match?.score;
  return Number.isFinite(value) ? value : null;
}

export function calculateNextDifficulty(pKnow) {
  if (pKnow === null || pKnow === undefined) return null;
  if (!Number.isFinite(pKnow)) return null;
  if (pKnow >= 0.75) return "hard";
  if (pKnow < 0.4) return "easy";
  return "medium";
}

function awardForStreak(streak) {
  if (streak >= 5) return 25;
  if (streak >= 2) return 15;
  return 10;
}

export function calculatePoints(difficulty, streak) {
  return {
    points: POINTS[normalizeDifficulty(difficulty)],
    xp: awardForStreak(Math.max(0, Number(streak) || 0)),
  };
}

export function getAvatarLevel(totalXp) {
  return Math.min(10, Math.floor(Math.max(0, totalXp) / 50) + 1);
}

export function getAnswerFeedback(session) {
  if (session.streak === 5) return { correct: true, points: session.lastPoints, combo: "5-Kill Streak!" };
  if (session.streak === 2) return { correct: true, points: session.lastPoints, combo: "2-Hit Combo!" };
  return { correct: session.lastCorrect, points: session.lastPoints, combo: null };
}

export function createQuizSession(quiz, { studentId, totalXp = 0, initialDifficulty = "medium" } = {}) {
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    throw new TypeError("A quiz must contain at least one question.");
  }
  return {
    quiz,
    studentId,
    totalXp,
    level: getAvatarLevel(totalXp),
    difficulty: normalizeDifficulty(initialDifficulty),
    streak: 0,
    bestStreak: 0,
    earnedPoints: 0,
    maxPoints: quiz.questions.reduce((sum, q) => sum + POINTS[normalizeDifficulty(q.difficulty)], 0),
    earnedXp: 0,
    answered: [],
    usedQuestionIds: new Set(),
    currentQuestion: null,
    lastCorrect: null,
    lastPoints: 0,
    masteryByTopic: {},
    finished: false,
  };
}

export function nextQuestion(session) {
  if (session.finished) return null;
  const remaining = session.quiz.questions.filter((question) =>
    !session.usedQuestionIds.has(question.id ?? session.quiz.questions.indexOf(question)));
  if (remaining.length === 0) return null;

  const wanted = session.difficulty;
  const exact = remaining.filter((question) => normalizeDifficulty(question.difficulty) === wanted);
  const pool = exact.length ? exact : remaining;
  const question = pool[0];
  session.usedQuestionIds.add(question.id ?? session.quiz.questions.indexOf(question));
  session.currentQuestion = question;
  return question;
}

export async function answerQuestion(session, optionIndex) {
  const question = session.currentQuestion;
  if (!question) throw new Error("Call nextQuestion() before answering.");
  if (session.studentId == null) throw new Error("A studentId is required to record mastery and adapt difficulty.");
  if (session.answered.some((answer) => answer.question === question)) {
    throw new Error("This question has already been answered.");
  }

  const verdict = await checkQuizAnswer(session.quiz.id, question.id, Number(optionIndex));
  const correct = verdict.correct;
  const topic = verdict.topic ?? question.topic ?? session.quiz.topic ?? session.quiz.subject ?? "General";
  const difficulty = normalizeDifficulty(question.difficulty);
  session.streak = correct ? session.streak + 1 : 0;
  session.bestStreak = Math.max(session.bestStreak, session.streak);
  const reward = correct ? calculatePoints(difficulty, session.streak) : { points: 0, xp: 0 };
  const { points, xp } = reward;
  session.earnedPoints += points;
  session.earnedXp += xp;
  session.totalXp += xp;
  session.level = getAvatarLevel(session.totalXp);
  session.lastCorrect = correct;
  session.lastPoints = points;
  session.answered.push({ question, optionIndex, correct, points, xp, topic });
  session.currentQuestion = null;

  await updateMastery(session.studentId, topic, correct);
  const stats = await getStudentStats(session.studentId);
  const pKnow = masteryForTopic(stats, topic);
  if (pKnow !== null) {
    session.masteryByTopic[topic] = pKnow;
    session.difficulty = calculateNextDifficulty(pKnow) ?? session.difficulty;
  }

  return {
    correct,
    topic,
    explanation: verdict.explanation ?? question.explanation ?? null,
    points,
    xp,
    streak: session.streak,
    combo: getAnswerFeedback(session).combo,
    difficulty: session.difficulty,
    level: session.level,
  };
}

export function finishQuiz(session) {
  session.finished = true;
  const score = session.maxPoints === 0 ? 0 : Math.round((session.earnedPoints / session.maxPoints) * 100);
  return {
    quizId: session.quiz.id,
    score,
    earnedPoints: session.earnedPoints,
    maxPoints: session.maxPoints,
    earnedXp: session.earnedXp,
    totalXp: session.totalXp,
    level: session.level,
    bestStreak: session.bestStreak,
    answered: session.answered,
  };
}

export const createChallenge = (friendId, quizId, studentId) => postChallenge(friendId, quizId, studentId);
export const getChallenges = (studentId) => fetchChallenges(studentId);
export const finishChallenge = (challengeId, studentId, quizResult) =>
  submitChallengeScore(challengeId, quizResult.score, studentId);

export function validateQuiz(quiz) {
  const errors = [];
  if (!quiz || typeof quiz !== "object") return ["Quiz must be an object."];
  if (!quiz.title?.trim()) errors.push("Add a quiz title.");
  if (quiz.classroom_id == null && quiz.classroomId == null) errors.push("Choose a classroom for this quiz.");
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    errors.push("Add at least one question.");
    return errors;
  }
  if (quiz.questions.length < 5) errors.push("Add at least five questions.");
  quiz.questions.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    if (!question.q?.trim()) errors.push(`${label} needs question text.`);
    if (!Array.isArray(question.options) || question.options.length !== 4 || question.options.some((x) => !String(x).trim())) {
      errors.push(`${label} needs exactly four non-empty options.`);
    }
    if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer > 3) {
      errors.push(`${label} needs a correct option index from 0 to 3.`);
    }
    if (!DIFFICULTIES.includes(String(question.difficulty ?? "").toLowerCase())) {
      errors.push(`${label} has an unsupported difficulty.`);
    }
  });
  return errors;
}

export async function createValidatedQuiz(quiz) {
  const errors = validateQuiz(quiz);
  if (errors.length) {
    const error = new Error("Quiz is incomplete.");
    error.validationErrors = errors;
    throw error;
  }
  return postQuiz({
    ...quiz,
    classroom_id: quiz.classroom_id ?? quiz.classroomId,
    created_by_student_id: quiz.created_by_student_id ?? quiz.createdByStudentId,
    questions: quiz.questions.map((question) => ({
      ...question,
      topic: question.topic ?? quiz.subject ?? "General",
    })),
  });
}

export function rememberStudent(student = {}) {
  if (typeof localStorage === "undefined") return;
  const { studentId, classroomId, avatar, student_id, classroom_id } = student;
  localStorage.setItem("quizDuel.student", JSON.stringify({
    studentId: studentId ?? student_id,
    classroomId: classroomId ?? classroom_id,
    avatar,
  }));
}

export function getRememberedStudent() {
  if (typeof localStorage === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem("quizDuel.student") ?? "null");
  } catch {
    return null;
  }
}

export function calculateElo(rating, opponentRating, actualScore, kFactor = 32) {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  return Math.round(rating + kFactor * (actualScore - expected));
}

export function formatLeaderboard(entries = []) {
  return [...entries].sort((a, b) =>
    (b.level ?? 1) - (a.level ?? 1) || (b.xp ?? b.total_xp ?? 0) - (a.xp ?? a.total_xp ?? 0),
  );
}

export function formatBattleResult({ studentScore, opponentScore, studentRating = 1200, opponentRating = 1200 }) {
  const actualScore = studentScore > opponentScore ? 1 : studentScore < opponentScore ? 0 : 0.5;
  const rating = calculateElo(studentRating, opponentRating, actualScore);
  const opponentRatingAfter = calculateElo(opponentRating, studentRating, 1 - actualScore);
  return {
    studentScore,
    opponentScore,
    outcome: actualScore === 0.5 ? "draw" : actualScore === 1 ? "win" : "loss",
    ratingBefore: studentRating,
    ratingAfter: rating,
    ratingChange: rating - studentRating,
    opponentRatingBefore: opponentRating,
    opponentRatingAfter,
    opponentRatingChange: opponentRatingAfter - opponentRating,
  };
}

export function formatBotScore(studentScore, difficulty = "medium") {
  const ranges = { easy: [38, 62], medium: [53, 77], hard: [68, 92] };
  const [minimum, maximum] = ranges[normalizeDifficulty(difficulty)];
  const variation = Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
  return Math.max(0, Math.min(100, Math.round((studentScore * 0.55) + (variation * 0.45))));
}

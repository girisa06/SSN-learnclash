// Base URL pointing directly to your live Render backend
const BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? "https://gamified-quiz-887m.onrender.com").replace(/\/$/, "");

// Helper for JSON requests
async function jsonPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed (${res.status}): ${errText}`);
  }
  return res.json();
}

/* =========================================================================
   1. JOIN CLASSROOM: Handles both joinClass and joinClassroom
   ========================================================================= */
export const joinClassroom = async (code, name) => {
  return jsonPost("/api/classrooms/join", { code, name });
};

// ALIAS for your App.jsx:
export const joinClass = joinClassroom;


/* =========================================================================
   2. SUBMIT / MASTERY: Handles updateMastery, submitAnswer, and submitChallengeScore
   ========================================================================= */
// Member 3's function: submitAnswer(challengeId, studentId, score)
export const submitAnswer = async (challengeId, studentId, score) => {
  return jsonPost(`/api/challenges/${challengeId}/submit`, {
    student_id: studentId,
    score: score,
  });
};

// App.jsx BKT function: updateMastery(studentId, topic, isCorrect)
export const updateMastery = async (studentId, topic, isCorrect) => {
  return jsonPost("/api/mastery/update", {
    student_id: studentId,
    topic: topic,
    correct: Boolean(isCorrect),
  });
};

// ALIAS for challenge score submission:
export const submitChallengeScore = submitAnswer;


/* =========================================================================
   3. CREATE CHALLENGE: Handles parameter order variations
   ========================================================================= */
// Member 3's signature: (quizId, studentA, studentB)
export const createChallenge = async (quizId, studentAId, studentBId) => {
  return jsonPost("/api/challenges/create", {
    quiz_id: quizId,
    student_a_id: studentAId,
    student_b_id: studentBId,
  });
};


/* =========================================================================
   4. STATS: Handles both getStudentStats and fetchStudentStats
   ========================================================================= */
export const fetchStudentStats = async (studentId = 1) => {
  const res = await fetch(`${BASE_URL}/api/students/${studentId}/stats`);
  if (!res.ok) throw new Error(`Stats fetch failed (${res.status})`);
  return res.json();
};

// ALIAS for your App.jsx:
export const getStudentStats = fetchStudentStats;

/* =========================================================================
   5. READ + QUIZ + LEADERBOARD CALLS (used by game.js and the screens)
   Restored from the pre-b1aa1ec api.js; each one unwraps the backend's envelope.
   ========================================================================= */
async function jsonGet(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed (${res.status}): ${errText}`);
  }
  return res.json();
}

function rememberedClassroomId() {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const student = JSON.parse(localStorage.getItem("quizDuel.student") ?? "null");
    return student?.classroomId ?? student?.classroom_id;
  } catch {
    return undefined;
  }
}

export const createClassroom = (classroom = {}) => jsonPost("/api/classrooms/create", classroom);

export const getQuizzesByClass = async (classroomId) => {
  if (classroomId == null) throw new TypeError("classroomId is required to list quizzes.");
  const result = await jsonGet(`/api/classrooms/${encodeURIComponent(classroomId)}/quizzes`);
  return result.quizzes ?? result;
};
export const getQuizzes = (classroomId = rememberedClassroomId()) => getQuizzesByClass(classroomId);

// Returns the quiz with its questions merged in (answers are never included).
export const getQuiz = async (id) => {
  const result = await jsonGet(`/api/quizzes/${encodeURIComponent(id)}`);
  return { ...result.quiz, questions: result.questions ?? result.quiz?.questions ?? [] };
};

// Server-side grading: returns { correct, correct_answer, topic, explanation, ... }
export const checkQuizAnswer = (quizId, questionId, answerIndex) =>
  jsonPost(`/api/quizzes/${encodeURIComponent(quizId)}/answer`, {
    question_id: questionId,
    answer_index: answerIndex,
  });

export const createQuiz = (quiz) => jsonPost("/api/quizzes/create", quiz);

export const uploadPDF = async (file, metadata = {}) => {
  if (!(file instanceof Blob)) throw new TypeError("uploadPDF expects a File or Blob.");
  for (const key of ["classroom_id", "class_level", "subject", "chapter"]) {
    if (metadata[key] == null || metadata[key] === "") throw new TypeError(`uploadPDF requires ${key}.`);
  }
  const form = new FormData();
  form.append("file", file, file.name || "quiz-source.pdf");
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  // No Content-Type header: the browser sets the multipart boundary itself.
  const res = await fetch(`${BASE_URL}/api/quizzes/generate-from-pdf`, { method: "POST", body: form });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`POST /api/quizzes/generate-from-pdf failed (${res.status}): ${errText}`);
  }
  const result = await res.json();
  return { ...(await getQuiz(result.quiz_id)), generated_question_count: result.question_count };
};

export const getChallenges = async (studentId) => {
  const result = await jsonGet(`/api/challenges/${encodeURIComponent(studentId)}`);
  return result.challenges ?? result;
};

export const getLeaderboard = async (classroomId) => {
  const result = await jsonGet(`/api/leaderboard/${encodeURIComponent(classroomId)}`);
  return result.leaderboard ?? result;
};

export const getMastery = async (studentId) => {
  const stats = await fetchStudentStats(studentId);
  return stats.mastery ?? stats.topics ?? [];
};

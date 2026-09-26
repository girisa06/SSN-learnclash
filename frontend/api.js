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
export const createChallenge = async (arg1, arg2, arg3) => {
  // Checks if arg1 is friendId or quizId to prevent inverted arguments
  const isQuizFirst = typeof arg1 === "string" && arg1.startsWith("quiz");
  
  const payload = isQuizFirst
    ? { quiz_id: arg1, challenger_id: arg2, challenged_id: arg3 }
    : { challenged_id: arg1, quiz_id: arg2, challenger_id: arg3 };

  return jsonPost("/api/challenges/create", payload);
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
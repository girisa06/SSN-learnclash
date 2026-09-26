const API_BASE_URL = (
  import.meta.env?.VITE_API_BASE_URL ?? globalThis.process?.env?.VITE_API_BASE_URL ?? ""
).trim().replace(/\/+$/, "");

export class ApiRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ApiRequestError";
    Object.assign(this, details);
  }
}

function buildRequestUrl(path) {
  if (!API_BASE_URL) {
    throw new ApiRequestError("The quiz server URL is not configured.", {
      userMessage: "Quiz server configuration is missing. Set VITE_API_BASE_URL and restart the frontend.",
      method: undefined,
      url: undefined,
    });
  }

  try {
    return new URL(String(path).replace(/^\/+/, ""), `${API_BASE_URL}/`).toString();
  } catch (cause) {
    throw new ApiRequestError("The quiz server URL is invalid.", {
      userMessage: "Quiz server configuration is invalid. Check VITE_API_BASE_URL and restart the frontend.",
      cause,
    });
  }
}

async function request(path, { method = "GET", body, headers = {}, signal } = {}) {
  const url = buildRequestUrl(path);
  if (import.meta.env?.DEV) console.info(`[Quiz Duel API] ${method} ${url}`);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body instanceof FormData ? {} : body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    const aborted = cause?.name === "AbortError";
    const userMessage = aborted
      ? "The request was cancelled. Please try again."
      : "The quiz server is not responding. It may be waking up; wait a few seconds and retry. If this continues, check your connection and the backend CORS settings.";
    console.error(`[Quiz Duel API] ${method} ${url} could not be reached`, {
      baseUrl: API_BASE_URL,
      errorName: cause?.name,
      errorMessage: cause?.message,
      hint: aborted ? "Request was aborted." : "A browser network error can indicate Render cold start, offline access, DNS/TLS failure, or a CORS rejection; the browser does not expose which one.",
    });
    throw new ApiRequestError(userMessage, { userMessage, method, url, cause });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const waking = [502, 503, 504].includes(response.status);
    const userMessage = waking
      ? "The quiz server is waking up or temporarily unavailable. Wait a few seconds, then retry."
      : `The quiz server returned an error (${response.status}). Please retry.`;
    console.error(`[Quiz Duel API] ${method} ${url} returned HTTP ${response.status}`, {
      status: response.status,
      statusText: response.statusText,
      responseText: detail.slice(0, 2000),
    });
    throw new ApiRequestError(userMessage, {
      userMessage,
      method,
      url,
      status: response.status,
      responseText: detail,
    });
  }
  if (response.status === 204) return null;
  return response.json();
}

const jsonPost = (path, body) => request(path, { method: "POST", body });

function rememberedClassroomId() {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const student = JSON.parse(localStorage.getItem("quizDuel.student") ?? "null");
    return student?.classroomId ?? student?.classroom_id;
  } catch {
    return undefined;
  }
}

export const createClassroom = (classroom) => jsonPost("/api/classrooms/create", classroom);
export const joinClass = (code, name) => jsonPost("/api/classrooms/join", { code, name });
export const getQuizzes = (classroomId = rememberedClassroomId()) => getQuizzesByClass(classroomId);
export const getQuizzesByClass = async (classroomId) => {
  if (classroomId == null) throw new TypeError("classroomId is required to list quizzes.");
  const result = await request(`/api/classrooms/${encodeURIComponent(classroomId)}/quizzes`);
  return result.quizzes ?? result;
};
export const getQuiz = async (id) => {
  const result = await request(`/api/quizzes/${encodeURIComponent(id)}`);
  return { ...result.quiz, questions: result.questions ?? result.quiz?.questions ?? [] };
};
export const checkQuizAnswer = (quizId, questionId, answerIndex) =>
  jsonPost(`/api/quizzes/${encodeURIComponent(quizId)}/answer`, {
    question_id: questionId,
    answer_index: answerIndex,
  });
export const createQuiz = (quiz) => jsonPost("/api/quizzes/create", quiz);
export const uploadPDF = (file, metadata = {}) => {
  if (!(file instanceof Blob)) throw new TypeError("uploadPDF expects a File or Blob.");
  for (const key of ["classroom_id", "class_level", "subject", "chapter"]) {
    if (metadata[key] == null || metadata[key] === "") throw new TypeError(`uploadPDF requires ${key}.`);
  }
  const form = new FormData();
  form.append("file", file, file.name || "quiz-source.pdf");
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  return request("/api/quizzes/generate-from-pdf", { method: "POST", body: form }).then(async (result) => ({
    ...(await getQuiz(result.quiz_id)),
    generated_question_count: result.question_count,
  }));
};
export const createChallenge = (friendId, quizId, studentId) =>
  jsonPost("/api/challenges/create", {
    quiz_id: quizId,
    student_a_id: studentId,
    student_b_id: friendId,
  });
export const getChallenges = async (studentId) => {
  const result = await request(`/api/challenges/${encodeURIComponent(studentId)}`);
  return result.challenges ?? result;
};
export const submitChallengeScore = (challengeId, score, studentId) =>
  jsonPost(`/api/challenges/${encodeURIComponent(challengeId)}/submit`, {
    student_id: studentId,
    score,
  });
export const getLeaderboard = async (classroomId) => {
  const result = await request(`/api/leaderboard/${encodeURIComponent(classroomId)}`);
  return result.leaderboard ?? result;
};
export const updateMastery = (studentId, topic, correct) =>
  jsonPost("/api/mastery/update", { student_id: studentId, topic, correct: Boolean(correct) });
export const getStudentStats = (studentId) =>
  request(`/api/students/${encodeURIComponent(studentId)}/stats`);
export const getMastery = async (studentId) => {
  const stats = await getStudentStats(studentId);
  return stats.mastery ?? stats.topics ?? [];
};

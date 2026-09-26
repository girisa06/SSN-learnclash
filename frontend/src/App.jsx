import { useCallback, useEffect, useRef, useState } from "react";
import { getChallenges, getLeaderboard, getQuiz, getQuizzes, joinClass } from "./api.js";
import {
  answerQuestion,
  createChallenge,
  createQuizSession,
  finishChallenge,
  finishQuiz,
  getRememberedStudent,
  nextQuestion,
  rememberStudent,
} from "./game.js";
import GameMode from "./GameMode.jsx";
import PDFUpload from "./PDFUpload.jsx";

// Turns a raw fetch/API error into a message a player (or teammate) can act on.
function friendlyError(e) {
  const raw = e?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
    return { message: "Can't reach the quiz server.", detail: "Check that the backend is running and VITE_API_BASE_URL is correct." };
  }
  if (/\/answer failed \(404\)/.test(raw) && /Not Found/.test(raw) && !/Question not found/.test(raw)) {
    return { message: "The quiz server doesn't have the answer-checking route.", detail: "The backend is running old code. Restart it from SSN-learnclash/backend (or redeploy Render), then try again." };
  }
  if (/\(404\)/.test(raw) && /Classroom not found/.test(raw)) {
    return { message: "That class code doesn't exist.", detail: "Check the 4-character code with your teacher." };
  }
  return { message: raw };
}

/* ------------------------------------------------------- small pieces */
function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

function Loading({ text = "Loading..." }) {
  return <div className="loading"><Spinner /> {text}</div>;
}

// Inline, dismissible error. Accepts a raw Error/string or an already-friendly {message, detail}.
function ErrorMsg({ error, onDismiss }) {
  if (!error) return null;
  const { message, detail } = typeof error === "object" && "message" in error && !(error instanceof Error) ? error : friendlyError(error);
  return (
    <div className="error" role="alert">
      <div>
        <div>{message}</div>
        {detail && <div className="error-detail">{detail}</div>}
      </div>
      <button className="close" onClick={onDismiss} aria-label="Dismiss error">&times;</button>
    </div>
  );
}

/* ---------------------------------------------------------------- join */
function Join({ onJoined, onBack }) {
  const [code, setCode] = useState("8JUJ");
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await joinClass(code.trim().toUpperCase(), name.trim());
      const student = { studentId: res.student_id, classroomId: res.classroom_id, name: name.trim() };
      rememberStudent(student);
      localStorage.setItem("quizDuel.name", student.name);
      onJoined(student);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>Join a classroom</h2>
      <ErrorMsg error={error} onDismiss={() => setError(null)} />
      <div className="field">
        <label htmlFor="code">Class code</label>
        <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={4} required autoCapitalize="characters" />
      </div>
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Arjun" required />
      </div>
      <button className="btn btn-block" disabled={busy || !name.trim()}>
        {busy && <Spinner />} {busy ? "Joining..." : "Join Game"}
      </button>
      <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 10 }} onClick={onBack}>Back</button>
    </form>
  );
}

/* ---------------------------------------------------------------- play */
// challenge (optional): { id, ... } -> the score is submitted to that challenge when the quiz ends.
function Play({ student, quizId, challenge, onExit }) {
  const sessionRef = useRef(null);
  const [question, setQuestion] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [result, setResult] = useState(null);
  const [duel, setDuel] = useState(null);
  const [friendId, setFriendId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [, rerender] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getQuiz(quizId)
      .then((quiz) => {
        if (cancelled) return;
        sessionRef.current = createQuizSession(quiz, { studentId: student.studentId });
        setQuestion(nextQuestion(sessionRef.current));
      })
      .catch((e) => !cancelled && setError(friendlyError(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [quizId, student.studentId]);

  const pick = async (index) => {
    setBusy(true);
    setError(null);
    try {
      setFeedback({ ...(await answerQuestion(sessionRef.current, index)), picked: index });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const advance = async () => {
    const q = nextQuestion(sessionRef.current);
    setFeedback(null);
    if (q) return setQuestion(q);
    const r = finishQuiz(sessionRef.current);
    setResult(r);
    setQuestion(null);
    rerender((n) => n + 1);
    if (challenge) {
      setBusy(true);
      try {
        setDuel(await finishChallenge(challenge.id, student.studentId, r));
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(false);
      }
    }
  };

  const challengeFriend = async () => {
    setBusy(true);
    setError(null);
    try {
      const { challenge_id } = await createChallenge(Number(friendId), quizId, student.studentId);
      setDuel(await finishChallenge(challenge_id, student.studentId, result));
      setNote(`Challenge #${challenge_id} sent. Your friend plays it from "My challenges".`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const session = sessionRef.current;
  const total = session?.quiz.questions.length ?? 0;
  const done = session?.answered.length ?? 0;

  return (
    <div className="card">
      <div className="card-title">
        <h3>{session?.quiz.title ?? "Quiz"}</h3>
        <button className="btn btn-secondary btn-small" onClick={onExit}>Back</button>
      </div>
      <ErrorMsg error={error} onDismiss={() => setError(null)} />
      {loading && <Loading text="Loading quiz..." />}

      {question && (
        <>
          <div className="muted">Question {Math.min(done + 1, total)} of {total} &middot; {question.difficulty}</div>
          <div className="progress"><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
          <div className="question">{question.q}</div>
          {question.options.map((opt, i) => {
            const picked = feedback && feedback.picked === i;
            const cls = picked ? (feedback.correct ? " right" : " wrong") : "";
            return (
              <button key={i} className={`option${cls}`} disabled={busy || !!feedback} onClick={() => pick(i)}>
                {opt}
              </button>
            );
          })}
          {busy && !feedback && <Loading text="Checking answer..." />}
          {feedback && (
            <>
              <div className={`notice${feedback.correct ? "" : " bad"}`}>
                <div>
                  <strong>{feedback.correct ? "Correct!" : "Not quite."}</strong> {feedback.explanation}
                  <div className="error-detail">+{feedback.points} pts, +{feedback.xp} XP &middot; streak {feedback.streak}{feedback.combo ? ` - ${feedback.combo}` : ""} &middot; next: {feedback.difficulty}</div>
                </div>
              </div>
              <button className="btn btn-block" onClick={advance}>Next Question</button>
            </>
          )}
        </>
      )}

      {result && (
        <>
          <h2>Quiz complete</h2>
          <p className="score">{result.score}<span className="muted"> / 100</span></p>
          <p className="muted">{result.earnedPoints}/{result.maxPoints} points &middot; best streak {result.bestStreak} &middot; {result.earnedXp} XP</p>
          {busy && <Loading text="Submitting your score..." />}
          {duel && (
            <div className="notice">
              {duel.status === "done"
                ? `Duel finished. ${duel.winner_id == null ? "It's a tie." : duel.winner_id === student.studentId ? "You won!" : "You lost."} Ratings: A ${duel.student_a_new_rating}, B ${duel.student_b_new_rating}`
                : "Score submitted. Waiting for your opponent to play."}
            </div>
          )}
          {note && <div className="notice">{note}</div>}
          {!challenge && !duel && (
            <div className="field">
              <label htmlFor="friend">Challenge a friend</label>
              <input id="friend" className="input" placeholder="Friend's student id" value={friendId} onChange={(e) => setFriendId(e.target.value)} inputMode="numeric" />
              <button className="btn btn-block" disabled={busy || !friendId} onClick={challengeFriend}>Challenge Friend</button>
            </div>
          )}
          <button className="btn btn-secondary btn-block" onClick={onExit}>Back to lobby</button>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- lobby */
function Lobby({ student, mode, onPlay, onLeave, onChangeMode }) {
  const [quizzes, setQuizzes] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [board, setBoard] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [q, c, b] = await Promise.all([
        getQuizzes(student.classroomId),
        getChallenges(student.studentId),
        getLeaderboard(student.classroomId),
      ]);
      setQuizzes(q);
      setChallenges(c);
      setBoard(b);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [student.classroomId, student.studentId]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="card profile">
        <div>
          <div className="profile-name">{student.name || "Student"}</div>
          <div className="muted">Student #{student.studentId} &middot; Class {student.classroomId} &middot; {mode === "pdf" ? "PDF mode" : "NCERT mode"}</div>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary btn-small" onClick={onChangeMode}>Change mode</button>
          <button className="btn btn-secondary btn-small" onClick={load} disabled={loading}>Refresh</button>
          <button className="btn btn-secondary btn-small" onClick={onLeave}>Leave</button>
        </div>
      </div>

      <ErrorMsg error={error} onDismiss={() => setError(null)} />

      {mode === "pdf" && (
        <PDFUpload
          classroomId={student.classroomId}
          onQuizGenerated={(quiz) => onPlay({ quizId: quiz.id })}
        />
      )}

      <div className="card">
        <h3>Quizzes</h3>
        {loading && quizzes.length === 0 && <Loading text="Loading quizzes..." />}
        {!loading && quizzes.length === 0 && <p className="muted">No quizzes yet.</p>}
        <div className="quiz-grid">
          {quizzes.map((q) => (
            <div className="quiz-card" key={q.id}>
              <h4>{q.title}</h4>
              <div><span className="tag">{q.subject ?? "General"}</span> <span className="muted">{q.question_count} questions</span></div>
              <button className="btn" onClick={() => onPlay({ quizId: q.id })}>Play Quiz</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>My challenges</h3>
        {loading && challenges.length === 0 && <Loading text="Loading challenges..." />}
        {!loading && challenges.length === 0 && <p className="muted">None yet. Finish a quiz and challenge a friend.</p>}
        <ul className="list">
          {challenges.map((c) => (
            <li key={c.id}>
              <div>
                <div><strong>vs {c.opponent_name}</strong> &middot; {c.quiz_title}</div>
                <div className="muted">
                  #{c.id} <span className={`status${c.status === "done" ? " done" : ""}`}>{c.status}</span>
                  {c.status === "done" ? ` ${c.my_score} - ${c.opponent_score}` : ""}
                </div>
              </div>
              {c.my_score == null && c.status !== "done" && (
                <button className="btn btn-small" onClick={() => onPlay({ quizId: c.quiz_id ?? quizIdFor(quizzes, c.quiz_title), challenge: c })}>Play Quiz</button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>Leaderboard</h3>
        {loading && board.length === 0 && <Loading text="Loading leaderboard..." />}
        {board.length > 0 && (
          <div className="table-scroll">
            <table className="leaderboard-table">
              <thead><tr><th>#</th><th>Name</th><th>Level</th><th>XP</th><th>Elo</th></tr></thead>
              <tbody>
                {board.map((s, i) => (
                  <tr key={s.id} className={s.id === student.studentId ? "me" : ""}>
                    <td>{i + 1}</td><td>{s.name}</td><td>{s.level}</td><td>{s.xp}</td><td>{s.rating}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && board.length === 0 && <p className="muted">No players yet.</p>}
      </div>
    </>
  );
}

// Fallback for servers that don't return quiz_id on challenges yet: match by title.
function quizIdFor(quizzes, title) {
  return quizzes.find((q) => q.title === title)?.id;
}

/* ----------------------------------------------------------------- app */
export default function App() {
  const [student, setStudent] = useState(() => {
    const saved = getRememberedStudent();
    return saved?.studentId != null ? { ...saved, name: localStorage.getItem("quizDuel.name") ?? "" } : null;
  });
  const [playing, setPlaying] = useState(null);
  // 'ncert' | 'pdf' | null. Flow: mode -> join -> lobby -> quiz.
  const [gameMode, setGameMode] = useState(() => {
    try { return localStorage.getItem("quizDuel.mode"); } catch { return null; }
  });

  const chooseMode = (mode) => {
    try { mode ? localStorage.setItem("quizDuel.mode", mode) : localStorage.removeItem("quizDuel.mode"); } catch { /* storage unavailable */ }
    setGameMode(mode);
  };

  const leave = () => {
    localStorage.removeItem("quizDuel.student");
    localStorage.removeItem("quizDuel.name");
    chooseMode(null);
    setPlaying(null);
    setStudent(null);
  };

  return (
    <>
      <h1>Quiz Duel</h1>
      {!gameMode && <GameMode onSelectMode={chooseMode} />}
      {gameMode && !student && <Join onJoined={setStudent} onBack={() => chooseMode(null)} />}
      {gameMode && student && !playing && (
        <Lobby student={student} mode={gameMode} onPlay={setPlaying} onLeave={leave} onChangeMode={() => chooseMode(null)} />
      )}
      {gameMode && student && playing && (
        <Play student={student} quizId={playing.quizId} challenge={playing.challenge} onExit={() => setPlaying(null)} />
      )}
    </>
  );
}

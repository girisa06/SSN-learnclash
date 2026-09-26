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

const errText = (e) => e?.message ?? String(e);

/* ---------------------------------------------------------------- join */
function Join({ onJoined }) {
  const [code, setCode] = useState("8JUJ");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await joinClass(code.trim().toUpperCase(), name.trim());
      const student = { studentId: res.student_id, classroomId: res.classroom_id, name: name.trim() };
      rememberStudent(student);
      localStorage.setItem("quizDuel.name", student.name);
      onJoined(student);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>Join a classroom</h2>
      <div className="row"><label>Class code</label><input value={code} onChange={(e) => setCode(e.target.value)} maxLength={4} required /></div>
      <div className="row"><label>Your name</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
      <button disabled={busy || !name.trim()}>{busy ? "Joining..." : "Join"}</button>
      {error && <div className="msg bad">{error}</div>}
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getQuiz(quizId)
      .then((quiz) => {
        if (cancelled) return;
        sessionRef.current = createQuizSession(quiz, { studentId: student.studentId });
        setQuestion(nextQuestion(sessionRef.current));
      })
      .catch((e) => setError(errText(e)));
    return () => { cancelled = true; };
  }, [quizId, student.studentId]);

  const pick = async (index) => {
    setBusy(true);
    setError("");
    try {
      setFeedback({ ...(await answerQuestion(sessionRef.current, index)), picked: index });
    } catch (e) {
      setError(errText(e));
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
    if (challenge) {
      try {
        setDuel(await finishChallenge(challenge.id, student.studentId, r));
      } catch (e) {
        setError(errText(e));
      }
    }
  };

  const challengeFriend = async () => {
    setBusy(true);
    setError("");
    try {
      const { challenge_id } = await createChallenge(Number(friendId), quizId, student.studentId);
      setDuel(await finishChallenge(challenge_id, student.studentId, result));
      setNote(`Challenge #${challenge_id} sent. Your friend plays it from "My challenges".`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <button onClick={onExit}>Back</button>
      {error && <div className="msg bad">{error}</div>}
      {!question && !result && !error && <p>Loading quiz...</p>}

      {question && (
        <>
          <h3>{question.q}</h3>
          <p className="muted">Difficulty: {question.difficulty}</p>
          {question.options.map((opt, i) => (
            <button
              key={i}
              className={`option${feedback && feedback.picked === i ? (feedback.correct ? " right" : "") : ""}`}
              disabled={busy || !!feedback}
              onClick={() => pick(i)}
            >
              {opt}
            </button>
          ))}
          {feedback && (
            <>
              <div className={`msg ${feedback.correct ? "ok" : "bad"}`}>
                {feedback.correct ? "Correct!" : "Not quite."} {feedback.explanation}
                <div className="muted">+{feedback.points} pts, +{feedback.xp} XP, streak {feedback.streak}{feedback.combo ? ` - ${feedback.combo}` : ""}; next difficulty: {feedback.difficulty}</div>
              </div>
              <button onClick={advance}>Next</button>
            </>
          )}
        </>
      )}

      {result && (
        <>
          <h3>Score: {result.score}/100</h3>
          <p className="muted">{result.earnedPoints}/{result.maxPoints} points, best streak {result.bestStreak}, {result.earnedXp} XP</p>
          {duel && (
            <div className="msg ok">
              {duel.status === "done"
                ? `Duel finished. ${duel.winner_id == null ? "It's a tie." : duel.winner_id === student.studentId ? "You won!" : "You lost."} Ratings: A ${duel.student_a_new_rating}, B ${duel.student_b_new_rating}`
                : "Score submitted. Waiting for your opponent to play."}
            </div>
          )}
          {note && <div className="msg ok">{note}</div>}
          {!challenge && !duel && (
            <div className="row">
              <input placeholder="Friend's student id" value={friendId} onChange={(e) => setFriendId(e.target.value)} inputMode="numeric" />
              <button disabled={busy || !friendId} onClick={challengeFriend}>Challenge friend</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- lobby */
function Lobby({ student, onPlay, onLeave }) {
  const [quizzes, setQuizzes] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [board, setBoard] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
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
      setError(errText(e));
    }
  }, [student.classroomId, student.studentId]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="card">
        <div className="row">
          <div><strong>{student.name || "Student"}</strong> <span className="muted">id {student.studentId} - class {student.classroomId}</span></div>
          <div><button onClick={load}>Refresh</button> <button onClick={onLeave}>Leave</button></div>
        </div>
        {error && <div className="msg bad">{error}</div>}
      </div>

      <div className="card">
        <h3>Quizzes</h3>
        {quizzes.length === 0 && <p className="muted">No quizzes yet.</p>}
        {quizzes.map((q) => (
          <div className="row" key={q.id}>
            <span>{q.title} <span className="muted">({q.subject ?? "General"}, {q.question_count} Qs)</span></span>
            <button onClick={() => onPlay({ quizId: q.id })}>Play</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>My challenges</h3>
        {challenges.length === 0 && <p className="muted">None yet. Finish a quiz and challenge a friend.</p>}
        {challenges.map((c) => (
          <div className="row" key={c.id}>
            <span>#{c.id} vs {c.opponent_name} - {c.quiz_title} <span className="muted">[{c.status}{c.status === "done" ? `, ${c.my_score}-${c.opponent_score}` : ""}]</span></span>
            {c.my_score == null && c.status !== "done" && (
              <button onClick={() => onPlay({ quizId: c.quiz_id ?? quizIdFor(quizzes, c.quiz_title), challenge: c })}>Play</button>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Leaderboard</h3>
        <table>
          <thead><tr><th>Name</th><th>Level</th><th>XP</th><th>Elo</th></tr></thead>
          <tbody>
            {board.map((s) => (<tr key={s.id}><td>{s.name} <span className="muted">#{s.id}</span></td><td>{s.level}</td><td>{s.xp}</td><td>{s.rating}</td></tr>))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// The challenges API returns the quiz title; map it back to a quiz id from the classroom's quiz list.
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

  const leave = () => {
    localStorage.removeItem("quizDuel.student");
    localStorage.removeItem("quizDuel.name");
    setPlaying(null);
    setStudent(null);
  };

  return (
    <>
      <h1>Quiz Duel</h1>
      {!student && <Join onJoined={setStudent} />}
      {student && !playing && <Lobby student={student} onPlay={setPlaying} onLeave={leave} />}
      {student && playing && (
        <Play student={student} quizId={playing.quizId} challenge={playing.challenge} onExit={() => setPlaying(null)} />
      )}
    </>
  );
}

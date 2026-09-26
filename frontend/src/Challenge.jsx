import { useEffect, useState } from "react";
import { createChallenge, getChallengeStatus, getLeaderboard, getQuizzes } from "./api.js";

const POLL_MS = 1000;

function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

/* --------------------------------------------------------- live status */
// Polls GET /api/challenges/{id}/status every second until the duel is "done", then shows the
// result from `student`'s point of view. Polling stops on unmount and never overlaps requests.
// embedded: rendered inside another card (e.g. the quiz result), so no outer card and no Back button.
export function DuelStatus({ challengeId, student, onBack, embedded = false }) {
  const [data, setData] = useState(null);
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let timer = null;

    const poll = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const next = await getChallengeStatus(challengeId);
        if (stopped) return;
        setData(next);
        setFailures(0);
        if (next.status === "done") {
          clearInterval(timer);
          stopped = true;
        }
      } catch {
        if (!stopped) setFailures((n) => n + 1);
      } finally {
        inFlight = false;
      }
    };

    poll();
    timer = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [challengeId]);

  const done = data?.status === "done";
  const isA = data ? data.student_a_id === student.studentId : true;
  const mine = data ? (isA ? data.student_a_score : data.student_b_score) : null;
  const theirs = data ? (isA ? data.student_b_score : data.student_a_score) : null;
  const myElo = data ? (isA ? data.student_a_elo : data.student_b_elo) : null;
  const theirElo = data ? (isA ? data.student_b_elo : data.student_a_elo) : null;
  const outcome = !done ? null : data.winner_id == null ? "It's a tie." : data.winner_id === student.studentId ? "You won!" : "You lost.";

  return (
    <div className={embedded ? "duel duel-embedded" : "card duel"}>
      <div className="card-title">
        <h3>{done ? "Challenge complete" : "Live challenge"} #{challengeId}</h3>
        {!done && <Spinner />}
      </div>

      {!data && failures === 0 && <div className="loading"><Spinner /> Loading challenge...</div>}
      {failures >= 3 && !done && <div className="error" role="alert"><div>Lost contact with the server. Retrying...</div></div>}

      {data && (
        <>
          <div className="duel-scores">
            <div className="duel-side">
              <div className="muted">You</div>
              <div className="duel-score">{mine ?? "-"}</div>
              <div className="muted">Elo {myElo}</div>
            </div>
            <div className="duel-vs">vs</div>
            <div className="duel-side">
              <div className="muted">Opponent</div>
              <div className="duel-score">{theirs ?? "-"}</div>
              <div className="muted">Elo {theirElo}</div>
            </div>
          </div>

          {done ? (
            <div className={`notice${data.winner_id != null && data.winner_id !== student.studentId ? " bad" : ""}`}>
              <strong>{outcome}</strong>&nbsp;Ratings updated.
            </div>
          ) : (
            <p className="hint">
              {mine == null
                ? "You haven't submitted a score yet."
                : theirs == null
                  ? "Waiting for your opponent to finish. This updates automatically every second."
                  : "Finishing up..."}
            </p>
          )}
        </>
      )}

      {!embedded && <button className="btn btn-secondary btn-block" onClick={onBack}>Back to lobby</button>}
    </div>
  );
}

/* ------------------------------------------------------ create a duel */
// Pick a quiz and a classmate, create the challenge, then hand off to onStart({ quizId, challenge })
// so the challenger plays the quiz right away (their score is submitted when they finish).
export default function Challenge({ student, onStart, onBack }) {
  const [quizzes, setQuizzes] = useState([]);
  const [classmates, setClassmates] = useState([]);
  const [quizId, setQuizId] = useState("");
  const [friendId, setFriendId] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getQuizzes(student.classroomId), getLeaderboard(student.classroomId)])
      .then(([q, board]) => {
        if (cancelled) return;
        setQuizzes(q);
        setClassmates(board.filter((s) => s.id !== student.studentId));
        if (q.length) setQuizId(String(q[0].id));
      })
      .catch((e) => !cancelled && setError(e?.message ?? String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [student.classroomId, student.studentId]);

  const create = async (e) => {
    e.preventDefault();
    if (!quizId) return setError("Choose a quiz.");
    if (!friendId) return setError("Choose a friend to challenge.");
    setCreating(true);
    setError(null);
    try {
      const { challenge_id } = await createChallenge(Number(quizId), student.studentId, Number(friendId));
      onStart({ quizId: Number(quizId), challenge: { id: challenge_id } });
    } catch (err) {
      setError(err?.message ?? String(err));
      setCreating(false);
    }
  };

  return (
    <form className="card" onSubmit={create}>
      <h2>Challenge a Friend</h2>
      {error && (
        <div className="error" role="alert">
          <div>{error}</div>
          <button type="button" className="close" onClick={() => setError(null)} aria-label="Dismiss error">&times;</button>
        </div>
      )}
      {loading && <div className="loading"><Spinner /> Loading quizzes and classmates...</div>}

      {!loading && (
        <>
          <div className="field">
            <label htmlFor="ch-quiz">Quiz</label>
            <select id="ch-quiz" className="input" value={quizId} onChange={(e) => setQuizId(e.target.value)}>
              {quizzes.length === 0 && <option value="">No quizzes in this class</option>}
              {quizzes.map((q) => <option key={q.id} value={q.id}>{q.title} ({q.subject ?? "General"})</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="ch-friend">Friend</label>
            <select id="ch-friend" className="input" value={friendId} onChange={(e) => setFriendId(e.target.value)}>
              <option value="">{classmates.length ? "Select a classmate..." : "No classmates have joined yet"}</option>
              {classmates.map((s) => <option key={s.id} value={s.id}>{s.name} (#{s.id}, Elo {s.rating})</option>)}
            </select>
            <p className="hint">You play first; your friend plays the same quiz from their "My challenges" list.</p>
          </div>

          <button className="btn btn-block" disabled={creating || !quizId || !friendId}>
            {creating && <Spinner />} {creating ? "Creating..." : "Create Challenge & Play"}
          </button>
        </>
      )}

      <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 10 }} onClick={onBack}>Back</button>
    </form>
  );
}

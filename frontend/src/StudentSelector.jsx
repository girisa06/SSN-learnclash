import { useEffect, useState } from "react";
import { getClassroomStudents } from "./api.js";

// Browse every classmate (not just the top-10 leaderboard) and challenge one with a click.
// Your own row is left out; demo/test accounts are greyed out and can't be challenged.
// onChallenge(student) receives the whole student, so the caller uses student.id.
export default function StudentSelector({ classroomId, myId, busy = false, onChallenge }) {
  const [students, setStudents] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getClassroomStudents(classroomId)
      .then((list) => !cancelled && setStudents(list.filter((s) => s.id !== myId)))
      .catch((e) => !cancelled && setError(e?.message ?? String(e)));
    return () => { cancelled = true; };
  }, [classroomId, myId]);

  if (error) return <div className="error" role="alert"><div>Couldn't load classmates. {error}</div></div>;
  if (!students) return <div className="loading"><span className="spinner" role="status" aria-label="Loading" /> Loading classmates...</div>;
  if (students.length === 0) return <p className="hint">No classmates have joined yet. Share the class code so a friend can join.</p>;

  return (
    <ul className="student-grid" aria-label="Classmates">
      {students.map((s) => (
        <li key={s.id} className={`student-card${s.is_demo ? " demo" : ""}`}>
          <div className="student-avatar" aria-hidden="true">{s.avatar || "👤"}</div>
          <div className="student-info">
            <div className="student-name">{s.name}{s.is_demo && <span className="demo-tag"> (Demo)</span>}</div>
            <div className="muted">#{s.id} &middot; Lv {s.level} &middot; Elo {s.rating}</div>
          </div>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || s.is_demo}
            title={s.is_demo ? "Demo accounts can't play" : `Challenge ${s.name}`}
            onClick={() => onChallenge(s)}
          >
            Challenge ⚡
          </button>
        </li>
      ))}
    </ul>
  );
}

import { useState } from "react";

// Must match AVATAR_CHOICES in backend/main.py (the join route rejects anything else).
export const AVATARS = ["🎮", "💼", "🏢", "🦁", "🚀", "🍊"];

// Home screen: pick NCERT (pre-seeded quizzes) or PDF Upload (AI-generated quiz).
export default function GameMode({ onSelectMode }) {
  return (
    <>
      <p className="mode-intro">Pick your fighter and join the arena.</p>
      <div className="mode-list">
        <button type="button" className="mode-card mode-ncert" onClick={() => onSelectMode("ncert")}>
          <h3>📚 NCERT Quiz</h3>
          <p>Play curated quizzes from NCERT (Biology, Physics, 9th-10th grade)</p>
        </button>

        <button type="button" className="mode-card mode-pdf" onClick={() => onSelectMode("pdf")}>
          <h3>📄 Upload PDF</h3>
          <p>Upload any PDF and AI generates quiz questions automatically</p>
        </button>
      </div>
    </>
  );
}

// 3-step onboarding: avatar, display name, class code. The parent does the API call
// (onJoin(code, name, avatar)) and passes any error element and the busy flag back in.
export function JoinArena({ mode, defaultCode = "8JUJ", busy, error, onJoin, onBack }) {
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [name, setName] = useState("");
  const [code, setCode] = useState(defaultCode);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onJoin(code.trim().toUpperCase(), name.trim(), avatar);
  };

  return (
    <form className="card" onSubmit={submit}>
      <p className="tagline" style={{ textAlign: "center" }}>Enter the arena</p>
      <h2 style={{ textAlign: "center" }}>Set Up Your Fighter</h2>
      {error}

      <div className="step-title"><span className="step-number">1</span> Choose Your Avatar</div>
      <div className="avatar-grid" role="radiogroup" aria-label="Avatar">
        {AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={avatar === a}
            className={`avatar-option${avatar === a ? " selected" : ""}`}
            onClick={() => setAvatar(a)}
            disabled={busy}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="step-title"><span className="step-number">2</span> Set Your Display Name</div>
      <div className="field">
        <label htmlFor="name" className="hint">Display name</label>
        <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MasterCoder" disabled={busy} required />
      </div>

      <div className="step-title"><span className="step-number">3</span> Enter Class Code (4 Letters)</div>
      <div className="field">
        <label htmlFor="code" className="hint">Class code</label>
        <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} placeholder="e.g. 8JUJ" autoCapitalize="characters" disabled={busy} required />
      </div>

      <button className="btn btn-block" disabled={busy || !name.trim()}>
        {busy && <span className="spinner" role="status" aria-label="Loading" />}
        {busy ? "Entering Arena..." : "⚔️ Enter Arena"}
      </button>
      <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 10 }} onClick={onBack}>← Change Mode</button>
      <p className="hint" style={{ textAlign: "center", margin: "16px 0 0" }}>
        Mode: {mode === "pdf" ? "📄 PDF Upload" : "📚 NCERT"}. Play friends in duels, earn XP and climb the leaderboard!
      </p>
    </form>
  );
}

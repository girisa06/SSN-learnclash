// Home screen: pick NCERT (pre-seeded quizzes) or PDF Upload (AI-generated quiz).
export default function GameMode({ onSelectMode }) {
  return (
    <div className="mode-list">
      <h2>Choose Your Game Mode</h2>

      <button type="button" className="mode-card mode-ncert" onClick={() => onSelectMode("ncert")}>
        <h3>📚 NCERT Quiz</h3>
        <p>Play curated quizzes from NCERT (Biology, Physics, 9th-10th grade)</p>
      </button>

      <button type="button" className="mode-card mode-pdf" onClick={() => onSelectMode("pdf")}>
        <h3>📄 Upload PDF</h3>
        <p>Upload any PDF and AI generates quiz questions automatically</p>
      </button>
    </div>
  );
}

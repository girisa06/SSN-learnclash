import { useState } from "react";
import { uploadPDF } from "./api.js";

// Uploads a PDF to POST /api/quizzes/generate-from-pdf (via api.js, so VITE_API_BASE_URL applies)
// and hands the generated quiz to onQuizGenerated. classroomId is the joined student's class.
export default function PDFUpload({ classroomId, onQuizGenerated }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ classLevel: "9", subject: "Physics", chapter: "Motion" });

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return setError("Please select a PDF file.");
    if (!form.subject.trim() || !form.chapter.trim()) return setError("Subject and chapter are required.");

    setLoading(true);
    setError(null);
    try {
      const quiz = await uploadPDF(file, {
        classroom_id: classroomId,
        class_level: form.classLevel,
        subject: form.subject.trim(),
        chapter: form.chapter.trim(),
      });
      onQuizGenerated(quiz);
    } catch (err) {
      const raw = err?.message ?? String(err);
      setError(/Failed to fetch|NetworkError|Load failed/i.test(raw) ? "Can't reach the quiz server." : raw);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="card" onSubmit={handleUpload}>
      <h3>Upload PDF &amp; Generate Quiz</h3>

      {error && (
        <div className="error" role="alert">
          <div>{error}</div>
          <button type="button" className="close" onClick={() => setError(null)} aria-label="Dismiss error">&times;</button>
        </div>
      )}

      <div className="field">
        <label htmlFor="pdf-file">Select PDF File</label>
        <input id="pdf-file" className="input" type="file" accept=".pdf,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </div>

      <div className="field">
        <label htmlFor="pdf-level">Class Level</label>
        <select id="pdf-level" className="input" value={form.classLevel} onChange={set("classLevel")}>
          <option>9</option>
          <option>10</option>
          <option>11</option>
          <option>12</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="pdf-subject">Subject</label>
        <input id="pdf-subject" className="input" value={form.subject} onChange={set("subject")} placeholder="e.g., Physics, Biology" />
      </div>

      <div className="field">
        <label htmlFor="pdf-chapter">Chapter</label>
        <input id="pdf-chapter" className="input" value={form.chapter} onChange={set("chapter")} placeholder="e.g., Ch 9: Motion" />
      </div>

      <button className="btn btn-success btn-block" disabled={loading}>
        {loading && <span className="spinner" role="status" aria-label="Loading" />}
        {loading ? "Generating quiz..." : "Generate Quiz"}
      </button>
      {loading && <p className="hint">The AI is reading your PDF. This can take up to a minute.</p>}
    </form>
  );
}

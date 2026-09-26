import io
import json
import logging
import os
import random
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from sqlalchemy import or_
from sqlalchemy.orm import Session

from bkt import update_elo, update_mastery
from database import Base, engine, ensure_columns, get_db
import models  # noqa: F401  (registers models on Base before create_all)
from models import Challenge, Classroom, Mastery, Question, Quiz, StudentProfile

logger = logging.getLogger("quizduel")

app = FastAPI(title="Quiz Duel API")

# Let the browser frontend (any origin) call the API. Registered before any route.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev/hackathon mode
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_DIFFICULTIES = {"easy", "medium", "hard"}
AVATAR_CHOICES = ["🐉", "🤖", "🧙", "🦁", "🚀", "⚡"]
WIN_XP = 10
XP_PER_LEVEL = 50
MAX_LEVEL = 10
LLM_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
MAX_PDF_CHARS = 20000  # keeps requests under Groq free-tier per-minute token limits


@app.on_event("startup")
def on_startup():
    if engine is not None:
        try:
            Base.metadata.create_all(bind=engine)
            ensure_columns(engine)
        except Exception as exc:  # pragma: no cover - startup diagnostics only
            print(f"[startup] Could not connect/create tables: {exc}")
    else:
        print("[startup] DATABASE_URL not set - skipping table creation")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request, exc):
    return JSONResponse(status_code=400, content={"detail": exc.errors()})


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- Request/response models ----------

class ClassroomCreateRequest(BaseModel):
    teacher_name: Optional[str] = None


class ClassroomCreateResponse(BaseModel):
    classroom_id: int
    code: str


class ClassroomJoinRequest(BaseModel):
    code: str
    name: str


class ClassroomJoinResponse(BaseModel):
    student_id: int
    classroom_id: int
    avatar_choices: List[str]


class QuizSummary(BaseModel):
    id: int
    title: str
    subject: Optional[str] = None
    question_count: int


class ClassroomQuizzesResponse(BaseModel):
    quizzes: List[QuizSummary]


class QuestionOut(BaseModel):
    id: int
    q: str
    options: List[str]
    difficulty: str
    explanation: Optional[str] = None


class QuizOut(BaseModel):
    id: int
    title: str
    subject: Optional[str] = None
    classroom_id: int


class QuizDetailResponse(BaseModel):
    quiz: QuizOut
    questions: List[QuestionOut]


class LeaderboardEntry(BaseModel):
    id: int
    name: str
    avatar: Optional[str] = None
    level: int
    current_streak: int
    xp: int
    rating: int  # Elo


class LeaderboardResponse(BaseModel):
    leaderboard: List[LeaderboardEntry]


class QuestionIn(BaseModel):
    q: str
    options: List[str]
    answer: int
    difficulty: str
    explanation: Optional[str] = None


class QuizCreateRequest(BaseModel):
    classroom_id: int
    title: str
    subject: Optional[str] = None
    created_by_student_id: Optional[int] = None
    questions: List[QuestionIn]


class QuizCreateResponse(BaseModel):
    quiz_id: int


# ---------- Helpers ----------

def generate_code(db: Session) -> str:
    """Generate a unique 4-char classroom code (A-Z, 0-9), retrying on collision."""
    charset = string.ascii_uppercase + string.digits
    for _ in range(20):
        code = "".join(random.choices(charset, k=4))
        if not db.query(Classroom).filter(Classroom.code == code).first():
            return code
    raise HTTPException(status_code=500, detail="Could not generate a unique classroom code")


def validate_quiz_payload(payload: QuizCreateRequest) -> None:
    """Enforce min 5 questions, valid difficulty tier, and an in-range answer index."""
    if len(payload.questions) < 5:
        raise HTTPException(status_code=400, detail="Quiz must have at least 5 questions")
    for i, q in enumerate(payload.questions):
        if not q.q or not q.options:
            raise HTTPException(status_code=400, detail=f"Question {i} is missing q or options")
        if q.difficulty not in VALID_DIFFICULTIES:
            raise HTTPException(
                status_code=400,
                detail=f"Question {i} has invalid difficulty '{q.difficulty}' (must be easy/medium/hard)",
            )
        if not (0 <= q.answer <= 3) or q.answer >= len(q.options):
            raise HTTPException(
                status_code=400, detail=f"Question {i} has an invalid answer index: {q.answer}"
            )


# ---------- Routes ----------

@app.post("/api/classrooms/create", response_model=ClassroomCreateResponse)
def create_classroom(payload: ClassroomCreateRequest, db: Session = Depends(get_db)):
    """Create a classroom with a unique 4-char join code."""
    try:
        code = generate_code(db)
        classroom = Classroom(code=code)
        db.add(classroom)
        db.commit()
        db.refresh(classroom)
        return {"classroom_id": classroom.id, "code": classroom.code}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/classrooms/join", response_model=ClassroomJoinResponse)
def join_classroom(payload: ClassroomJoinRequest, db: Session = Depends(get_db)):
    """Join a classroom by code and create a fresh StudentProfile."""
    try:
        classroom = db.query(Classroom).filter(Classroom.code == payload.code).first()
        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found")

        student = StudentProfile(
            classroom_id=classroom.id,
            name=payload.name,
            avatar=None,
            level=1,
            xp=0,
            current_streak=0,
            wins=0,
        )
        db.add(student)
        db.commit()
        db.refresh(student)

        return {
            "student_id": student.id,
            "classroom_id": classroom.id,
            "avatar_choices": AVATAR_CHOICES,
        }
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/classrooms/{classroom_id}/quizzes", response_model=ClassroomQuizzesResponse)
def get_classroom_quizzes(classroom_id: int, db: Session = Depends(get_db)):
    """List quizzes belonging to a classroom, with live question counts."""
    try:
        quizzes = db.query(Quiz).filter(Quiz.classroom_id == classroom_id).all()
        return {
            "quizzes": [
                {
                    "id": quiz.id,
                    "title": quiz.title,
                    "subject": quiz.subject,
                    "question_count": len(quiz.questions),
                }
                for quiz in quizzes
            ]
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/quizzes/{quiz_id}", response_model=QuizDetailResponse)
def get_quiz(quiz_id: int, db: Session = Depends(get_db)):
    """Fetch a quiz with its questions. Answer indices are withheld here."""
    try:
        quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
        if not quiz:
            raise HTTPException(status_code=404, detail="Quiz not found")

        return {
            "quiz": {
                "id": quiz.id,
                "title": quiz.title,
                "subject": quiz.subject,
                "classroom_id": quiz.classroom_id,
            },
            "questions": [
                {
                    "id": question.id,
                    "q": question.q_text,
                    "options": question.options,
                    "difficulty": question.difficulty,
                    "explanation": question.explanation,
                }
                for question in quiz.questions
            ],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/leaderboard/{classroom_id}", response_model=LeaderboardResponse)
def get_leaderboard(classroom_id: int, db: Session = Depends(get_db)):
    """Top 10 students in a classroom, sorted by level DESC then xp DESC."""
    try:
        students = (
            db.query(StudentProfile)
            .filter(StudentProfile.classroom_id == classroom_id)
            .order_by(StudentProfile.level.desc(), StudentProfile.xp.desc())
            .limit(10)
            .all()
        )
        return {
            "leaderboard": [
                {
                    "id": student.id,
                    "name": student.name,
                    "avatar": student.avatar,
                    "level": student.level,
                    "current_streak": student.current_streak,
                    "xp": student.xp,
                    "rating": student.rating,
                }
                for student in students
            ]
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/quizzes/create", response_model=QuizCreateResponse)
def create_quiz(payload: QuizCreateRequest, db: Session = Depends(get_db)):
    """Create a quiz and its questions (used by seed_demo.py and quiz creators)."""
    validate_quiz_payload(payload)
    try:
        classroom = db.query(Classroom).filter(Classroom.id == payload.classroom_id).first()
        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found")

        quiz = Quiz(
            classroom_id=payload.classroom_id,
            title=payload.title,
            subject=payload.subject,
            created_by_student_id=payload.created_by_student_id,
        )
        db.add(quiz)
        db.flush()  # assign quiz.id without committing yet

        for q in payload.questions:
            db.add(
                Question(
                    quiz_id=quiz.id,
                    q_text=q.q,
                    options=q.options,
                    answer_index=q.answer,
                    difficulty=q.difficulty,
                    explanation=q.explanation,
                )
            )

        db.commit()
        db.refresh(quiz)
        return {"quiz_id": quiz.id}
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


# ======================================================================
# Phase 3 + pivot: challenges, Elo, mastery (BKT), PDF quiz generation
# ======================================================================

class ChallengeCreateRequest(BaseModel):
    quiz_id: int
    student_a_id: int
    student_b_id: int


class ChallengeCreateResponse(BaseModel):
    challenge_id: int


class ChallengeSummary(BaseModel):
    id: int
    quiz_title: str
    opponent_name: str
    opponent_id: int
    status: str
    my_score: Optional[int] = None
    opponent_score: Optional[int] = None
    winner_id: Optional[int] = None


class ChallengeListResponse(BaseModel):
    challenges: List[ChallengeSummary]


class ChallengeSubmitRequest(BaseModel):
    student_id: int
    score: int


class ChallengeSubmitResponse(BaseModel):
    status: str  # "waiting_for_a"/"waiting_for_b" (first submission) or "done"
    winner_id: Optional[int] = None  # null on tie or while still waiting
    xp_earned: int
    level_up: bool
    new_level: Optional[int] = None  # only set when the winner levelled up
    student_a_new_rating: int
    student_b_new_rating: int


class MasteryUpdateRequest(BaseModel):
    student_id: int
    topic: str
    correct: bool


class MasteryOut(BaseModel):
    topic: str
    p_know: float


class StudentStatsResponse(BaseModel):
    student_id: int
    elo: int
    current_streak: int
    mastery: List[MasteryOut]


class PdfQuizResponse(BaseModel):
    quiz_id: int
    question_count: int


def level_for_xp(xp: int) -> int:
    """Level 1 at 0 XP, +1 level per XP_PER_LEVEL, capped at MAX_LEVEL."""
    return min(xp // XP_PER_LEVEL + 1, MAX_LEVEL)


def get_or_404(db: Session, model, obj_id: int, label: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return obj


@app.post("/api/challenges/create", response_model=ChallengeCreateResponse)
def create_challenge(payload: ChallengeCreateRequest, db: Session = Depends(get_db)):
    """Student A challenges Student B to a quiz."""
    if payload.student_a_id == payload.student_b_id:
        raise HTTPException(status_code=400, detail="Cannot challenge yourself")
    try:
        get_or_404(db, Quiz, payload.quiz_id, "Quiz")
        get_or_404(db, StudentProfile, payload.student_a_id, "Student A")
        get_or_404(db, StudentProfile, payload.student_b_id, "Student B")

        challenge = Challenge(
            quiz_id=payload.quiz_id,
            student_a_id=payload.student_a_id,
            student_b_id=payload.student_b_id,
            status="waiting_for_b",
        )
        db.add(challenge)
        db.commit()
        db.refresh(challenge)
        return {"challenge_id": challenge.id}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/challenges/{student_id}", response_model=ChallengeListResponse)
def get_student_challenges(student_id: int, db: Session = Depends(get_db)):
    """All challenges a student is part of, from that student's point of view."""
    try:
        challenges = (
            db.query(Challenge)
            .filter(or_(Challenge.student_a_id == student_id, Challenge.student_b_id == student_id))
            .order_by(Challenge.id.desc())
            .all()
        )
        result = []
        for c in challenges:
            is_a = c.student_a_id == student_id
            opponent_id = c.student_b_id if is_a else c.student_a_id
            opponent = db.get(StudentProfile, opponent_id)
            quiz = db.get(Quiz, c.quiz_id)
            result.append(
                {
                    "id": c.id,
                    "quiz_title": quiz.title if quiz else "",
                    "opponent_name": opponent.name if opponent else "",
                    "opponent_id": opponent_id,
                    "status": c.status,
                    "my_score": c.score_a if is_a else c.score_b,
                    "opponent_score": c.score_b if is_a else c.score_a,
                    "winner_id": c.winner_id,
                }
            )
        return {"challenges": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/challenges/{challenge_id}/submit", response_model=ChallengeSubmitResponse)
def submit_challenge(challenge_id: int, payload: ChallengeSubmitRequest, db: Session = Depends(get_db)):
    """Record a score; once both are in, decide the winner, award XP/level, and update Elo."""
    if not 0 <= payload.score <= 100:
        raise HTTPException(status_code=400, detail="Score must be between 0 and 100")
    try:
        # Lock the challenge row so two simultaneous submits are serialized: the second waits for
        # the first to commit, then sees its score and completes the challenge.
        challenge = (
            db.query(Challenge)
            .filter(Challenge.id == challenge_id)
            .with_for_update()
            .first()
        )
        if challenge is None:
            raise HTTPException(status_code=404, detail="Challenge not found")
        if challenge.status == "done":
            raise HTTPException(status_code=400, detail="Challenge already completed")

        if payload.student_id == challenge.student_a_id:
            if challenge.score_a is not None:
                raise HTTPException(status_code=400, detail="Score already submitted")
            challenge.score_a = payload.score
        elif payload.student_id == challenge.student_b_id:
            if challenge.score_b is not None:
                raise HTTPException(status_code=400, detail="Score already submitted")
            challenge.score_b = payload.score
        else:
            raise HTTPException(status_code=400, detail="Student is not part of this challenge")

        # Lock BOTH students in id order (a consistent order prevents circular deadlocks) so
        # concurrent challenges involving the same student can't lose an XP/Elo update.
        locked_students = (
            db.query(StudentProfile)
            .filter(StudentProfile.id.in_([challenge.student_a_id, challenge.student_b_id]))
            .order_by(StudentProfile.id)
            .with_for_update()
            .all()
        )
        students_by_id = {s.id: s for s in locked_students}
        student_a = students_by_id.get(challenge.student_a_id)
        student_b = students_by_id.get(challenge.student_b_id)
        if not student_a or not student_b:
            raise HTTPException(status_code=400, detail="One or both students not found")

        # First submission: store it and wait for the opponent.
        if challenge.score_a is None or challenge.score_b is None:
            challenge.status = "waiting_for_a" if challenge.score_a is None else "waiting_for_b"
            db.commit()
            return {
                "status": challenge.status,
                "winner_id": None,
                "xp_earned": 0,
                "level_up": False,
                "new_level": None,
                "student_a_new_rating": student_a.rating,
                "student_b_new_rating": student_b.rating,
            }

        # Both scores in: decide winner (equal scores = tie, no winner).
        if challenge.score_a > challenge.score_b:
            winner, actual_a, actual_b = student_a, 1, 0
        elif challenge.score_b > challenge.score_a:
            winner, actual_a, actual_b = student_b, 0, 1
        else:
            winner, actual_a, actual_b = None, 0.5, 0.5

        xp_earned, level_up, new_level = 0, False, None
        if winner is not None:
            winner.xp += WIN_XP
            winner.wins += 1
            xp_earned = WIN_XP
            computed_level = level_for_xp(winner.xp)
            if computed_level > winner.level:
                winner.level = computed_level
                level_up, new_level = True, computed_level

        # Both Elo updates use the PRE-match ratings, so neither is skewed by the other.
        old_a, old_b = student_a.rating, student_b.rating
        student_a.rating = round(update_elo(old_a, old_b, actual_a))
        student_b.rating = round(update_elo(old_b, old_a, actual_b))

        challenge.winner_id = winner.id if winner else None
        challenge.status = "done"
        db.commit()
        return {
            "status": "done",
            "winner_id": challenge.winner_id,
            "xp_earned": xp_earned,
            "level_up": level_up,
            "new_level": new_level,
            "student_a_new_rating": student_a.rating,
            "student_b_new_rating": student_b.rating,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


def extract_pdf_text(data: bytes) -> str:
    """Extract text from PDF bytes; raises HTTPException(400) if unreadable or empty."""
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {exc}")
    if not text:
        raise HTTPException(status_code=400, detail="No extractable text in PDF (scanned image?)")
    return text[:MAX_PDF_CHARS]


def generate_questions_with_llm(pdf_text: str, class_level: str = "", subject: str = "", chapter: str = "") -> list:
    """Ask Groq for quiz questions and return them as a list of question dicts."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY not loaded from .env")
    # Only length + 4-char prefix are ever reported, never the key body.
    if not api_key.startswith("gsk_"):
        raise RuntimeError(
            f"GROQ_API_KEY has the wrong format: expected 'gsk_...', got {len(api_key)} chars "
            f"starting with {api_key[:4]!r}. Create a key at console.groq.com."
        )
    from groq import Groq

    # JSON mode must return an object (not a bare array), so questions are wrapped and unwrapped below.
    prompt = f"""Extract educational quiz questions from this text.

Class level: {class_level}
Subject: {subject}
Chapter: {chapter}

REQUIREMENTS:
- Return ONLY a valid JSON object (no markdown, no preamble)
- Format: {{"questions": [{{"q": "Question text?", "options": ["opt1", "opt2", "opt3", "opt4"], "answer": 0, "difficulty": "easy", "explanation": "Why this is correct", "topic": "topic_name"}}]}}
- Extract exactly 5 questions
- "options": exactly 4 plain strings, with no "A)" prefixes
- "answer": integer 0-3, the index of the correct option
- "difficulty": one of "easy", "medium", "hard"
- "topic": one word or short phrase (e.g. photosynthesis, force, inertia)

TEXT:
{pdf_text}"""

    client = Groq(api_key=api_key)
    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=2000,
    )
    raw = (response.choices[0].message.content or "").strip()
    if raw.startswith("```"):  # strip markdown fences if the model added them anyway
        raw = raw.strip("`").strip()
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()
    data = json.loads(raw)
    questions = data.get("questions") if isinstance(data, dict) else data
    if not isinstance(questions, list):
        raise ValueError("Groq response did not contain a questions list")
    logger.info("Groq generated %d questions", len(questions))
    return questions


@app.post("/api/quizzes/generate-from-pdf", response_model=PdfQuizResponse)
def generate_quiz_from_pdf(
    file: UploadFile = File(...),
    classroom_id: int = Form(...),
    class_level: str = Form(...),
    subject: str = Form(...),
    chapter: str = Form(...),
    db: Session = Depends(get_db),
):
    """Generate a quiz from an uploaded PDF chapter using Groq."""
    get_or_404(db, Classroom, classroom_id, "Classroom")
    text = extract_pdf_text(file.file.read())
    title = chapter or Path(file.filename or "Quiz").stem

    try:
        raw_questions = generate_questions_with_llm(text, class_level, subject, chapter)
        if not isinstance(raw_questions, list):
            raise ValueError("LLM response was not a JSON array")
        for q in raw_questions:
            if not isinstance(q.get("options"), list) or len(q["options"]) != 4:
                raise ValueError("Each question must have exactly 4 options")
        parsed = [
            QuestionIn(**{k: v for k, v in q.items() if k in QuestionIn.model_fields})
            for q in raw_questions
        ]
        validate_quiz_payload(
            QuizCreateRequest(classroom_id=classroom_id, title=title, subject=subject, questions=parsed)
        )
    except HTTPException as exc:
        # validate_quiz_payload rejects bad LLM output with 400; from the client's view it's a server-side failure
        logger.error("LLM quiz failed validation: %s", exc.detail)
        raise HTTPException(status_code=500, detail=f"LLM returned invalid quiz data: {exc.detail}")
    except (ValueError, TypeError, AttributeError, ValidationError) as exc:
        logger.exception("Invalid LLM quiz output")
        raise HTTPException(status_code=500, detail=f"LLM returned invalid quiz data: {exc}")
    except Exception as exc:
        logger.exception("LLM quiz generation failed")
        raise HTTPException(status_code=500, detail=f"LLM error: {exc}")

    try:
        quiz = Quiz(
            classroom_id=classroom_id,
            title=title,
            subject=subject,
            class_level=class_level,
            chapter=chapter,
        )
        db.add(quiz)
        db.flush()
        for q, raw in zip(parsed, raw_questions):
            db.add(
                Question(
                    quiz_id=quiz.id,
                    q_text=q.q,
                    options=q.options,
                    answer_index=q.answer,
                    difficulty=q.difficulty,
                    explanation=q.explanation,
                    topic=raw.get("topic"),
                )
            )
        db.commit()
        return {"quiz_id": quiz.id, "question_count": len(parsed)}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/mastery/update", response_model=MasteryOut)
def update_student_mastery(payload: MasteryUpdateRequest, db: Session = Depends(get_db)):
    """Apply one BKT update for a student's answer on a topic (creates the row at p_know=0.3)."""
    try:
        get_or_404(db, StudentProfile, payload.student_id, "Student")
        mastery = (
            db.query(Mastery)
            .filter(Mastery.student_id == payload.student_id, Mastery.topic == payload.topic)
            .first()
        )
        if mastery is None:
            mastery = Mastery(student_id=payload.student_id, topic=payload.topic, p_know=0.3)
            db.add(mastery)
        mastery.p_know = update_mastery(mastery.p_know, payload.correct)
        mastery.updated_at = datetime.now(timezone.utc)
        db.commit()
        return {"topic": mastery.topic, "p_know": mastery.p_know}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/students/{student_id}/stats", response_model=StudentStatsResponse)
def get_student_stats(student_id: int, db: Session = Depends(get_db)):
    """Elo rating, streak, and per-topic mastery for a student."""
    try:
        student = get_or_404(db, StudentProfile, student_id, "Student")
        rows = db.query(Mastery).filter(Mastery.student_id == student_id).order_by(Mastery.topic).all()
        return {
            "student_id": student.id,
            "elo": student.rating,
            "current_streak": student.current_streak,
            "mastery": [{"topic": m.topic, "p_know": m.p_know} for m in rows],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

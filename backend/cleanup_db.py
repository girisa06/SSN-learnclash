"""One-off cleanup of mock data in Neon. Keeps Classroom 1 (8JUJ) with Quiz 3 and Quiz 4 only.

Safety: aborts (deleting nothing) if the live data isn't what was expected, runs in a single
transaction, and writes a JSON snapshot of every deleted row before committing.
Usage: python cleanup_db.py
"""
import json
import os
import sys
from datetime import datetime

from database import SessionLocal
from models import Challenge, Classroom, Mastery, Question, Quiz, StudentProfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

KEEP_CLASSROOM_ID, KEEP_CLASSROOM_CODE = 1, "8JUJ"
KEEP_QUIZ_IDS = [3, 4]
DELETE_STUDENT_IDS = [1]
DELETE_QUIZ_IDS = [1, 2, 5]
SNAPSHOT_DIR = os.getenv("CLEANUP_SNAPSHOT_DIR", os.path.dirname(os.path.abspath(__file__)))


def row(obj):
    return {c.name: (v.isoformat() if isinstance(v := getattr(obj, c.name), datetime) else v) for c in obj.__table__.columns}


session = SessionLocal()
try:
    print("🧹 Cleaning up mock data...\n")

    # ---- Preflight: refuse to run if the data isn't what we expect ----
    keep_room = session.get(Classroom, KEEP_CLASSROOM_ID)
    assert keep_room and keep_room.code == KEEP_CLASSROOM_CODE, "Classroom 1 / 8JUJ not found"
    for qid in KEEP_QUIZ_IDS:
        q = session.get(Quiz, qid)
        assert q and q.classroom_id == KEEP_CLASSROOM_ID, f"Quiz {qid} to KEEP is missing or not in classroom 1"
        assert session.query(Question).filter(Question.quiz_id == qid).count() > 0, f"Quiz {qid} has no questions"
    blockers = {
        "challenges on doomed quizzes/students": session.query(Challenge).filter(
            Challenge.quiz_id.in_(DELETE_QUIZ_IDS)
            | Challenge.student_a_id.in_(DELETE_STUDENT_IDS)
            | Challenge.student_b_id.in_(DELETE_STUDENT_IDS)
            | Challenge.winner_id.in_(DELETE_STUDENT_IDS)
        ).count(),
        "mastery rows on doomed students": session.query(Mastery).filter(Mastery.student_id.in_(DELETE_STUDENT_IDS)).count(),
        "keep-quizzes created by doomed students": session.query(Quiz).filter(
            Quiz.id.in_(KEEP_QUIZ_IDS), Quiz.created_by_student_id.in_(DELETE_STUDENT_IDS)
        ).count(),
    }
    for label, n in blockers.items():
        assert n == 0, f"ABORTING: {n} {label}; delete these deliberately, not via this script"

    # ---- Work out what goes ----
    students = session.query(StudentProfile).filter(StudentProfile.id.in_(DELETE_STUDENT_IDS)).all()
    quizzes = session.query(Quiz).filter(Quiz.id.in_(DELETE_QUIZ_IDS)).all()
    questions = session.query(Question).filter(Question.quiz_id.in_(DELETE_QUIZ_IDS)).all()
    doomed_room_ids = [r.id for r in session.query(Classroom).filter(Classroom.id != KEEP_CLASSROOM_ID).all()]
    # A classroom is only deletable if nothing that survives still points at it.
    surviving_students = session.query(StudentProfile).filter(~StudentProfile.id.in_(DELETE_STUDENT_IDS)).all()
    surviving_quizzes = session.query(Quiz).filter(~Quiz.id.in_(DELETE_QUIZ_IDS)).all()
    in_use = {s.classroom_id for s in surviving_students} | {q.classroom_id for q in surviving_quizzes}
    rooms_to_delete = [r for r in session.query(Classroom).filter(Classroom.id.in_(doomed_room_ids)).all() if r.id not in in_use]
    rooms_skipped = sorted(set(doomed_room_ids) - {r.id for r in rooms_to_delete})

    snapshot = {
        "taken_at": datetime.utcnow().isoformat(),
        "student_profile": [row(s) for s in students],
        "quiz": [row(q) for q in quizzes],
        "question": [row(q) for q in questions],
        "classroom": [row(r) for r in rooms_to_delete],
    }
    path = os.path.join(SNAPSHOT_DIR, f"cleanup_snapshot_{datetime.now():%Y%m%d_%H%M%S}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    print(f"📦 Snapshot of rows to delete saved: {path}\n")

    # ---- Delete (children before parents) ----
    for s in students:
        session.delete(s)
        print(f"✓ Deleted Student {s.id} ({s.name!r}, classroom {s.classroom_id})")
    session.query(Question).filter(Question.quiz_id.in_(DELETE_QUIZ_IDS)).delete(synchronize_session=False)
    print(f"✓ Deleted {len(questions)} questions belonging to quizzes {DELETE_QUIZ_IDS}")
    for q in quizzes:
        session.delete(q)
        print(f"✓ Deleted Quiz {q.id} ({q.title!r})")
    session.flush()
    for r in rooms_to_delete:
        session.delete(r)
        print(f"✓ Deleted Classroom {r.id} ({r.code})")
    if rooms_skipped:
        print(f"⚠ Skipped classrooms still in use by surviving data: {rooms_skipped}")

    session.commit()
except Exception as exc:
    session.rollback()
    print(f"\n❌ {type(exc).__name__}: {exc}\nNothing was deleted (rolled back).")
    session.close()
    sys.exit(1)

# ---- Verify final state ----
print("\n✅ FINAL STATE:")
print(f"Classrooms: {session.query(Classroom).count()} (should be 1)")
print(f"Quizzes: {session.query(Quiz).count()} (should be 2: Quiz 3 & 4)")
print(f"Students: {session.query(StudentProfile).count()} (should be 0)")
print(f"Challenges: {session.query(Challenge).count()} (should be 0)")
print(f"Mastery: {session.query(Mastery).count()} (should be 0)")
room = session.get(Classroom, KEEP_CLASSROOM_ID)
print(f"\nClassroom {room.id} code={room.code}; its quizzes:")
for q in session.query(Quiz).filter(Quiz.classroom_id == room.id).order_by(Quiz.id):
    print(f"  ✓ Quiz {q.id}: {q.title} ({q.subject}) — {session.query(Question).filter(Question.quiz_id == q.id).count()} questions")
session.close()
print("\n✅ Cleanup complete!")

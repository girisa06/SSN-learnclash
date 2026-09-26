"""Tidy up test data in the live DB: flag demo students and remove junk quizzes.

Dry run by default (prints what it WOULD do, changes nothing). Add --apply to execute.
Usage: python cleanup_students.py [--apply]

What it does
  1. Adds student_profile.is_demo if missing (--apply only), then flags test/seed students
     (names: Alice, Bob, Arjun, Priya, anything containing "demo" or "test", or "string").
     Flagging is reversible: UPDATE student_profile SET is_demo = FALSE WHERE id = ...
  2. Deletes junk quizzes (title "string...", empty, or with no questions) that NO challenge uses,
     after writing a JSON snapshot of the quiz and its questions.
  3. REPORTS duplicate names per class but never deletes students: challenges, mastery and quizzes
     reference them by foreign key, so deleting would break other people's history.
"""
import json
import os
import sys
from datetime import datetime

from sqlalchemy import inspect, text

from database import SessionLocal, engine, ensure_columns
from models import Challenge, Question, Quiz, StudentProfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

APPLY = "--apply" in sys.argv
SNAPSHOT_DIR = os.getenv("CLEANUP_SNAPSHOT_DIR", os.path.dirname(os.path.abspath(__file__)))
DEMO_NAMES = {"alice", "bob", "arjun", "priya", "string"}
DEMO_FRAGMENTS = ("demo", "test")


def is_demo_name(name: str) -> bool:
    n = name.strip().lower()
    return n in DEMO_NAMES or any(f in n for f in DEMO_FRAGMENTS)


def row(obj):
    return {c.name: (v.isoformat() if isinstance(v := getattr(obj, c.name), datetime) else v) for c in obj.__table__.columns}


print(f"{'APPLYING' if APPLY else 'DRY RUN (nothing will change; add --apply to execute)'}\n")
session = SessionLocal()
try:
    has_column = "is_demo" in {c["name"] for c in inspect(engine).get_columns("student_profile")}
    if not has_column:
        print("student_profile.is_demo is missing: " + ("adding it now." if APPLY else "would add it."))
        if APPLY:
            ensure_columns(engine)
            has_column = True

    # ---- 1. demo flags (plain SQL so the dry run works before the column exists) ----
    students = session.execute(text("SELECT id, classroom_id, name FROM student_profile ORDER BY classroom_id, id")).fetchall()
    already = set()
    if has_column:
        already = {r[0] for r in session.execute(text("SELECT id FROM student_profile WHERE is_demo"))}
    to_flag = [s for s in students if is_demo_name(s.name) and s.id not in already]
    print(f"Demo flags: {len(already)} already flagged, {len(to_flag)} to flag")
    for s in to_flag:
        print(f"  flag  #{s.id:<3} class {s.classroom_id:<3} {s.name!r}")
    if APPLY and to_flag:
        session.query(StudentProfile).filter(StudentProfile.id.in_([s.id for s in to_flag])).update(
            {"is_demo": True}, synchronize_session=False)

    # ---- 2. junk quizzes nobody plays ----
    junk = []
    for quiz in session.query(Quiz).order_by(Quiz.id):
        n_questions = session.query(Question).filter(Question.quiz_id == quiz.id).count()
        n_challenges = session.query(Challenge).filter(Challenge.quiz_id == quiz.id).count()
        looks_junk = quiz.title.strip().lower().startswith("string") or not quiz.title.strip() or n_questions == 0
        if looks_junk and n_challenges == 0:
            junk.append(quiz)
        elif looks_junk:
            print(f"  keep  quiz #{quiz.id} {quiz.title!r}: looks junk but {n_challenges} challenge(s) use it")
    print(f"\nJunk quizzes to delete: {len(junk)}")
    snapshot = []
    for quiz in junk:
        questions = session.query(Question).filter(Question.quiz_id == quiz.id).all()
        print(f"  delete quiz #{quiz.id} {quiz.title!r} (class {quiz.classroom_id}, {len(questions)} questions)")
        snapshot.append({"quiz": row(quiz), "questions": [row(q) for q in questions]})
    if APPLY and junk:
        path = os.path.join(SNAPSHOT_DIR, f"cleanup_students_snapshot_{datetime.now():%Y%m%d_%H%M%S}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=2)
        print(f"  snapshot written: {path}")
        for quiz in junk:
            session.query(Question).filter(Question.quiz_id == quiz.id).delete(synchronize_session=False)
            session.delete(quiz)

    # ---- 3. duplicate names (report only) ----
    dupes = session.execute(text(
        "SELECT classroom_id, lower(name) AS n, count(*) AS c FROM student_profile GROUP BY classroom_id, lower(name) HAVING count(*) > 1"
    )).fetchall()
    print(f"\nDuplicate names (report only, never deleted): {len(dupes)} group(s)")
    for d in dupes:
        ids = [r[0] for r in session.execute(text("SELECT id FROM student_profile WHERE classroom_id = :c AND lower(name) = :n ORDER BY id"), {"c": d.classroom_id, "n": d.n})]
        refs = {i: session.query(Challenge).filter((Challenge.student_a_id == i) | (Challenge.student_b_id == i)).count() for i in ids}
        print(f"  class {d.classroom_id} {d.n!r}: ids {ids}, challenges each {list(refs.values())}")

    if APPLY:
        session.commit()
        print("\nDone: changes committed.")
    else:
        session.rollback()
        print("\nDry run only: nothing changed.")
except Exception:
    session.rollback()
    raise
finally:
    session.close()

# Quiz Duel — Backend Workflow Guide

**You = Backend Member 1 (Game Engine)**  
**Goal:** Every route works. Student can beat bot and level up.  
**Tech Stack:** FastAPI + PostgreSQL (Neon) + Render  

---

## Git Workflow Strategy

**Main branch:** `main` (always deployable, only merged at checkpoints)  
**Your work:** Create feature branches, merge after each checkpoint passes.

### Branch naming convention:
```
backend/setup-db              (Phase 0-2h)
backend/core-routes           (Phase 2-6h)
backend/game-logic            (Phase 6-12h)
backend/quiz-creation         (Phase 12-18h)
backend/polish-bugs           (Phase 18-24h)
```

### Commit pattern:
```
[checkpoint-1] API contract + DB schema ready
[checkpoint-2] Student join + quiz routes live
[checkpoint-3] Challenge + scoring logic complete
[checkpoint-4] End-to-end battle ready
[checkpoint-5] Bug fixes + optimization
```

---

## PHASE 0–2 HOURS: Foundation

### Your tasks:
- [ ] **GitHub Setup**
  - [ ] Clone repo / create new repo
  - [ ] Create `backend/` folder with `.gitignore`
  - [ ] Create `backend/.env.example` (don't commit secrets)
  ```
  DATABASE_URL=postgresql://...
  NEON_DB_PASSWORD=***
  RENDER_API_KEY=***
  ```

- [ ] **FastAPI Project Setup**
  ```bash
  cd backend
  python -m venv venv
  source venv/bin/activate  # or `venv\Scripts\activate` on Windows
  pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv
  ```
  - [ ] Create `main.py` with basic FastAPI app
  - [ ] Test: `uvicorn main:app --reload` → GET `/health` returns `{"status": "ok"}`

- [ ] **Neon Database Setup**
  - [ ] Sign up at neon.tech (free tier)
  - [ ] Create project, copy `DATABASE_URL`
  - [ ] Save to `.env` (never commit)
  - [ ] Create SQLAlchemy connection in `main.py`
  - [ ] Test connection with a simple query

- [ ] **Define Database Schema** (create `schema.sql` or SQLAlchemy models)
  ```
  Tables needed:
  ├── classroom (id, code[4-char unique], created_at)
  ├── student_profile (id, classroom_id, name, avatar, level, xp, current_streak, wins)
  ├── quiz (id, classroom_id, title, subject, created_by_student_id, created_at)
  ├── question (id, quiz_id, q_text, options[json], answer_index, difficulty, explanation)
  ├── challenge (id, quiz_id, student_a_id, student_b_id, status[waiting/done], winner_id, score_a, score_b, created_at)
  └── bot_difficulty (name[Rookie/Champion/Legend], easy_q_count, medium_q_count, hard_q_count)
  ```

- [ ] **Write API Contract** (add to team playbook)
  - [ ] Define request/response shapes for all routes
  - [ ] Example:
    ```json
    POST /api/classrooms/join
    {
      "code": "ABC1",
      "name": "Arjun"
    }
    →
    {
      "student_id": 42,
      "avatar_choices": ["🐉", "🤖", "🧙", "🦁", "🚀", "⚡"],
      "classroom_id": 5
    }
    ```

### Commits:
```bash
git checkout -b backend/setup-db
# After setting up venv, FastAPI, .env structure:
git add backend/ .gitignore
git commit -m "[setup] FastAPI + Neon setup, .env config"

# After schema design:
git commit -m "[schema] Classroom, student, quiz, challenge tables defined"

# After API contract:
git add TEAM_PLAYBOOK.md
git commit -m "[api-contract] Request/response shapes locked"

git push origin backend/setup-db
# Wait for checkpoint review before merging to main
```

### Checkpoint 1 Checklist:
- [ ] Neon database connects
- [ ] 6 tables created (classroom, student_profile, quiz, question, challenge, bot_difficulty)
- [ ] API contract written in team playbook (no changes after this)
- [ ] Quiz JSON format agreed (see playbook handoff)
- [ ] FastAPI /health working
- [ ] **Merge to main** and celebrate 🎉

---

## PHASE 2–6 HOURS: Core Routes (Join + Quiz)

### Your tasks:
- [ ] **POST /api/classrooms/create** (for teacher)
  - [ ] Generate random 4-char code (A-Z, 0-9)
  - [ ] Return `{"classroom_id": X, "code": "ABC1"}`
  - [ ] Make code unique (retry if duplicate)

- [ ] **POST /api/classrooms/join** (student joins with code)
  - [ ] Check code exists → create student_profile
  - [ ] Return `{"student_id": X, "classroom_id": Y, "avatar_choices": [...]}`

- [ ] **GET /api/classrooms/{id}/quizzes** (list quizzes in class)
  - [ ] Return `{"quizzes": [{"id": 1, "title": "Science", "question_count": 15}, ...]}`

- [ ] **GET /api/quizzes/{id}** (fetch full quiz with questions)
  - [ ] Return `{"quiz": {...}, "questions": [...]}`
  - [ ] Don't reveal answer indices yet (game logic handles that)

- [ ] **POST /api/quizzes/create** (seed demo quizzes)
  - [ ] Accept quiz JSON from Member 4
  - [ ] Insert all questions
  - [ ] Return quiz_id

- [ ] **GET /api/leaderboard/{classroom_id}** (top 10)
  - [ ] Sort by level DESC, then xp DESC
  - [ ] Return avatar, level, current_streak, total_xp

- [ ] **Test all routes** in FastAPI /docs
  - [ ] Create a classroom manually
  - [ ] Join it twice with different names
  - [ ] List quizzes
  - [ ] Verify leaderboard is empty

### Seed Script:
Create `backend/seed_demo.py`:
```python
# After Phase 2-6, run: python seed_demo.py
# This loads the 4 quiz JSON files from Member 4 into the database
```

### Commits:
```bash
git checkout -b backend/core-routes
# After classroom routes:
git commit -m "[routes] POST /classrooms/create, /join + GET /quizzes"

# After leaderboard:
git commit -m "[routes] GET /leaderboard + seed script skeleton"

git push origin backend/core-routes
```

### Checkpoint 2 Checklist (Hour 6–8):
- [ ] Student can join with code + name
- [ ] Quizzes load live on website (Member 2 confirms)
- [ ] Leaderboard endpoint returns students with avatars
- [ ] No database errors in logs
- [ ] Member 3 can call all join/quiz routes from api.js
- [ ] **Merge to main**

---

## PHASE 6–12 HOURS: Game Logic (Challenge + Scoring)

### Your tasks:
- [ ] **POST /api/challenges/create** (Student A challenges Student B)
  - [ ] Input: `{quiz_id, student_b_id}`
  - [ ] Create challenge row with status = "waiting_for_player_b"
  - [ ] Return `{"challenge_id": X}`

- [ ] **GET /api/challenges/{student_id}** (My challenges)
  - [ ] Return waiting challenges (waiting_for_me) + finished (I won/lost)
  - [ ] Format: `{"challenges": [{"id": 1, "quiz_title": "...", "opponent": "...", "status": "..."}]}`

- [ ] **POST /api/challenges/{id}/submit** (Submit score after quiz)
  - [ ] Input: `{student_id, score}`
  - [ ] If opponent already submitted: decide winner
  - [ ] **Winner logic:**
    ```
    if student_a_score > student_b_score:
      winner = student_a
    else:
      winner = student_b
    
    # Award XP to winner only:
    base_xp = 10
    if student submitted combo bonus (from Member 3):
      xp += combo_bonus
    winner.xp += xp
    winner.wins += 1
    
    # Check level up (every 50 XP = 1 level, cap at 10)
    new_level = min(winner.xp // 50 + 1, 10)
    if new_level > winner.level:
      winner.level = new_level
      return {level_up: true}
    ```
  - [ ] Return `{"winner_id": X, "xp_earned": 15, "level_up": false}`

- [ ] **Avatar Leveling Logic**
  - [ ] Stored in student_profile: xp (total), level (1–10)
  - [ ] Test: student gets 100 XP → should be level 3 (100 / 50 = 2, +1 = level 3)

- [ ] **Bot Logic** (placeholder)
  - [ ] When student "fights bot", generate fake score based on bot difficulty
  - [ ] Rookie bot: 10–30 points (easy)
  - [ ] Champion bot: 30–60 points (medium)
  - [ ] Legend bot: 60–90 points (hard)
  - [ ] Create auto-challenge from bot account

- [ ] **Integration test:**
  - [ ] Create challenge between real students
  - [ ] Both submit scores
  - [ ] Winner gets XP, level up works
  - [ ] Leaderboard updates

### Commits:
```bash
git checkout -b backend/game-logic
# After challenge routes:
git commit -m "[challenges] POST /create, GET /my-challenges, submit score"

# After winner logic:
git commit -m "[scoring] Winner decided, XP awarded, level up logic"

# After bot:
git commit -m "[bots] Rookie/Champion/Legend scoring + auto-challenge"

git push origin backend/game-logic
```

### Checkpoint 3 Checklist (Hour 12–14):
- [ ] Full quiz playable (Member 2 confirms UI works)
- [ ] Adaptive difficulty works (Member 3 calls backend)
- [ ] Streaks display on leaderboard
- [ ] XP calculated correctly (test: 10 + 5 + 15 = 30 XP after combo)
- [ ] Student levels up after 50 XP
- [ ] Bot battle gives realistic scores
- [ ] **Merge to main**

---

## PHASE 12–18 HOURS: Quiz Creation + Bug Fixes

### Your tasks:
- [ ] **POST /api/quizzes/create** (full validation)
  - [ ] Check: all questions have q, options, answer, difficulty
  - [ ] Check: answer index is valid (0–3)
  - [ ] Check: at least 5 questions
  - [ ] Return error if invalid

- [ ] **Seed 4 demo quizzes** (from Member 4)
  - [ ] Run `python seed_demo.py` to populate:
    - Quiz 1: Mix of easy/medium/hard (5 each)
    - Quiz 2–4: Bot quizzes (Rookie = all easy, etc.)
  - [ ] Verify in database

- [ ] **Test full flow on 2 phones:**
  - [ ] Phone A: join → see quizzes → fight bot Rookie → win → level up
  - [ ] Phone B: join → challenge Phone A to Quiz 1 → both play → leaderboard updates
  - [ ] Look for bugs: slow responses, missing data, crashes

- [ ] **Debug from logs:**
  - [ ] Check Render logs for errors
  - [ ] Fix: slow queries (add indexes if needed)
  - [ ] Fix: missing error handling

### Commits:
```bash
git checkout -b backend/quiz-creation
# After quiz validation:
git commit -m "[validation] POST /quizzes/create with checks"

# After seeding:
git commit -m "[seed] 4 demo quizzes loaded (mix + bot sets)"

# After bug fixes:
git commit -m "[bugs] Fixed slow leaderboard query, added error handling"

git push origin backend/quiz-creation
```

### Checkpoint 4 Checklist (Hour 18–20):
- [ ] Challenge between two real students works end-to-end
- [ ] Winner is decided correctly
- [ ] Leaderboard updates in real time
- [ ] Avatar levels up on phone after winning
- [ ] Both devices see the same leaderboard
- [ ] No slowness or crashes
- [ ] **Merge to main**

---

## PHASE 18–22 HOURS: Polish + No New Features

### Your tasks:
- [ ] **Freeze API** — no new routes
- [ ] **Bug fixes only:**
  - [ ] Tie-breaker logic (if scores equal → both get XP, no winner)
  - [ ] Don't repeat question in same quiz
  - [ ] Handles offline gracefully (Member 3 will use localStorage)
  - [ ] Rate limiting on POST /classrooms/create (prevent spam)

- [ ] **Performance:**
  - [ ] Leaderboard query < 200ms (add database index if needed)
  - [ ] /api/quizzes/{id} returns in < 100ms
  - [ ] Log slow queries (uvicorn debug mode)

- [ ] **Final deployment check:**
  - [ ] Render server is pinged every 5 min (it sleeps on free tier, wakes in 30s)
  - [ ] Database backups working (Neon default)
  - [ ] /health endpoint still returns ok

### Commits:
```bash
git checkout -b backend/polish-bugs
# After tie logic:
git commit -m "[edge-cases] Tie-breaker, no repeated questions"

# After perf improvements:
git commit -m "[perf] Optimized leaderboard query with index"

# Final:
git commit -m "[polish] Rate limiting, error messages, final checks"

git push origin backend/polish-bugs
```

---

## PHASE 22–24 HOURS: Demo Support

### Your tasks:
- [ ] **Stay on call with team**
- [ ] Debug live if Member 2, 3, or 4 hit issues
- [ ] Keep Render server warm (ping it every 10 min)
- [ ] If Wi-Fi fails during demo: screen recording backup ready
- [ ] Help with demo script walkthrough

### Final Merge:
```bash
# After final tests pass:
git merge backend/polish-bugs → main
git tag v1.0-hackathon
```

---

## Quick Reference: What Each Member Needs From You

| Member | Needs | Deadline | Format |
|--------|-------|----------|--------|
| Member 3 (Game Logic) | API contract, list of all routes + response shapes | Hour 2 | JSON in playbook |
| Member 2 (Screens) | Routes working live on Render | Hour 6 | Live API + /docs |
| Member 4 (Content) | Quiz seed script + example quiz JSON schema | Hour 6 | Python script + JSON schema |
| All | Leaderboard working, XP logic solid | Hour 12 | Live endpoint test |

---

## Debugging Checklist

If something breaks, check in this order:

1. **Database connection**
   ```bash
   # In FastAPI shell:
   from main import SessionLocal
   db = SessionLocal()
   db.execute("SELECT 1")  # Should return without error
   ```

2. **Logs**
   ```bash
   # Locally:
   uvicorn main:app --reload  # Shows all errors
   
   # On Render:
   Render dashboard → Logs → scroll to see errors
   ```

3. **API response**
   ```bash
   curl http://localhost:8000/health
   curl http://localhost:8000/docs  # FastAPI interactive docs
   ```

4. **Database state**
   - Open Neon dashboard, run SQL queries directly
   - Check: students exist, quizzes loaded, leaderboard populated

---

## Your First 30 Minutes (DO THIS NOW)

```bash
# 1. Create backend folder and git branch
mkdir backend
cd backend
git checkout -b backend/setup-db

# 2. Set up Python environment
python -m venv venv
source venv/bin/activate
pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv

# 3. Create main.py with basic app
# (See example below)

# 4. Test it runs
uvicorn main:app --reload
# Visit http://localhost:8000/docs

# 5. Create .env and .gitignore
# (See examples below)

# 6. Commit
git add .
git commit -m "[setup] FastAPI + Neon scaffolding"
git push origin backend/setup-db
```

### `backend/main.py` starter:
```python
from fastapi import FastAPI
from sqlalchemy import create_engine
from dotenv import load_dotenv
import os

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### `backend/.gitignore`:
```
venv/
__pycache__/
*.pyc
.env
.DS_Store
*.db
.idea/
```

---

## Handoff: What You Give Member 3 by Hour 2

```json
{
  "routes": [
    {
      "method": "POST",
      "path": "/api/classrooms/join",
      "request": {"code": "ABC1", "name": "Arjun"},
      "response": {"student_id": 42, "classroom_id": 5, "avatar_choices": ["🐉", "🤖", "🧙", "🦁", "🚀", "⚡"]}
    },
    {
      "method": "GET",
      "path": "/api/classrooms/{id}/quizzes",
      "response": {"quizzes": [{"id": 1, "title": "Science", "question_count": 15}]}
    }
  ],
  "database_schema": {
    "student_profile": ["id", "classroom_id", "name", "avatar", "level", "xp", "current_streak"],
    "quiz": ["id", "classroom_id", "title", "subject"],
    "question": ["id", "quiz_id", "q", "options", "answer", "difficulty"]
  }
}
```

---

Good luck! You've got this. 🚀

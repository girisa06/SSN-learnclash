# Backend Integration Checklist

## Local testing
1. Backend needs `backend/.env` with `DATABASE_URL` and `GROQ_API_KEY` (never commit it).
2. Start it: `cd backend && python -m uvicorn main:app --host 0.0.0.0 --reload`
   (`--host 0.0.0.0` lets a phone or second laptop reach it; restart after editing `.env`, `--reload` does not watch it.)
3. `http://localhost:8000/health` must return `{"status":"ok"}`. `http://localhost:8000/docs` lists all routes.
4. Run the frontend: `cd frontend && npm install && npm run dev` (Vite serves on port 5173, also reachable from other devices on your Wi-Fi).
   It reads `VITE_API_BASE_URL` from `frontend/.env.local`, currently `http://localhost:8000`; use the Render URL instead to test against production, then restart Vite.
5. Open DevTools (F12) -> **Network** tab and watch the `/api/...` requests; the **Console** tab shows any render error (the app also prints render errors on screen instead of a blank page).

## Production (Render)
1. Backend: `https://gamified-quiz-887m.onrender.com` (free tier sleeps; first request after idle took ~35 s, so hit `/health` first).
2. Frontend `VITE_API_BASE_URL` = that URL, no trailing slash. All routes are prefixed `/api` except `/health`.
3. Render must be redeployed after backend changes. Checked live on Render: CORS headers and leaderboard `rating` are present, and it serves 13 routes
   (the `/answer` route is new and needs a redeploy). The submit race-lock cannot be checked from outside; confirm the deployed commit includes it.

## Payloads the backend expects
| Call | Request | Response |
|---|---|---|
| `POST /api/classrooms/join` | `{code, name, avatar?}` (avatar optional, one of `avatar_choices`, else 400) | `{student_id, classroom_id, avatar_choices}` |
| `GET /api/classrooms/{id}/quizzes` | - | `{quizzes:[{id,title,subject,question_count}]}` |
| `GET /api/quizzes/{id}` | - | `{quiz, questions:[{id,q,options,difficulty,explanation}]}` (no answers) |
| `POST /api/quizzes/{id}/answer` | `{question_id, answer_index}` (0-3; `selected_option` "A"-"D" also accepted) | `{question_id, correct, is_correct, correct_answer, topic, explanation}` |
| `POST /api/challenges/create` | `{quiz_id, student_a_id, student_b_id}` | `{challenge_id}` |
| `GET /api/challenges/{student_id}` | - | `{challenges:[{id,quiz_id,quiz_title,opponent_name,opponent_id,status,my_score,opponent_score,winner_id}]}` |
| `GET /api/challenges/{challenge_id}/status` | - | `{challenge_id, quiz_id, status, student_a_id, student_b_id, student_a_score, student_b_score, winner_id, student_a_elo, student_b_elo}` (scores/winner are `null` until known; poll until `status == "done"`) |
| `POST /api/challenges/{challenge_id}/submit` | `{student_id, score}` (0-100; challenge id is in the **URL**) | `{status, winner_id, xp_earned, level_up, new_level, student_a_new_rating, student_b_new_rating}` |
| `POST /api/mastery/update` | `{student_id, topic, correct}` | `{topic, p_know}` |
| `GET /api/students/{id}/stats` | - | `{student_id, elo, current_streak, mastery:[{topic,p_know}]}` |
| `GET /api/leaderboard/{classroom_id}` | - | `{leaderboard:[{id,name,avatar,level,current_streak,xp,rating}]}` |

**Submit twice per challenge**: once as student A and once as student B (each with their own score). The first call
returns `status: "waiting_for_a"/"waiting_for_b"`; the second returns `status: "done"` with the winner and both new Elo ratings.

## Test flow
1. Join classroom (code `8JUJ`) as two students -> note both `student_id`s.
2. Load quizzes for the classroom (ids 3 and 4) -> open one.
3. Create a challenge (A vs B) -> note `challenge_id`.
4. Each student submits a score -> second response is `done` with `winner_id`.
5. `updateMastery` per answered question -> `p_know` moves; `/stats` shows it.
6. Leaderboard -> both students, with updated `rating`.

## Common errors
- **404 on `/api/classrooms/join`**: wrong classroom code (`{"detail":"Classroom not found"}`).
- **400 on any POST**: payload has missing/wrong-typed fields; the response `detail` lists which. Wrong key names (e.g. `challenger_id`) land here.
- **400 on submit**: "Score already submitted", "Student is not part of this challenge", score outside 0-100, or challenge already done.
- **CORS error**: backend must have `CORSMiddleware` (it does now); if you see it against Render, Render is running old code, redeploy.
- **Request hangs ~30 s then works**: Render or Neon waking from idle.

## Review findings (all fixed unless noted)
1. FIXED: `api.js` `createChallenge` sent `{challenger_id, challenged_id}`. It is now `createChallenge(quizId, studentAId, studentBId)` and sends
   `{quiz_id, student_a_id, student_b_id}`. `game.js`'s `createChallenge(friendId, quizId, studentId)` (the signature screens use) maps to it as A = you, B = friend.
2. FIXED: `game.js` failed to load because `api.js` had lost `checkQuizAnswer`, `createQuiz`, `getChallenges` (commit `b1aa1ec`). Restored, along with
   `getQuizzes`, `getQuizzesByClass`, `getQuiz`, `getLeaderboard`, `getMastery`, `uploadPDF` and `createClassroom`.
3. FIXED: `finishChallenge` passed `(challengeId, score, studentId)` to `submitChallengeScore(challengeId, studentId, score)`; arguments are now in the right order.
4. FIXED: `POST /api/quizzes/{id}/answer` added to the backend; deploy it to Render before testing against production.
5. OPEN (minor): `fetchStudentStats(studentId = 1)` still defaults to student 1, which no longer exists; always pass the real id.
6. NOTE: `.env.local` points at Render, so local dev hits production until you change `VITE_API_BASE_URL`.

# Member 3 handoff

Screens should import game actions from `game.js` and backend calls from `api.js`; screens do not call `fetch`.

```js
import { joinClass, getQuizzes, getQuiz, createChallenge, getChallenges,
  finishChallenge, getLeaderboard, uploadPDF } from "./api.js";
import { createValidatedQuiz, createQuizSession, nextQuestion,
  answerQuestion, finishQuiz } from "./game.js";
```

Use the mechanics in `game.js` for an active quiz:

```js
const session = createQuizSession(quiz, { studentId, totalXp });
const question = nextQuestion(session);
const feedback = await answerQuestion(session, selectedOptionIndex);
const result = finishQuiz(session);
```

`answerQuestion` sends the selected option to `POST /api/quizzes/{quiz_id}/answer` for server-side grading, posts `{ student_id, topic, correct }` to `/api/mastery/update` after every answer, then reads `/api/students/{id}/stats`. It uses the returned topic `p_know` to pick the next difficulty (below 0.40 = easy, 0.40–0.74 = medium, 0.75+ = hard). It returns points, XP, streak/combo, explanation, level, and next difficulty. Each quiz question is selected at most once.

## Screen function list

| Function | Purpose |
| --- | --- |
| `joinClass(code, name)` | Join a classroom |
| `getQuizzes()` / `getQuizzes(classroomId)` / `getQuizzesByClass(classroomId)` | List quizzes for the saved or supplied classroom |
| `getQuiz(id)` | Load quiz and questions |
| `nextQuestion(session)` / `answerQuestion(session, optionIndex)` | Play and score one question |
| `finishQuiz(session)` | Produce score, XP, level and streak result |
| `createChallenge(friendId, quizId, studentId)` | Challenge a friend |
| `getChallenges(studentId)` / `finishChallenge(id, studentId, result)` | Load challenges / submit score |
| `getLeaderboard(classroomId)` / `formatLeaderboard(entries)` | Load and rank by level then XP; rating is included for display |
| `createValidatedQuiz(quiz)` | Validate classroom, five-question minimum, and four-option format, then save |
| `uploadPDF(file, metadata)` | Upload a PDF with classroom, class level, subject and chapter; return the generated quiz with questions |
| `getMastery(studentId)` / `getStudentStats(studentId)` | Load mastery and student stats |
| `rememberStudent(data)` / `getRememberedStudent()` | Persist student, classroom and avatar in local storage |
| `getAvatarLevel(totalXp)` / `getAnswerFeedback(session)` | Level and combo display helpers |
| `calculateNextDifficulty(pKnow)` / `calculatePoints(difficulty, streak)` | Mastery-based difficulty and correct-answer rewards |
| `calculateElo(rating, opponentRating, actualScore)` / `formatBattleResult(data)` | Elo result display helpers |
| `formatBotScore(score, difficulty)` | Generate a varied practice bot score |

Set `VITE_API_BASE_URL` to the backend origin when frontend and API have different origins. PDF upload uses multipart form data with a `file` field and `POST /api/quizzes/generate-from-pdf`.

## Backend integration contract to confirm

- `POST /api/mastery/update`: `{ student_id, topic, correct }`.
- `POST /api/quizzes/{quiz_id}/answer`: `{ question_id, answer_index }`, returns correctness, topic and explanation without exposing the answer key in quiz downloads.
- `GET /api/students/{id}/stats`: returns topic mastery values with `p_know` and an Elo field for the results screen.
- `POST /api/challenges/create`: `{ student_a_id, student_b_id, quiz_id }`; score submit sends `{ student_id, score }`.
- `uploadPDF()` accepts a `File` plus classroom, class level, subject and chapter metadata; it turns the backend's `{ quiz_id, question_count }` response into a quiz object with questions.

The backend branch is integrated. Elo display helpers are ready for screens; the server remains authoritative for rating updates and duel outcomes. Set `FRONTEND_ORIGINS` on the backend to the deployed frontend origin for cross-origin requests.

import requests

BASE_URL = "http://127.0.0.1:8000/api"

print("Starting Member 3 Integration Test Flow...\n")

res_a = requests.post(f"{BASE_URL}/classrooms/join", json={"code": "8JUJ", "name": "Arjun"})
print(f"a) Join Arjun: Status {res_a.status_code} -> {res_a.json()}")
student_id_a = res_a.json().get("student_id") or res_a.json().get("id")

res_b = requests.post(f"{BASE_URL}/classrooms/join", json={"code": "8JUJ", "name": "Priya"})
print(f"b) Join Priya: Status {res_b.status_code} -> {res_b.json()}")
student_id_b = res_b.json().get("student_id") or res_b.json().get("id")

res_c = requests.post(f"{BASE_URL}/challenges/create", json={
    "quiz_id": 3,
    "student_a_id": student_id_a,
    "student_b_id": student_id_b
})
print(f"c) Create Challenge: Status {res_c.status_code} -> {res_c.json()}")
challenge_id = res_c.json().get("challenge_id") or res_c.json().get("id")

res_d = requests.post(f"{BASE_URL}/mastery/update", json={
    "student_id": student_id_a,
    "topic": "photosynthesis",
    "correct": True
})
print(f"d) Update Mastery: Status {res_d.status_code} -> {res_d.json()}")

res_e = requests.get(f"{BASE_URL}/students/{student_id_a}/stats")
print(f"e) Arjun Stats: Status {res_e.status_code} -> {res_e.json()}")

res_f = requests.post(f"{BASE_URL}/challenges/{challenge_id}/submit", json={
    "student_id": student_id_a,
    "score": 85
})
print(f"f) Arjun Submit: Status {res_f.status_code} -> {res_f.json()}")

res_g = requests.post(f"{BASE_URL}/challenges/{challenge_id}/submit", json={
    "student_id": student_id_b,
    "score": 60
})
print(f"g) Priya Submit: Status {res_g.status_code} -> {res_g.json()}")

res_h = requests.get(f"{BASE_URL}/leaderboard/1")
print(f"h) Leaderboard Check: Status {res_h.status_code} -> {res_h.json()}")

print("\n--------------------------------------------------")
if res_g.json().get("winner_id") == student_id_a and res_g.json().get("status") == "done":
    print("Integration test PASSED!")
else:
    print("Integration test FAILED.")

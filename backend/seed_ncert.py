import json
import requests

API_URL = "http://localhost:8000"

with open("quiz_biology.json") as f:
    quiz_bio = json.load(f)
    quiz_bio["classroom_id"] = 1
    r = requests.post(f"{API_URL}/api/quizzes/create", json=quiz_bio)
    print(f"Biology: {r.json()}")

with open("quiz_physics.json") as f:
    quiz_phys = json.load(f)
    quiz_phys["classroom_id"] = 1
    r = requests.post(f"{API_URL}/api/quizzes/create", json=quiz_phys)
    print(f"Physics: {r.json()}")
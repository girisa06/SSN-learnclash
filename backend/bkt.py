"""Bayesian Knowledge Tracing engine and Elo rating."""


def update_mastery(p_know, correct, p_guess=0.25, p_slip=0.1, p_transit=0.3):
    """
    BKT formula: update knowledge probability given answer correctness.
    p_know: probability student knows this topic (0-1)
    correct: boolean, whether answer was correct
    Returns: new p_know (0-1)
    """
    if correct:
        num = p_know * (1 - p_slip)
        den = num + (1 - p_know) * p_guess
    else:
        num = p_know * p_slip
        den = num + (1 - p_know) * (1 - p_guess)
    p_know_post = num / den
    return p_know_post + (1 - p_know_post) * p_transit


def update_elo(my_rating, opponent_rating, actual_score, k=32):
    """
    Elo rating update.
    my_rating: current Elo rating
    opponent_rating: opponent's Elo rating
    actual_score: 1 (win), 0.5 (tie), 0 (loss)
    Returns: new Elo rating
    """
    expected = 1 / (1 + 10 ** ((opponent_rating - my_rating) / 400))
    return my_rating + k * (actual_score - expected)


if __name__ == "__main__":
    p = 0.3
    print(f"Starting p_know: {p}")
    for i in range(5):
        p = update_mastery(p, correct=True)
        print(f"After correct answer {i + 1}: {p:.3f}")

    my_elo, opp_elo = 1200, 1200
    print(f"\nElo after win: {update_elo(my_elo, opp_elo, 1)} vs {update_elo(opp_elo, my_elo, 0)}")

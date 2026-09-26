import { forwardRef, useCallback, useId, useImperativeHandle, useRef, useState } from "react";
import "./TugOfWarArena.css";

// Tug of war between the player (left) and a robot (right).
//
// pullPosition runs 0.0 (robot wins) .. 1.0 (player wins), 0.5 = tie. A correct answer adds
// pullMagnitude, a wrong one subtracts it. The marker is drawn at (1 - pullPosition) of the
// track, so a correct answer slides it LEFT, toward the player.
//
// Drive it through a ref:
//   const arena = useRef(null);
//   <TugOfWarArena ref={arena} playerAvatar="⚔️" onGameEnd={(winner) => ...} />
//   arena.current.onAnswerCorrect();   // or onAnswerIncorrect(); optional arg overrides the pull size
//   arena.current.reset();             // start over
//
// Props: playerAvatar (emoji), robotAvatar (emoji, default 🤖), pullMagnitude (default 0.15),
//        onGameEnd(winner) with winner "player" | "robot" (called once when 0.0 or 1.0 is reached).

const START = 0.5;
const clamp01 = (n) => Math.min(1, Math.max(0, Math.round(n * 1000) / 1000)); // rounding stops 0.15 * n drift

const TugOfWarArena = forwardRef(function TugOfWarArena(
  { playerAvatar = "⚔️", robotAvatar = "🤖", pullMagnitude = 0.15, onGameEnd },
  ref,
) {
  const ropeId = useId().replace(/:/g, "");
  const [pull, setPull] = useState(START);
  const [winner, setWinner] = useState(null);
  const [fx, setFx] = useState({ kind: null, n: 0 }); // last answer result; n restarts the CSS animations
  const pullRef = useRef(START); // latest value, so rapid calls never read a stale render
  const endedRef = useRef(false);
  const onGameEndRef = useRef(onGameEnd);
  onGameEndRef.current = onGameEnd;

  const apply = useCallback((direction, magnitude) => {
    if (endedRef.current) return; // the round is over; ignore further answers until reset()
    const next = clamp01(pullRef.current + direction * (magnitude ?? pullMagnitude));
    pullRef.current = next;
    setPull(next);
    setFx((prev) => ({ kind: direction > 0 ? "good" : "bad", n: prev.n + 1 }));
    if (next >= 1 || next <= 0) {
      const who = next >= 1 ? "player" : "robot";
      endedRef.current = true;
      setWinner(who);
      onGameEndRef.current?.(who);
    }
  }, [pullMagnitude]);

  useImperativeHandle(ref, () => ({
    onAnswerCorrect: (magnitude) => apply(+1, magnitude),
    onAnswerIncorrect: (magnitude) => apply(-1, magnitude),
    reset: () => {
      pullRef.current = START;
      endedRef.current = false;
      setPull(START);
      setWinner(null);
      setFx((prev) => ({ kind: null, n: prev.n + 1 }));
    },
    getPosition: () => pullRef.current,
  }), [apply]);

  const pct = Math.round(pull * 100);
  const status = winner === "player"
    ? "You win the tug of war! 🏆"
    : winner === "robot"
      ? "The robot wins this round 🤖"
      : pull > START ? "You're pulling ahead" : pull < START ? "The robot is ahead" : "Dead even";

  // Correct = quick 180ms slide with a green glow; wrong = slower 300ms slide with red sparks.
  const dur = fx.kind === "bad" ? 300 : 180;
  const playerAnim = fx.kind === "good" ? "pull" : fx.kind === "bad" ? "stumble" : "";
  const robotAnim = fx.kind === "bad" ? "boost" : fx.kind === "good" ? "stumble" : "";

  return (
    <section className={`tow${winner ? ` tow-ended tow-won-${winner}` : ""}`} data-pull={pull} aria-label="Tug of war">
      <div className="tow-labels">
        <span>YOU</span>
        <span className="tow-score">Pull Marker Position <strong>{pct}%</strong></span>
        <span>ROBOT</span>
      </div>

      <div className="tow-field">
        <div className="tow-fighter tow-player" aria-hidden="true">
          <span key={`p${fx.n}`} className={`tow-emoji${playerAnim ? ` tow-${playerAnim}` : ""}`}>{playerAvatar}</span>
        </div>

        <div className="tow-track">
          <svg className="tow-rope" width="100%" height="18" aria-hidden="true">
            <defs>
              <pattern id={`rope-${ropeId}`} width="10" height="18" patternUnits="userSpaceOnUse" patternTransform="skewX(-25)">
                <rect width="10" height="18" fill="#C9A227" />
                <rect width="4" height="18" fill="#8A6D12" />
              </pattern>
            </defs>
            <rect y="1" width="100%" height="16" rx="8" fill={`url(#rope-${ropeId})`} />
            <rect y="1" width="100%" height="6" rx="3" fill="rgba(255,255,255,0.18)" />
          </svg>

          <div className="tow-midline" aria-hidden="true" />

          <div className="tow-marker" style={{ left: `${(1 - pull) * 100}%`, transitionDuration: `${dur}ms` }}>
            {fx.kind === "good" && <span key={`g${fx.n}`} className="tow-glow" />}
            {fx.kind === "bad" && (
              <span key={`s${fx.n}`} className="tow-sparks">
                {Array.from({ length: 8 }, (_, i) => <i key={i} style={{ "--a": `${i * 45}deg` }} />)}
              </span>
            )}
            <span className="tow-flag" />
            <span className="tow-diamond" />
          </div>
        </div>

        <div className="tow-fighter tow-robot" aria-hidden="true">
          <span key={`r${fx.n}`} className={`tow-emoji${robotAnim ? ` tow-${robotAnim}` : ""}`}>{robotAvatar}</span>
        </div>
      </div>

      <div className="tow-meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <p className="tow-status" aria-live="polite">{status}</p>
    </section>
  );
});

export default TugOfWarArena;

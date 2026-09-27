"""
SignalGate: verhindert Signalflackern - Teil des gemeinsamen Kerns (Live und Backtest).

  * Bestaetigung (confirmation): ein Kandidat muss in N aufeinanderfolgenden
    Auswertungen bestehen, sonst WATCH ("Bestaetigung ausstehend").
  * Hysterese: ein aktiver Kandidat bleibt aktiv, solange die Signalstaerke
    ueber der AUSTRITTS-Schwelle (50) liegt - kein Wechsel Kandidat/WATCH/Kandidat
    bei Werten um 60.
  * Cooldown: nach dem Ende eines Kandidaten keine neue Einstiegsidee derselben
    Strategie im selben Instrument fuer die Cooldown-Dauer.
  * Deduplizierung: das Protokoll (orchestrator._should_record) schreibt nur Aenderungen.

Zustand liegt im Speicher und wird beim Start aus dem Signal-Protokoll
vorgewaermt (letzte Kandidaten -> Cooldown), damit ein Neustart keine
Sofort-Wiedereinstiege erzeugt.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta

from .domain import Decision, StrategyEvaluation

CANDIDATES = (Decision.LONG_CANDIDATE, Decision.SHORT_CANDIDATE)


@dataclass(frozen=True)
class GatePolicy:
    confirmations: int
    cooldown: timedelta
    exit_strength: float = 50.0


DEFAULT_POLICIES = {
    # Intraday: Auswertung jede Minute -> zwei in Folge
    "intraday": GatePolicy(confirmations=2, cooldown=timedelta(minutes=30)),
    # Tagesbasis: eine Auswertung je Tag, Bestaetigung waere ein ganzer Tag Verzug
    "swing": GatePolicy(confirmations=1, cooldown=timedelta(days=1)),
    "position": GatePolicy(confirmations=1, cooldown=timedelta(days=3)),
}


@dataclass
class _KeyState:
    streak: int = 0
    active: bool = False
    direction: str | None = None
    cooldown_until: datetime | None = None


@dataclass
class GateResult:
    evaluation: StrategyEvaluation
    suppress: bool = False  # aktiver Kandidat haelt an (Hysterese) -> kein neuer Eintrag, keine neue Order
    note: str | None = None


@dataclass
class SignalGate:
    policies: dict[str, GatePolicy] = field(default_factory=lambda: dict(DEFAULT_POLICIES))
    _state: dict[tuple[str, str], _KeyState] = field(default_factory=dict)

    def warm_start(self, conn, now: datetime) -> int:
        """Cooldowns aus dem Protokoll wiederherstellen (nach Neustart)."""
        rows = conn.execute(
            """SELECT DISTINCT ON (instrument_id, strategy_id) instrument_id, strategy_id, time_horizon, created_at, direction
               FROM signals WHERE decision IN ('LONG_CANDIDATE','SHORT_CANDIDATE') AND created_at >= %s
               ORDER BY instrument_id, strategy_id, created_at DESC""", (now - timedelta(days=7),)).fetchall()
        for r in rows:
            policy = self.policies[r["time_horizon"]]
            until = r["created_at"] + policy.cooldown
            if until > now:
                self._state[(r["instrument_id"], r["strategy_id"])] = _KeyState(cooldown_until=until, direction=r["direction"])
        return len(rows)

    def apply(self, ev: StrategyEvaluation, now: datetime) -> GateResult:
        policy = self.policies[ev.horizon]
        st = self._state.setdefault((ev.instrument_id, ev.strategy_id), _KeyState())
        is_cand = ev.decision in CANDIDATES

        if st.active:
            if is_cand or (ev.strength >= policy.exit_strength and ev.direction == st.direction and ev.decision == Decision.WATCH):
                # Hysterese: weiterhin aktiv, nichts Neues protokollieren oder handeln
                return GateResult(ev, suppress=True, note="aktiv (Hysterese)")
            st.active, st.streak = False, 0
            st.cooldown_until = now + policy.cooldown
            return GateResult(ev, note=f"Kandidat beendet, Cooldown bis {st.cooldown_until:%Y-%m-%d %H:%M} UTC")

        if not is_cand:
            st.streak = 0
            return GateResult(ev)

        st.streak = st.streak + 1 if st.direction == ev.direction else 1
        st.direction = ev.direction
        if st.cooldown_until is not None and now < st.cooldown_until:
            return GateResult(_watch(ev, f"Cooldown nach letztem Signal bis {st.cooldown_until:%Y-%m-%d %H:%M} UTC"), note="cooldown")
        if st.streak < policy.confirmations:
            return GateResult(_watch(ev, f"Bestätigung ausstehend ({st.streak}/{policy.confirmations} Auswertungen)"), note="confirmation")
        st.active = True
        st.cooldown_until = None
        return GateResult(ev, note="bestätigt")


def _watch(ev: StrategyEvaluation, reason: str) -> StrategyEvaluation:
    return replace(ev, decision=Decision.WATCH, reasons=(reason, *ev.reasons),
                   summary="Setup interessant, aber Bestätigung fehlt. " + ev.summary)

"""
Backtest mit DEMSELBEN Kern wie der Live-Bot.

    Historical Replay Adapter (Provider-Schnittstellen, Simulationsuhr)
        -> BotOrchestrator (Ingestion, Data Quality, Features, Regime, Strategien,
           Signal Gate, Risk Engine, Execution Model, Paper-Konto, Audit)
        -> eigene Backtest-Datenbank -> Report

Es gibt keine separate, vereinfachte Backtest-Strategie.
"""

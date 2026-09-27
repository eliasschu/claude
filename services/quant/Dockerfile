# Ein Image fuer api, bot-worker und scheduler - der Befehl entscheidet die Rolle.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN useradd --create-home --uid 10001 quant
COPY pyproject.toml ./
COPY quant ./quant
RUN pip install .
USER quant
# Standard: API. Worker/Scheduler setzen in docker-compose einen eigenen Befehl.
CMD ["uvicorn", "quant.api:app", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS test
USER root
RUN pip install ".[dev]"
COPY tests ./tests
USER quant
CMD ["pytest", "-q"]

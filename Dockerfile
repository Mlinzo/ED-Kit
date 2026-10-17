# ED Explorer Kit in a container: the game's journal folder is mounted read-only at /journals,
# the database lives in the /data volume. Usage: see docker-compose.yml and README.md.

FROM node:22-slim AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.15 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY backend/app ./app
COPY --from=web /src/frontend/dist /app/frontend/dist

RUN useradd --create-home --uid 1000 edk && mkdir /data && chown edk /data
USER edk
ENV PATH="/app/backend/.venv/bin:$PATH" \
    EDEK_JOURNAL_DIR=/journals \
    EDEK_DATA_DIR=/data
VOLUME /data
EXPOSE 8765
CMD ["python", "-m", "app.main", "--host", "0.0.0.0"]

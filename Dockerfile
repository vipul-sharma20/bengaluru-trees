FROM node:22-slim AS client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html analytics.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=3000
COPY requirements.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY server.py gunicorn.conf.py ./
COPY --from=client /app/dist ./dist
RUN python -m whitenoise.compress dist
COPY data/trees.sqlite ./data/trees.sqlite
USER 65534:65534
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3000/healthz', timeout=5).read()"
CMD ["gunicorn", "--config", "gunicorn.conf.py", "server:app"]

FROM python:3.12-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

ENV PORT=5001
EXPOSE 5001

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-5001}"]

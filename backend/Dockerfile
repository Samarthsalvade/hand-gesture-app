FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip uninstall -y opencv-python opencv-contrib-python 2>/dev/null || true && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Use shell form (not JSON array) so $PORT gets expanded by the shell
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
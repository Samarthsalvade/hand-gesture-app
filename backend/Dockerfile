FROM python:3.12-slim

# System libs needed by mediapipe + opencv-headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip uninstall -y opencv-python opencv-contrib-python 2>/dev/null || true && \
    pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
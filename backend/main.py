import asyncio
import base64
import json
import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import cv2
from gesture_processor import GestureProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Shared processor (loaded once at startup) ─────────────────────────────
processor: GestureProcessor = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global processor
    logger.info("Starting up — loading GestureProcessor…")
    processor = GestureProcessor()   # downloads model here if needed
    logger.info("GestureProcessor ready.")
    yield
    logger.info("Shutting down.")
    if processor:
        processor.close()


app = FastAPI(title="Hand Gesture API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── HTTP endpoints ─────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "Hand Gesture API running", "ts": time.time()}


@app.get("/health")
async def health():
    """Keep-alive endpoint pinged every 25 s by the frontend."""
    return {"status": "ok", "ts": time.time()}


# ── WebSocket ──────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Client connected")
    try:
        while True:
            data    = await websocket.receive_text()
            message = json.loads(data)
            mtype   = message.get("type")

            if mtype == "frame":
                frame_data = message.get("frame", "")
                mode       = message.get("mode", "particles")
                if not frame_data:
                    continue

                # Decode base64 → numpy frame
                img_bytes = base64.b64decode(frame_data.split(",")[-1])
                nparr     = np.frombuffer(img_bytes, np.uint8)
                frame     = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if frame is None:
                    continue

                result = processor.process_frame(frame, mode)

                _, buf = cv2.imencode(".jpg", result["frame"],
                                     [cv2.IMWRITE_JPEG_QUALITY, 75])
                b64 = base64.b64encode(buf).decode()

                await websocket.send_text(json.dumps({
                    "type":  "frame_result",
                    "frame": f"data:image/jpeg;base64,{b64}",
                    "hands": result["hands"],
                    "fps":   result["fps"],
                    "mode":  mode,
                }))

            elif mtype == "clear":
                processor.clear_effects()
                await websocket.send_text(json.dumps({"type": "cleared"}))

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WS error: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
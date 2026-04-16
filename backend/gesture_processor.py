import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode
import math
import time
import os
import urllib.request

WRIST = 0
THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 1, 2, 3, 4
INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP = 5, 6, 7, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP = 9, 10, 11, 12
RING_MCP, RING_PIP, RING_DIP, RING_TIP = 13, 14, 15, 16
PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP = 17, 18, 19, 20

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hand_landmarker.task")
MODEL_URL  = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"


def ensure_model():
    if os.path.exists(MODEL_PATH) and os.path.getsize(MODEL_PATH) > 100_000:
        return True
    print("[GestureProcessor] Downloading hand landmark model (~8MB)…")
    try:
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        size = os.path.getsize(MODEL_PATH)
        print(f"[GestureProcessor] Model ready: {size/1024/1024:.1f} MB")
        return size > 100_000
    except Exception as e:
        print(f"[GestureProcessor] Download failed: {e}")
        return False


class GestureProcessor:
    def __init__(self):
        ensure_model()
        opts = HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=RunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.detector = HandLandmarker.create_from_options(opts)

        self.particles    = []
        self.trails       = []
        self.magic_circles = []
        self.sparks       = []
        self.portal_phase = 0.0
        self.colors = [
            (255,0,0),(0,255,0),(0,0,255),(255,255,0),
            (255,0,255),(0,255,255),(255,128,0),(128,0,255),(0,255,128),
        ]
        self.frequency = 440
        self.volume    = 0.5
        self.fps       = 0.0
        self.frame_count = 0
        self.start_time  = time.time()

    def close(self):
        self.detector.close()

    def clear_effects(self):
        self.particles     = []
        self.trails        = []
        self.magic_circles = []
        self.sparks        = []

    # ── Detection ────────────────────────────────────────────────────────────

    def detect(self, frame_bgr):
        h, w = frame_bgr.shape[:2]
        rgb  = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result   = self.detector.detect(mp_image)
        hands = []
        for i, lm in enumerate(result.hand_landmarks):
            label = "Right"
            if i < len(result.handedness) and result.handedness[i]:
                label = result.handedness[i][0].display_name
            fingers = self._count_fingers(lm, label)
            cx = int((lm[WRIST].x + lm[MIDDLE_MCP].x) / 2 * w)
            cy = int((lm[WRIST].y + lm[MIDDLE_MCP].y) / 2 * h)
            hands.append({
                "handedness": label, "fingers": fingers,
                "gesture": self._recognize_gesture(fingers),
                "special_gesture": self._detect_special(lm),
                "center": (cx, cy), "landmarks": lm, "w": w, "h": h,
            })
        return hands

    def _count_fingers(self, lm, handedness):
        count = 0
        if handedness == "Right":
            if lm[THUMB_TIP].x < lm[THUMB_CMC].x - 0.04: count += 1
        else:
            if lm[THUMB_TIP].x > lm[THUMB_CMC].x + 0.04: count += 1
        for tip, pip in [(INDEX_TIP,INDEX_PIP),(MIDDLE_TIP,MIDDLE_PIP),
                         (RING_TIP,RING_PIP),(PINKY_TIP,PINKY_PIP)]:
            if lm[tip].y < lm[pip].y: count += 1
        return count

    def _recognize_gesture(self, n):
        return {0:"Fist",1:"One",2:"Peace",3:"Three",4:"Four",5:"High Five"}.get(n,"Unknown")

    def _detect_special(self, lm):
        if math.hypot(lm[THUMB_TIP].x-lm[INDEX_TIP].x, lm[THUMB_TIP].y-lm[INDEX_TIP].y) < 0.04:
            return "OK Sign"
        if (lm[INDEX_TIP].y < lm[INDEX_PIP].y and lm[MIDDLE_TIP].y < lm[MIDDLE_PIP].y
                and lm[RING_TIP].y > lm[RING_PIP].y):
            return "Peace Sign"
        return None

    # ── Render effects on TRANSPARENT canvas ─────────────────────────────────

    def render_effects(self, frame_bgr, mode):
        """Returns a transparent RGBA overlay with only the visual effects — no video."""
        h, w = frame_bgr.shape[:2]
        # Transparent black canvas
        overlay = np.zeros((h, w, 4), dtype=np.uint8)

        hands = self.detect(frame_bgr)

        if hands:
            primary = hands[0]
            cx, cy  = primary["center"]
            fingers = primary["fingers"]

            if mode == "particles":
                self._update_particles((cx,cy), fingers, (h,w))
                self._draw_particles_rgba(overlay)

            elif mode == "music":
                self._draw_music_rgba((cx,cy), fingers, overlay)

            elif mode == "drawing":
                self._update_drawing((cx,cy), fingers, overlay)

            elif mode == "strange":
                self._update_strange(hands, (h,w))
                self._draw_strange_rgba(overlay, hands)

        self.frame_count += 1
        if self.frame_count % 30 == 0:
            self.fps = self.frame_count / (time.time() - self.start_time)

        serial = [{"handedness":h["handedness"],"fingers":h["fingers"],
                   "gesture":h["gesture"],"special_gesture":h.get("special_gesture"),
                   "center":list(h["center"])} for h in hands]
        return overlay, serial, self.fps

    # ── Particles ────────────────────────────────────────────────────────────

    def _update_particles(self, center, fingers, shape):
        h, w = shape
        cx, cy = center
        for _ in range((fingers+1)*3):
            a = np.random.uniform(0, 2*math.pi)
            s = np.random.uniform(3, 12)
            self.particles.append({
                "x":float(cx),"y":float(cy),
                "vx":math.cos(a)*s,"vy":math.sin(a)*s,
                "color":self.colors[np.random.randint(len(self.colors))],
                "life":70,"size":int(np.random.randint(3,9)),
            })
        updated = []
        for p in self.particles:
            p["x"]+=p["vx"]; p["y"]+=p["vy"]
            p["vy"]+=0.4; p["vx"]*=0.98; p["life"]-=1
            if 0<=p["x"]<w and 0<=p["y"]<h and p["life"]>0:
                updated.append(p)
        self.particles = updated

    def _draw_particles_rgba(self, canvas):
        for p in self.particles:
            a   = p["life"] / 70.0
            col = (*p["color"], int(255*a))          # BGRA
            cv2.circle(canvas, (int(p["x"]),int(p["y"])), p["size"], col, -1)
            glow = (*p["color"], int(80*a))
            cv2.circle(canvas, (int(p["x"]),int(p["y"])), p["size"]+5, glow, 2)

    # ── Music ─────────────────────────────────────────────────────────────────

    def _draw_music_rgba(self, center, fingers, canvas):
        h, w = canvas.shape[:2]
        cx, cy = center
        self.frequency = int(200+(1-cy/h)*1200)
        self.volume    = fingers/5.0
        bw = w//40
        for i in range(40):
            phase = (time.time()*self.frequency/60+i*0.2)%(2*math.pi)
            bh    = int(100+120*math.sin(phase)*self.volume)
            hue   = (self.frequency-200)/1200.0
            if hue < 0.33:   col = (255,int(hue*3*255),0,180)
            elif hue < 0.66: col = (int((0.66-hue)*3*255),255,0,180)
            else:             col = (0,int((1-hue)*3*255),255,180)
            cv2.rectangle(canvas,(i*bw,h-bh),(i*bw+bw-2,h),col,-1)
        pts=[]
        for i in range(64):
            ang = (i/64)*2*math.pi
            r   = 70+int(self.volume*70)+20*math.sin(ang*8+time.time()*10)*self.volume
            pts.append((int(cx+r*math.cos(ang)),int(cy+r*math.sin(ang))))
        for i in range(len(pts)):
            cv2.line(canvas,pts[i],pts[(i+1)%len(pts)],(255,255,255,220),4)
        cv2.circle(canvas,(cx,cy),15,(255,0,255,255),-1)

    # ── Drawing ───────────────────────────────────────────────────────────────

    def _update_drawing(self, center, fingers, canvas):
        if fingers > 0:
            self.trails.append({
                "pos":center,
                "color":self.colors[fingers%len(self.colors)],
                "size":fingers*4+3
            })
            if len(self.trails) > 200: self.trails.pop(0)
        for i, t in enumerate(self.trails):
            a   = (i+1)/max(len(self.trails),1)
            col = (*t["color"], int(255*a))
            cv2.circle(canvas, t["pos"], t["size"], col, -1)

    # ── Strange ───────────────────────────────────────────────────────────────

    def _update_strange(self, hands, shape):
        h, w = shape
        for c in self.magic_circles:
            c["rotation"]+=c["rotation_speed"]*0.05; c["life"]-=1; c["pulse_phase"]+=0.1
        self.magic_circles = [c for c in self.magic_circles if c["life"]>0]

        for hand in hands:
            fingers, center = hand["fingers"], hand["center"]
            if len(self.magic_circles) < 10:
                cols = [(0,165,255),(0,165,255),(0,165,255),(0,255,255),(255,150,0),(180,0,255)]
                self.magic_circles.append({
                    "center":center,"radius":60+fingers*15,
                    "color":cols[min(fingers,5)],
                    "rotation":0.0,"rotation_speed":float(np.random.uniform(-2,2)),
                    "complexity":2+fingers//2,"life":100,
                    "pulse_phase":float(np.random.uniform(0,2*math.pi)),
                })
            lm = hand["landmarks"]
            if fingers > 0:
                for ti in [THUMB_TIP,INDEX_TIP,MIDDLE_TIP,RING_TIP,PINKY_TIP][:fingers]:
                    tp = (int(lm[ti].x*w),int(lm[ti].y*h))
                    if np.random.random()<0.3:
                        a   = float(np.random.uniform(0,2*math.pi))
                        spd = float(np.random.uniform(8,15))
                        self.sparks.append({
                            "x":float(tp[0]),"y":float(tp[1]),
                            "vx":math.cos(a)*spd,"vy":math.sin(a)*spd,
                            "life":int(np.random.randint(20,40)),
                            "color":(0,200+int(np.random.randint(55)),255),
                            "size":int(np.random.randint(2,5)),
                        })
        updated=[]
        for s in self.sparks:
            s["x"]+=s["vx"]; s["y"]+=s["vy"]; s["vy"]+=0.3; s["vx"]*=0.97; s["life"]-=1
            if 0<=s["x"]<w and 0<=s["y"]<h and s["life"]>0: updated.append(s)
        self.sparks=updated

    def _draw_strange_rgba(self, canvas, hands):
        for c in self.magic_circles: self._draw_magic_circle_rgba(canvas, c)
        for s in self.sparks:
            a   = s["life"]/40.0
            col = (*s["color"], int(255*a))
            cv2.circle(canvas,(int(s["x"]),int(s["y"])),s["size"],col,-1)
            glow = (*s["color"], int(80*a))
            cv2.circle(canvas,(int(s["x"]),int(s["y"])),s["size"]+3,glow,1)
        for hand in hands:
            if hand["fingers"]==5: self._draw_portal_rgba(canvas, hand["center"])

    def _draw_magic_circle_rgba(self, canvas, c):
        try:
            cx,cy = c["center"]
            r     = int(c["radius"]*(1+0.15*math.sin(c["pulse_phase"]+time.time()*3)))
            col   = (*c["color"], 200)
            rot   = c["rotation"]
            n     = 12*c["complexity"]
            for i in range(5):
                cv2.circle(canvas,(cx,cy),int(r*(1-i*0.15)),
                           (*c["color"],int(200*(0.8-i*0.15))),2 if i%2==0 else 1)
            outer=[(int(cx+r*math.cos((i/n)*2*math.pi+rot)),int(cy+r*math.sin((i/n)*2*math.pi+rot))) for i in range(n)]
            inner=[(int(cx+r*0.6*math.cos((i/n)*2*math.pi+rot)),int(cy+r*0.6*math.sin((i/n)*2*math.pi+rot))) for i in range(n)]
            for i in range(0,n,2):
                cv2.line(canvas,outer[i],inner[i],col,1)
                if i+3<n: cv2.line(canvas,outer[i],outer[i+3],(*c["color"],100),1)
            for i in range(8):
                a  = (i/8)*2*math.pi+rot*0.5
                rx = int(cx+r*1.2*math.cos(a)); ry = int(cy+r*1.2*math.sin(a))
                cv2.circle(canvas,(rx,ry),4,col,1)
                cv2.line(canvas,(rx-8,ry),(rx+8,ry),col,1)
                cv2.line(canvas,(rx,ry-8),(rx,ry+8),col,1)
            cv2.circle(canvas,(cx,cy),int(r*0.3),(*c["color"],80),-1)
            cv2.circle(canvas,(cx,cy),int(r*0.15),(*c["color"],150),-1)
        except Exception: pass

    def _draw_portal_rgba(self, canvas, center):
        cx,cy = center
        self.portal_phase += 0.1
        for ring in range(5):
            radius = 80+ring*25
            for i in range(32):
                if i%2==0:
                    a1=(i/32)*2*math.pi+self.portal_phase*(1+ring*0.2)
                    a2=((i+1)/32)*2*math.pi+self.portal_phase*(1+ring*0.2)
                    ci = 1-ring/5
                    cv2.line(canvas,
                             (int(cx+radius*math.cos(a1)),int(cy+radius*math.sin(a1))),
                             (int(cx+radius*math.cos(a2)),int(cy+radius*math.sin(a2))),
                             (0,int(180*ci),int(255*ci),220),3)

    # ── Legacy process_frame kept for compatibility ───────────────────────────

    def process_frame(self, frame, mode="particles"):
        overlay, hands, fps = self.render_effects(frame, mode)
        # Convert RGBA overlay to BGR for encoding
        overlay_bgr = cv2.cvtColor(overlay, cv2.COLOR_RGBA2BGR)
        return {"frame": overlay_bgr, "hands": hands, "fps": fps}
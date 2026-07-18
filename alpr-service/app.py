"""
ParkLane ALPR — single-flight OCR with hard process timeouts.
Optimized for webcam demos (phone screen → camera).
"""

from __future__ import annotations

import base64
import io
import os
import re
import subprocess
import tempfile
import threading
import time
from typing import Optional

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw, ImageFont

app = FastAPI(title="ParkLane ALPR", version="1.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OCR_LOCK = threading.Lock()
TESSERACT_BIN = os.environ.get("TESSERACT_CMD", "tesseract")
OCR_TIMEOUT_SEC = float(os.environ.get("OCR_TIMEOUT_SEC", "4"))


class ScanRequest(BaseModel):
    imageBase64: Optional[str] = None
    hint: Optional[str] = None
    knownPlates: list[str] = Field(default_factory=list)


class ScanResponse(BaseModel):
    plate: Optional[str] = None
    confidence: float = 0.0
    candidates: list[str] = Field(default_factory=list)
    rawText: str = ""
    engine: str = "tesseract"
    message: str = ""


def normalize_plate(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def decode_image(image_base64: str) -> np.ndarray:
    raw = image_base64.split(",")[-1]
    data = base64.b64decode(raw)
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    h, w = img.shape[:2]
    if max(h, w) > 720:
        scale = 720 / max(h, w)
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return img


def run_tesseract(img: np.ndarray, psm: int = 7) -> str:
    """Run tesseract in a subprocess with a hard kill timeout."""
    if img is None or img.size == 0:
        return ""
    with tempfile.TemporaryDirectory(prefix="plocr_") as td:
        in_path = os.path.join(td, "in.png")
        out_base = os.path.join(td, "out")
        cv2.imwrite(in_path, img)
        cmd = [
            TESSERACT_BIN,
            in_path,
            out_base,
            "--oem",
            "1",
            "--psm",
            str(psm),
            "-c",
            "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        ]
        try:
            proc = subprocess.run(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=OCR_TIMEOUT_SEC,
                check=False,
            )
            if proc.returncode != 0:
                return ""
            txt_path = out_base + ".txt"
            if not os.path.exists(txt_path):
                return ""
            with open(txt_path, "r", encoding="utf-8", errors="ignore") as fh:
                return fh.read()
        except subprocess.TimeoutExpired:
            return ""
        except Exception:  # noqa: BLE001
            return ""


def extract_candidates(text: str) -> list[str]:
    upper = (text or "").upper()
    found = []
    for match in re.findall(r"[A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{3,4}", upper):
        p = normalize_plate(match)
        if 6 <= len(p) <= 12:
            found.append(p)
    compact = normalize_plate(upper)
    # sliding windows from noisy OCR blobs
    if len(compact) >= 6:
        found.append(compact)
        for n in (10, 9, 8):
            for i in range(0, max(0, len(compact) - n + 1)):
                found.append(compact[i : i + n])
    out, seen = [], set()
    for p in found:
        if 6 <= len(p) <= 12 and p not in seen:
            seen.add(p)
            out.append(p)
    return out


CONFUSABLES = str.maketrans(
    {
        "O": "0",
        "I": "1",
        "L": "1",
        "S": "5",
        "B": "8",
        "Z": "2",
        "G": "6",
    }
)


def loose(text: str) -> str:
    return normalize_plate(text).translate(CONFUSABLES)


def near_eq(a: str, b: str) -> bool:
    """Same length, at most 1 confusable/typo — no loose sliding fuzzy."""
    a, b = normalize_plate(a), normalize_plate(b)
    if a == b:
        return True
    if len(a) != len(b) or len(a) < 8:
        return False
    la, lb = loose(a), loose(b)
    if la == lb:
        return True
    return sum(x != y for x, y in zip(a, b)) <= 1


def match_known(raw_text: str, candidates: list[str], known_plates: list[str]) -> Optional[str]:
    blob = normalize_plate(raw_text + "".join(candidates))
    known = [normalize_plate(k) for k in known_plates if normalize_plate(k)]
    # Exact full-plate substring only (prevents empty-camera phantom matches)
    for k in known:
        if len(k) >= 8 and k in blob:
            return k
    for cand in candidates:
        for k in known:
            if near_eq(cand, k):
                return k
    return None


def variants(img: np.ndarray) -> list[np.ndarray]:
    """A few fast preprocess variants aimed at phone-LCD → webcam."""
    h, w = img.shape[:2]
    # Prefer center band (matches yellow guide). If already cropped, this is still fine.
    x1, y1, x2, y2 = int(w * 0.05), int(h * 0.18), int(w * 0.95), int(h * 0.82)
    crop = img[y1:y2, x1:x2] if x2 > x1 and y2 > y1 else img

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    # boost contrast for dull phone screens
    gray = cv2.convertScaleAbs(gray, alpha=1.55, beta=18)
    clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(8, 8)).apply(gray)
    scale = max(1.2, 640 / max(clahe.shape[:2]))
    big = cv2.resize(clahe, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    blur = cv2.GaussianBlur(big, (3, 3), 0)

    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    adap = cv2.adaptiveThreshold(
        blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 7
    )
    inv = cv2.bitwise_not(otsu)

    # Keep only 3 variants — speed over coverage
    return [otsu, adap, inv]


def ocr_image(img: np.ndarray, known_plates: list[str]):
    texts: list[str] = []
    candidates: list[str] = []

    for idx, prep in enumerate(variants(img)):
        # One PSM per variant; stop early on known match
        psm = 7 if idx == 0 else 6
        text = run_tesseract(prep, psm=psm)
        if not text.strip():
            continue
        texts.append(text)
        candidates = list(dict.fromkeys(candidates + extract_candidates(text)))
        hit = match_known(text, candidates, known_plates)
        if hit:
            return hit, 0.95, candidates[:8], text, "tesseract+known"

    raw = " ".join(texts).strip()
    hit = match_known(raw, candidates, known_plates)
    if hit:
        return hit, 0.92, candidates[:8], raw, "tesseract+known"
    # Guest: only strict Indian shape (GJ01YK1001), never OCR gibberish
    indian = re.compile(r"^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$")
    for cand in candidates:
        if indian.match(cand):
            return cand, 0.86, candidates[:8], raw, "tesseract"
    return None, 0.0, candidates[:8], raw, "tesseract"


@app.get("/health")
def health():
    return {"ok": True, "service": "parklane-alpr", "version": "1.4.0"}


@app.post("/scan", response_model=ScanResponse)
def scan(req: ScanRequest):
    t0 = time.time()
    if req.hint:
        plate = normalize_plate(req.hint)
        return ScanResponse(
            plate=plate,
            confidence=0.99,
            candidates=[plate],
            engine="hint",
            message="Plate provided by hint",
        )

    if not req.imageBase64:
        return ScanResponse(message="imageBase64 is required", confidence=0.0)

    # single-flight: never pile up tesseract workers
    if not OCR_LOCK.acquire(blocking=False):
        return ScanResponse(
            message="Scanner busy — hold plate steady…",
            confidence=0.0,
            engine="busy",
        )

    try:
        try:
            img = decode_image(req.imageBase64)
        except Exception as exc:  # noqa: BLE001
            return ScanResponse(message=f"Invalid image: {exc}", confidence=0.0)

        plate, confidence, candidates, raw_text, engine = ocr_image(img, req.knownPlates or [])
        elapsed = round(time.time() - t0, 2)
        if not plate:
            return ScanResponse(
                message=f"No plate yet ({elapsed}s) — fill yellow box, max phone brightness, hold 2s",
                confidence=0.0,
                candidates=[],
                rawText=(raw_text or "")[:300],
                engine=engine,
            )
        return ScanResponse(
            plate=plate,
            confidence=confidence,
            candidates=candidates,
            rawText=(raw_text or "")[:300],
            engine=engine,
            message=(f"Matched {plate} in {elapsed}s" if "known" in engine else f"Plate detected in {elapsed}s"),
        )
    finally:
        OCR_LOCK.release()


@app.post("/demo-plate-image")
def demo_plate_image(payload: dict):
    plate = normalize_plate(payload.get("plate", "GJ01YK1001"))
    pretty = f"{plate[:2]} {plate[2:4]} {plate[4:6]} {plate[6:]}" if len(plate) >= 10 else plate
    img = Image.new("RGB", (900, 260), (230, 230, 230))
    draw = ImageDraw.Draw(img)
    draw.rectangle((16, 16, 884, 244), outline=(15, 15, 15), width=8)
    draw.rectangle((30, 30, 870, 230), fill=(255, 255, 255), outline=(25, 25, 25), width=3)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()
    draw.text((60, 90), pretty, fill=(0, 0, 0), font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {"plate": plate, "imageBase64": f"data:image/png;base64,{b64}"}


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=5001, reload=False)

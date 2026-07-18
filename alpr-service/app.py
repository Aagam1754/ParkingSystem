"""
ParkLane ALPR — fast webcam OCR with registered-plate matching.
Kept intentionally light so requests finish under a few seconds.
"""

from __future__ import annotations

import base64
import io
import re
from typing import Optional

import cv2
import numpy as np
import pytesseract
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw, ImageFont

app = FastAPI(title="ParkLane ALPR", version="1.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    # downscale huge frames for speed
    h, w = img.shape[:2]
    if max(h, w) > 1000:
        scale = 1000 / max(h, w)
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return img


def safe_ocr(img: np.ndarray, psm: int = 7) -> str:
    cfg = f"--oem 3 --psm {psm} -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    try:
        return pytesseract.image_to_string(img, config=cfg) or ""
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
    for i in range(0, max(0, len(compact) - 5)):
        chunk = compact[i : i + 10]
        if 8 <= len(chunk) <= 11 and re.search(r"[A-Z]{2}", chunk) and re.search(r"\d{3,}", chunk):
            found.append(chunk)
    out, seen = [], set()
    for p in found:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def match_known(raw_text: str, candidates: list[str], known_plates: list[str]) -> Optional[str]:
    blob = normalize_plate(raw_text + "".join(candidates))
    known = [normalize_plate(k) for k in known_plates if normalize_plate(k)]
    for k in known:
        if k and k in blob:
            return k
    for cand in candidates:
        c = normalize_plate(cand)
        for k in known:
            if c == k:
                return k
            if len(c) == len(k) and sum(a != b for a, b in zip(c, k)) <= 2:
                return k
    return None


def build_variants(img: np.ndarray) -> list[np.ndarray]:
    h, w = img.shape[:2]
    # center / guide crops only (fast)
    boxes = [
        (0, 0, w, h),
        (int(w * 0.1), int(h * 0.3), int(w * 0.9), int(h * 0.75)),
        (int(w * 0.18), int(h * 0.38), int(w * 0.82), int(h * 0.68)),
    ]
    variants = []
    for x1, y1, x2, y2 in boxes:
        crop = img[y1:y2, x1:x2]
        if crop.size == 0:
            continue
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.convertScaleAbs(gray, alpha=1.35, beta=8)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
        # modest upscale
        scale = max(1.2, 900 / max(clahe.shape[:2]))
        big = cv2.resize(clahe, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        variants.append(big)
        thr = cv2.adaptiveThreshold(
            big, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 5
        )
        variants.append(thr)
    return variants[:6]  # hard cap


def ocr_image(img: np.ndarray, known_plates: list[str]):
    raw_chunks: list[str] = []
    candidates: list[str] = []

    for variant in build_variants(img):
        for psm in (7, 6):
            text = safe_ocr(variant, psm=psm)
            if text.strip():
                raw_chunks.append(text.strip())
                candidates.extend(extract_candidates(text))
            raw = " ".join(raw_chunks)
            hit = match_known(raw, candidates, known_plates)
            if hit:
                return hit, 0.95, list(dict.fromkeys(candidates))[:8], raw, "tesseract+known"

    raw = " ".join(raw_chunks)
    candidates = list(dict.fromkeys(candidates))
    if candidates:
        return candidates[0], 0.8, candidates[:8], raw, "tesseract"
    return None, 0.0, [], raw, "tesseract"


@app.get("/health")
def health():
    return {"ok": True, "service": "parklane-alpr"}


@app.post("/scan", response_model=ScanResponse)
def scan(req: ScanRequest):
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

    try:
        img = decode_image(req.imageBase64)
    except Exception as exc:  # noqa: BLE001
        return ScanResponse(message=f"Invalid image: {exc}", confidence=0.0)

    plate, confidence, candidates, raw_text, engine = ocr_image(img, req.knownPlates or [])
    if not plate:
        return ScanResponse(
            message="No number plate detected. Fill the yellow box and hold steady.",
            confidence=0.0,
            candidates=[],
            rawText=raw_text[:400],
        )

    return ScanResponse(
        plate=plate,
        confidence=confidence,
        candidates=candidates,
        rawText=raw_text[:400],
        engine=engine,
        message=("Matched registered plate " + plate) if engine.endswith("known") else "Plate detected",
    )


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

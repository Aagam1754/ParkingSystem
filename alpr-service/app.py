"""
ParkLane ALPR microservice
- Accepts webcam frame (base64)
- Reads number plate text with OpenCV + Tesseract
- Returns normalized plate + confidence
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

app = FastAPI(title="ParkLane ALPR", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PLATE_REGEXES = [
    re.compile(r"\b([A-Z]{2}\d{1,2}[A-Z]{1,3}\d{3,4})\b"),
    re.compile(r"\b([A-Z]{2}\d{2}[A-Z]{2}\d{4})\b"),
    re.compile(r"\b([A-Z0-9]{6,12})\b"),
]


class ScanRequest(BaseModel):
    imageBase64: Optional[str] = None
    hint: Optional[str] = None


class ScanResponse(BaseModel):
    plate: Optional[str] = None
    confidence: float = 0.0
    candidates: list[str] = Field(default_factory=list)
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
    return img


def preprocess_variants(img: np.ndarray) -> list[np.ndarray]:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 11, 17, 17)
    variants = [gray]

    # upscale small webcam crops
    h, w = gray.shape[:2]
    if max(h, w) < 900:
        scale = 900 / max(h, w)
        variants.append(
            cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        )

    thr = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 7
    )
    variants.append(thr)
    variants.append(cv2.bitwise_not(thr))

    # focus on center band (typical plate position in gate cam)
    ch, cw = gray.shape
    y1, y2 = int(ch * 0.25), int(ch * 0.85)
    x1, x2 = int(cw * 0.1), int(cw * 0.9)
    crop = gray[y1:y2, x1:x2]
    if crop.size:
        variants.append(crop)
        variants.append(cv2.adaptiveThreshold(
            crop, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 21, 5
        ))

    return variants


def extract_candidates(text: str) -> list[str]:
    cleaned = text.upper().replace(" ", "").replace("-", "").replace(".", "")
    found: list[str] = []
    for rx in PLATE_REGEXES:
        for match in rx.findall(text.upper().replace("\n", " ")):
            plate = normalize_plate(match if isinstance(match, str) else "".join(match))
            if 6 <= len(plate) <= 12:
                found.append(plate)
    # also scan compacted blob
    compact = normalize_plate(cleaned)
    for i in range(0, max(0, len(compact) - 5)):
        chunk = compact[i : i + 10]
        if 6 <= len(chunk) <= 12 and re.search(r"[A-Z]", chunk) and re.search(r"\d", chunk):
            found.append(chunk)
    # unique preserve order
    out = []
    seen = set()
    for p in found:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def score_plate(plate: str) -> float:
    score = 0.45
    if re.fullmatch(r"[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{3,4}", plate):
        score = 0.93
    elif re.fullmatch(r"[A-Z]{2}\d{2}[A-Z]{2}\d{4}", plate):
        score = 0.95
    elif re.search(r"[A-Z]{2}", plate) and re.search(r"\d{3,}", plate):
        score = 0.8
    return score


def ocr_image(img: np.ndarray) -> tuple[Optional[str], float, list[str]]:
    configs = [
        "--psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "--psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "--psm 11 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ]
    all_candidates: list[str] = []
    for variant in preprocess_variants(img):
        for cfg in configs:
            text = pytesseract.image_to_string(variant, config=cfg)
            all_candidates.extend(extract_candidates(text))

    if not all_candidates:
        # last resort full image OCR
        text = pytesseract.image_to_string(img)
        all_candidates.extend(extract_candidates(text))

    if not all_candidates:
        return None, 0.0, []

    # prefer best Indian-like plate pattern
    ranked = sorted(all_candidates, key=score_plate, reverse=True)
    best = ranked[0]
    return best, score_plate(best), ranked[:8]


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

    plate, confidence, candidates = ocr_image(img)
    if not plate:
        return ScanResponse(
            message="No number plate detected. Hold plate steady in frame.",
            confidence=0.0,
            candidates=[],
        )

    plate = correct_common_ocr_errors(plate)
    candidates = [correct_common_ocr_errors(c) for c in candidates]

    return ScanResponse(
        plate=plate,
        confidence=confidence,
        candidates=candidates,
        engine="tesseract",
        message="Plate detected",
    )


def correct_common_ocr_errors(plate: str) -> str:
    """Light cleanup for Indian plates after OCR."""
    p = normalize_plate(plate)
    if len(p) < 8:
        return p
    # state code letters
    chars = list(p)
    for i in (0, 1):
        if chars[i] == "0":
            chars[i] = "O"
    # district digits
    for i in (2, 3):
        if i < len(chars) and chars[i] == "O":
            chars[i] = "0"
    return "".join(chars)


@app.post("/demo-plate-image")
def demo_plate_image(payload: dict):
    """Generate a simple plate card image (useful for webcam demos)."""
    plate = normalize_plate(payload.get("plate", "MH12AB1234"))
    # spaced groups help OCR: MH 12 AB 1234
    pretty = plate
    if len(plate) >= 10:
        pretty = f"{plate[:2]} {plate[2:4]} {plate[4:6]} {plate[6:]}"
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

"""
ParkLane ALPR microservice
Webcam frame → OpenCV preprocess → Tesseract → plate text
Also matches against known registered plates when provided.
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

app = FastAPI(title="ParkLane ALPR", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PLATE_REGEXES = [
    re.compile(r"([A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{3,4})"),
    re.compile(r"([A-Z]{2}\d{2}[A-Z]{2}\d{4})"),
    re.compile(r"([A-Z0-9]{6,12})"),
]


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
    return img


def preprocess_variants(img: np.ndarray) -> list[np.ndarray]:
    h, w = img.shape[:2]
    rois = [img]
    # multiple crops — phone may not sit exactly in center guide
    crops = [
        (0.08, 0.25, 0.92, 0.80),
        (0.15, 0.35, 0.85, 0.70),
        (0.05, 0.15, 0.95, 0.90),
        (0.20, 0.40, 0.80, 0.62),
    ]
    for x1r, y1r, x2r, y2r in crops:
        x1, y1, x2, y2 = int(w * x1r), int(h * y1r), int(w * x2r), int(h * y2r)
        if x2 > x1 and y2 > y1:
            rois.append(img[y1:y2, x1:x2])

    variants: list[np.ndarray] = []
    for source in rois:
        gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
        # boost contrast for phone-screen glare
        gray = cv2.convertScaleAbs(gray, alpha=1.4, beta=10)
        gray = cv2.bilateralFilter(gray, 9, 75, 75)
        clahe = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8, 8)).apply(gray)
        sharp = cv2.filter2D(clahe, -1, np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]]))
        variants.append(sharp)

        scale = max(1.5, 1400 / max(sharp.shape[:2]))
        big = cv2.resize(sharp, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        variants.append(big)

        thr = cv2.adaptiveThreshold(
            big, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 5
        )
        variants.append(thr)
        variants.append(cv2.bitwise_not(thr))
        _, otsu = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(otsu)
        variants.append(cv2.bitwise_not(otsu))

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        variants.append(cv2.morphologyEx(thr, cv2.MORPH_CLOSE, kernel))

    return variants


def extract_candidates(text: str) -> list[str]:
    found: list[str] = []
    upper = (text or "").upper()
    for rx in PLATE_REGEXES:
        for match in rx.findall(upper):
            plate = normalize_plate(match if isinstance(match, str) else "".join(match))
            if 6 <= len(plate) <= 12:
                found.append(plate)
    compact = normalize_plate(upper)
    for i in range(0, max(0, len(compact) - 5)):
        chunk = compact[i : i + 10]
        if 6 <= len(chunk) <= 12 and re.search(r"[A-Z]", chunk) and re.search(r"\d", chunk):
            found.append(chunk)
    out: list[str] = []
    seen = set()
    for p in found:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def score_plate(plate: str) -> float:
    if re.fullmatch(r"[A-Z]{2}\d{2}[A-Z]{2}\d{4}", plate):
        return 0.96
    if re.fullmatch(r"[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{3,4}", plate):
        return 0.93
    if re.search(r"[A-Z]{2}", plate) and re.search(r"\d{3,}", plate):
        return 0.8
    return 0.45


def correct_common_ocr_errors(plate: str) -> str:
    p = normalize_plate(plate)
    if len(p) < 8:
        return p
    chars = list(p)
    for i in (0, 1):
        if chars[i] == "0":
            chars[i] = "O"
    for i in (2, 3):
        if i < len(chars) and chars[i] == "O":
            chars[i] = "0"
    return "".join(chars)


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
            # allow 1-2 char mistakes
            if len(c) == len(k):
                diff = sum(1 for a, b in zip(c, k) if a != b)
                if diff <= 2:
                    return k
    return None


def ocr_image(img: np.ndarray) -> tuple[Optional[str], float, list[str], str]:
    configs = [
        "--oem 3 --psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "--oem 3 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "--oem 3 --psm 8 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "--oem 3 --psm 11 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ]
    all_candidates: list[str] = []
    raw_chunks: list[str] = []
    for variant in preprocess_variants(img):
        for cfg in configs:
            text = pytesseract.image_to_string(variant, config=cfg)
            if text and text.strip():
                raw_chunks.append(text.strip())
            all_candidates.extend(extract_candidates(text))

    raw_text = " ".join(raw_chunks)
    if not all_candidates and raw_text:
        all_candidates.extend(extract_candidates(raw_text))

    if not all_candidates:
        return None, 0.0, [], raw_text

    ranked = sorted({correct_common_ocr_errors(c) for c in all_candidates}, key=score_plate, reverse=True)
    best = ranked[0]
    return best, score_plate(best), ranked[:10], raw_text


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

    plate, confidence, candidates, raw_text = ocr_image(img)

    known_hit = match_known(raw_text, candidates, req.knownPlates or [])
    if known_hit:
        return ScanResponse(
            plate=known_hit,
            confidence=max(confidence, 0.92),
            candidates=candidates,
            rawText=raw_text[:500],
            engine="tesseract+known",
            message=f"Matched registered plate {known_hit}",
        )

    if not plate:
        return ScanResponse(
            message="No number plate detected. Hold plate steady inside the yellow box.",
            confidence=0.0,
            candidates=[],
            rawText=raw_text[:500],
        )

    return ScanResponse(
        plate=correct_common_ocr_errors(plate),
        confidence=confidence,
        candidates=candidates,
        rawText=raw_text[:500],
        engine="tesseract",
        message="Plate detected",
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

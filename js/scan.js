// js/scan.js — camera capture, OCR on the guide-box region only, and
// collector-number lookup. The parser itself lives in parser.js (kept pure
// so it's Node-testable without DOM/camera/Tesseract dependencies).

import { parseCollectorNumber } from "./parser.js";
import { RiftScribe } from "./api.js";

export { parseCollectorNumber };

let tesseractLoadPromise = null;

/** Lazy-load Tesseract.js from CDN only when the user actually scans. */
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error("Failed to load OCR engine (Tesseract.js) from CDN."));
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

export class Scanner {
  constructor({ videoEl, guideBoxEl }) {
    this.videoEl = videoEl;
    this.guideBoxEl = guideBoxEl;
    this.stream = null;
  }

  /** Starts the camera. Throws a friendly Error on permission/HTTPS failure. */
  async start() {
    const isSecure = window.isSecureContext || location.hostname === "localhost";
    if (!isSecure) {
      throw new Error(
        "Camera access requires HTTPS or localhost. Open this app via GitHub Pages (https://) or `npx serve` on localhost for local testing."
      );
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This browser does not expose camera access (getUserMedia unavailable).");
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
    } catch (err) {
      throw new Error(
        `Could not access the camera (${err.name || "error"}). Check camera permission in your browser/iOS settings, and that you're on HTTPS or localhost.`
      );
    }
    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  /**
   * Captures only the guide-box region of the current video frame, upscales
   * ~3x, converts to grayscale with a soft threshold, and OCRs it with a
   * restricted character whitelist. Returns the raw OCR text (caller runs
   * it through parseCollectorNumber).
   */
  async captureAndRecognize() {
    const Tesseract = await loadTesseract();

    const videoRect = this.videoEl.getBoundingClientRect();
    const guideRect = this.guideBoxEl.getBoundingClientRect();

    const scaleX = this.videoEl.videoWidth / videoRect.width;
    const scaleY = this.videoEl.videoHeight / videoRect.height;

    const sx = (guideRect.left - videoRect.left) * scaleX;
    const sy = (guideRect.top - videoRect.top) * scaleY;
    const sw = guideRect.width * scaleX;
    const sh = guideRect.height * scaleY;

    const UPSCALE = 3;
    const canvas = document.createElement("canvas");
    canvas.width = sw * UPSCALE;
    canvas.height = sh * UPSCALE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(this.videoEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    // Grayscale + soft threshold.
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const thresholded = gray > 140 ? 255 : gray < 90 ? 0 : gray; // soft threshold band
      d[i] = d[i + 1] = d[i + 2] = thresholded;
    }
    ctx.putImageData(imgData, 0, 0);

    const { data } = await Tesseract.recognize(canvas, "eng", {
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-*",
    });

    return (data.text || "").trim();
  }
}

/**
 * Full scan-to-card flow: OCR -> parse -> lookup. Returns one of:
 *   { status: "found", card }
 *   { status: "needsSet", number }       — prefill manual form
 *   { status: "notFound", attemptedId }
 *   { status: "noMatch", ocrText }       — garbage OCR, prompt retry/manual
 */
export async function scanAndLookup(scanner) {
  const ocrText = await scanner.captureAndRecognize();
  const parsed = parseCollectorNumber(ocrText);

  if (parsed === null) {
    return { status: "noMatch", ocrText };
  }
  if (typeof parsed === "object" && parsed.needsSet) {
    return { status: "needsSet", number: parsed.number };
  }

  const card = await RiftScribe.getCard(parsed);
  if (!card) {
    return { status: "notFound", attemptedId: parsed };
  }
  return { status: "found", card };
}

/** Manual entry uses the exact same parser + lookup path as the scanner. */
export async function manualLookup(setCode, number, suffix) {
  const composed = `${setCode}${number}${suffix || ""}`;
  const parsed = parseCollectorNumber(`${setCode} ${number}${suffix || ""}`);
  const id = typeof parsed === "string" ? parsed : `${setCode}-${number}${suffix || ""}`;
  const card = await RiftScribe.getCard(id);
  return card ? { status: "found", card } : { status: "notFound", attemptedId: id, raw: composed };
}

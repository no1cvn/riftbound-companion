// js/scan.js — camera capture, OCR on the guide-box region only, and
// collector-number lookup. The parser itself lives in parser.js (kept pure
// so it's Node-testable without DOM/camera/Tesseract dependencies).

import { parseCollectorNumber } from "./parser.js";
import { RiftScribe } from "./api.js";

export { parseCollectorNumber };

const OCR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-*";

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

// VERIFIED 2026-06-22: passing `tessedit_char_whitelist` as a loose key in
// the third argument of the convenience `Tesseract.recognize(image, lang,
// options)` call (the original approach) is NOT reliably honored — real
// scans returned characters outside the whitelist (e.g. "|", "&"). The
// documented-reliable way is to create a worker explicitly and call
// `worker.setParameters(...)` before recognizing. The worker is created
// once and reused across scans (cheap to keep warm, expensive to keep
// re-creating per scan).
let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = await loadTesseract();
      const worker = await Tesseract.createWorker("eng");
      await worker.setParameters({ tessedit_char_whitelist: OCR_WHITELIST });
      return worker;
    })();
  }
  return workerPromise;
}

/** Cached live set codes (e.g. ["OGN","OGS","SFD","UNL","VEN"]) — fetched
 * once per session from RiftScribe so the parser can restrict its set-code
 * match instead of accepting any 2-4 uppercase letters from OCR noise. See
 * parser.js and DECISIONS.md. Falls back to an empty list (generic
 * matching) if the lookup fails. */
let knownSetsPromise = null;
async function getKnownSets() {
  if (!knownSetsPromise) {
    knownSetsPromise = RiftScribe.getFilters()
      .then((f) => f.sets || [])
      .catch(() => []);
  }
  return knownSetsPromise;
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
    const worker = await getWorker();

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

    const { data } = await worker.recognize(canvas);

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
  const knownSets = await getKnownSets();
  const parsed = parseCollectorNumber(ocrText, { knownSets });

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

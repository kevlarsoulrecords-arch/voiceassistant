import base64
import json
import os
from io import BytesIO

import requests  # for /voices
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS

# If your lab gave you these helpers, we’ll use them.
# They may still be stubs; that’s fine—this file will still run and return safe fallbacks.
try:
    from worker import speech_to_text, text_to_speech, openai_process_message
except Exception:  # if worker.py isn’t ready yet, define minimal placeholders
    def speech_to_text(audio_bytes: bytes) -> str:
        return "hello"

    def openai_process_message(user_message: str) -> str:
        return f"You said: {user_message}"

    def text_to_speech(text: str, voice: str = "default") -> bytes:
        import wave, struct, io
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)   # 16-bit
            w.setframerate(8000)
            samples = int(0.1 * 8000)
            for _ in range(samples):
                w.writeframes(struct.pack("<h", 0))
        return buf.getvalue()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# ---------- Routes ----------

@app.route("/", methods=["GET"])
def index():
    # Renders templates/index.html
    return render_template("index.html")


@app.route("/speech-to-text", methods=["POST"])
def stt_route():
    """
    Expects raw audio bytes in the request body (the front-end sends Blob without a content-type).
    Returns: {"text": "..."}
    """
    try:
        audio_bytes = request.get_data()  # bytes
        if not audio_bytes:
            return jsonify({"error": "No audio received"}), 400

        text = speech_to_text(audio_bytes)  # delegate to worker.py
        return jsonify({"text": text}), 200

    except Exception as e:
        return jsonify({"error": f"STT failed: {e}"}), 500


@app.route("/process-message", methods=["POST"])
def process_message_route():
    """
    Expects JSON: { "userMessage": "...", "voice": "default" }
    Returns JSON: { "openaiResponseText": "...", "openaiResponseSpeech": "<base64-wav>" }
    """
    try:
        data = request.get_json(silent=True) or {}
        user_message = (data.get("userMessage") or "").strip()
        voice = (data.get("voice") or "default").strip()

        if not user_message:
            return jsonify({"error": "Missing 'userMessage'"}), 400

        # 1) Text generation (LLM)
        reply_text = openai_process_message(user_message)

        # 2) Text-to-speech (WAV bytes)
        wav_bytes = text_to_speech(reply_text, voice=voice)

        # 3) Base64 for the front-end player
        wav_b64 = base64.b64encode(wav_bytes).decode("ascii")

        return jsonify({
            "openaiResponseText": reply_text,
            "openaiResponseSpeech": wav_b64
        }), 200

    except Exception as e:
        return jsonify({"error": f"Processing failed: {e}"}), 500


# -------- /voices: return a flat list the front-end can use --------
@app.route("/voices", methods=["GET"])
def voices_route():
    """
    Returns a simplified list of Watson TTS voices:
      [ { "name": "...", "label": "...", "language": "..." }, ... ]
    """
    try:
        base_url = "https://sn-watson-tts.labs.skills.network"
        url = f"{base_url}/text-to-speech/api/v1/voices"
        res = requests.get(url, timeout=15)

        if res.status_code != 200:
            return jsonify({"error": f"Upstream {res.status_code}"}), 502

        raw = res.json() or {}
        items = raw.get("voices", []) or []

        simplified = []
        for v in items:
            name = v.get("name", "")
            language = v.get("language", "")
            # Prefer the friendly description, fall back to the name
            label = (v.get("description") or name or "").strip()
            simplified.append({"name": name, "label": label, "language": language})

        return jsonify(simplified), 200

    except Exception as e:
        return jsonify({"error": f"Failed to fetch voices: {e}"}), 500


if __name__ == "__main__":
    # Lab usually proxies port 8000; keep it as-is unless instructed otherwise.
    app.run(host="0.0.0.0", port=8000)

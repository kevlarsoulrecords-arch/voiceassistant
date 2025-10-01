# worker.py
# Lab stub implementations (no external services yet)

import os
import io
import wave

# Read OpenAI key from env (safe to leave even if you don't use it yet)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

def openai_process_message(user_message: str) -> str:
    # Simple placeholder so the UI shows something deterministic
    user_message = (user_message or "").strip()
    if not user_message:
        return "I didn’t catch that. Could you try again?"
    return f"You said: {user_message}"

def _silent_wav(duration_sec: float = 0.3, sample_rate: int = 16000) -> bytes:
    # Create a short silent WAV so the speaker button has valid audio
    buf = io.BytesIO()
    frames = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)      # 16-bit PCM
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()

def text_to_speech(text: str, voice: str = "default") -> bytes:
    # Placeholder: return a tiny silent clip (lab will replace with real TTS later)
    return _silent_wav()

def speech_to_text(audio_bytes: bytes) -> str:
    # Placeholder: lab will replace with real STT later
    return ""

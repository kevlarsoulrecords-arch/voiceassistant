# worker.py
# Watson STT + OpenAI reply + Watson TTS (hardened voice handling + debug)

import io
import wave
import requests
from urllib.parse import quote_plus

# ---------- OpenAI client (works with new or legacy SDKs) ----------
_OPENAI_CLIENT = None
def _get_openai_client():
    """
    Returns a client that works whether the lab image has openai==1.x
    (new SDK) or openai==0.x (legacy). The SDKs pick up OPENAI_API_KEY
    from the environment in this lab.
    """
    global _OPENAI_CLIENT
    if _OPENAI_CLIENT:
        return _OPENAI_CLIENT
    try:
        # New SDK (openai>=1.0)
        from openai import OpenAI
        _OPENAI_CLIENT = OpenAI()
    except Exception:
        # Legacy SDK fallback
        import openai
        _OPENAI_CLIENT = openai
    return _OPENAI_CLIENT


# ---------- OpenAI: generate the assistant reply ----------
def openai_process_message(user_message: str) -> str:
    """
    Sends the user's text to OpenAI and returns a short reply.
    """
    user_message = (user_message or "").strip()
    if not user_message:
        return "I didn’t catch that. Could you try again?"

    client = _get_openai_client()

    system_prompt = (
        "Act like a personal assistant. You can respond to questions, "
        "translate sentences, summarize news, and give recommendations."
    )

    try:
        # Try new SDK first
        if hasattr(client, "chat"):  # openai>=1.x
            resp = client.chat.completions.create(
                model="gpt-3.5-turbo",
                max_tokens=60,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
            )
            return (resp.choices[0].message.content or "").strip()

        # Legacy SDK path
        resp = client.ChatCompletion.create(
            model="gpt-3.5-turbo",
            max_tokens=60,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
        )
        return (resp["choices"][0]["message"]["content"] or "").strip()

    except Exception as e:
        return f"(OpenAI error) {e}"


# ---------- Watson Speech-to-Text ----------
def speech_to_text(audio_binary: bytes) -> str:
    """
    Sends raw audio bytes to the embedded Watson STT service and returns the
    transcript string (or "" if none).
    """
    if not audio_binary:
        return ""

    base_url = "https://sn-watson-stt.labs.skills.network"
    api_url = f"{base_url}/speech-to-text/api/v1/recognize"
    params = {"model": "en-US_Multimedia"}

    try:
        response = requests.post(api_url, params=params, data=audio_binary, timeout=30).json()
        # Example: {"results":[{"alternatives":[{"transcript":"hello world"}]}]}
        if response.get("results"):
            return (
                response.get("results")[0]
                .get("alternatives", [{}])[0]
                .get("transcript", "")
            ).strip()
    except Exception:
        pass
    return ""


# ---------- Watson Text-to-Speech ----------
def _silent_wav(duration_sec: float = 0.3, sample_rate: int = 16000) -> bytes:
    """Fallback audio (silence) if TTS fails, so the UI still plays something."""
    buf = io.BytesIO()
    frames = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit PCM
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def _looks_like_watson_voice_id(v: str) -> bool:
    """
    Very light validation: Watson ids typically look like 'en-GB_JamesV3Voice'.
    This helps guard against passing a label/description by mistake.
    """
    return bool(v) and ("_Voice" in (v + "_Voice") or v.endswith("Voice")) and ("_" in v)


def text_to_speech(text: str, voice: str = "default") -> bytes:
    """
    Calls the embedded Watson TTS service and returns WAV bytes.
    If voice == "default", Watson uses its default voice.

    Hardened:
    - URL-encode voice parameter
    - Validate obvious non-ids (labels) and fall back to default
    - Print debug to Flask log for quick diagnosis
    """
    text = text or " "

    base_url = "https://sn-watson-tts.labs.skills.network"
    api_url = f"{base_url}/text-to-speech/api/v1/synthesize?output=output_text.wav"

    # If the UI ever passes a label instead of the id, fall back to default.
    if voice and voice != "default" and _looks_like_watson_voice_id(voice):
        api_url += f"&voice={quote_plus(voice)}"
    else:
        # Either "default" or not a valid id => use Watson default
        voice = "default"

    headers = {
        "Accept": "audio/wav",
        "Content-Type": "application/json",
    }
    payload = {"text": text}

    try:
        r = requests.post(api_url, headers=headers, json=payload, timeout=60)
        # Debug line to the Flask console
        print(f"[TTS] status={r.status_code} voice={voice} url={api_url} bytes={len(r.content) if r.content else 0}")
        if r.status_code == 200 and r.content:
            return r.content
    except Exception as e:
        print(f"[TTS] error: {e}")

    # Fallback so the UI's speaker button still works even if TTS fails
    return _silent_wav()

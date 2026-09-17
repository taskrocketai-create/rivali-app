"""Temporary video -> transcript -> paraphrased Rivali knowledge pipeline."""
import json
import os
import re
import subprocess
from pathlib import Path

from anthropic import Anthropic
from openai import OpenAI

CATEGORIES = {
    "definition",
    "general_principle",
    "specific_numeric_recommendation",
    "disputed_or_opinion",
}

DISTILL_SYSTEM_PROMPT = """You extract useful kart setup, tuning, and driving knowledge from a transcript.
Rules:
- Never quote or closely copy transcript wording. Paraphrase every point completely.
- Skip introductions, promotions, repeated points, and unrelated conversation.
- Treat directional setup claims as disputed_or_opinion when chassis, track, tire, or driver context can change the result.
- Output only a JSON array. Each item must have claim, category, confidence_note, and short_title.
- category must be definition, general_principle, specific_numeric_recommendation, or disputed_or_opinion.
- A claim is one or two sentences. A short_title is at most 80 characters.
- Return [] if there is no relevant knowledge.
The raw transcript must never appear in the output."""


def extract_audio_chunks(video_path: str, output_dir: str) -> list[str]:
    pattern = str(Path(output_dir) / "audio-%03d.mp3")
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", video_path,
        "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "-f", "segment",
        "-segment_time", "600", "-reset_timestamps", "1", pattern,
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)
    chunks = sorted(str(path) for path in Path(output_dir).glob("audio-*.mp3"))
    if not chunks:
        raise RuntimeError("No usable audio track was found in this file.")
    return chunks


def transcribe_chunks(paths: list[str]) -> str:
    client = OpenAI()
    transcript_parts = []
    for path in paths:
        with open(path, "rb") as audio:
            result = client.audio.transcriptions.create(
                model=os.environ.get("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"),
                file=audio,
                response_format="text",
            )
        text = result if isinstance(result, str) else result.text
        if text.strip():
            transcript_parts.append(text.strip())
    if not transcript_parts:
        raise RuntimeError("The audio was processed but no speech could be transcribed.")
    return "\n".join(transcript_parts)


def _transcript_chunks(text: str, maximum: int = 80000) -> list[str]:
    return [text[index:index + maximum] for index in range(0, len(text), maximum)]


def distill_transcript(transcript: str) -> list[dict]:
    client = Anthropic()
    points = []
    for chunk in _transcript_chunks(transcript):
        response = client.messages.create(
            model=os.environ.get("ANTHROPIC_DISTILL_MODEL", "claude-sonnet-4-6"),
            max_tokens=5000,
            system=DISTILL_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": chunk}],
        )
        raw = "".join(block.text for block in response.content if block.type == "text")
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
        decoded = json.loads(raw)
        if not isinstance(decoded, list):
            raise ValueError("Knowledge extraction returned an invalid result.")
        points.extend(decoded)

    valid, seen = [], set()
    for point in points:
        claim = str(point.get("claim", "")).strip()
        category = str(point.get("category", "")).strip()
        key = re.sub(r"\W+", " ", claim.lower()).strip()
        if not claim or category not in CATEGORIES or key in seen:
            continue
        seen.add(key)
        valid.append({
            "title": str(point.get("short_title") or claim[:80]).strip()[:200],
            "body": claim[:50000],
            "category": category,
            "confidence_note": str(point.get("confidence_note", "Source-dependent video claim.")).strip()[:500],
        })
    return valid

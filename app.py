"""
GPT-Cleaner — Flask API: messy text → structured Markdown via OpenRouter (OpenAI-compatible).
"""

import os
import re
from flask import Flask, request, jsonify, render_template

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

OPENROUTER_BASE = "https://openrouter.ai/api/v1"

SYSTEM_BASE = """You are a technical documentation cleaner.

Your job is to CLEAN and STRUCTURE the given content — NOT rewrite it completely.

Rules:
- Keep the original meaning and intent
- Do NOT add generic introductions like "This document describes...", "A simple X application that...", or "The following..."
- Never open with vague one-liners — jump straight into useful structure
- Do NOT make it sound like a textbook
- Keep it practical and developer-focused

Opening & tone:
- Prefer README-style openings: start with `## Title` (project or topic name), then ONE sharp subtitle line (what it does in concrete terms)
- Example of GOOD intro line: `Simple API that strips non-alphanumeric characters from text.`
- Example of BAD intro line: `A simple Flask application that cleans text input...` — ban this kind of filler

What to do:
1. Fix grammar and clarity
2. Add proper Markdown headings
3. Format code blocks correctly
4. Convert messy notes into clean bullet points
5. Keep explanations concise and natural — remove repetition and throat-clearing
6. Remove filler lines that add no information

Style:
- Direct and to the point
- Developer-friendly (like a README)
- No unnecessary sections

Output:
- Return only clean Markdown
- No extra explanations or preamble outside the doc itself"""

MODE_README = """
Template — README mode:
- Shape like a real README: `## Title`, one-line value prop, then Install / Usage / API / Config only when the source supports them.
- Skip empty marketing sections. No "Overview" unless the source needs it."""

FIX_CODE_SUFFIX = """
Code repair (inside fenced code blocks only):
- Fix obvious typos and syntax mistakes so code would run: e.g. Python `Flask(**name**)` or `**name**` → `Flask(__name__)`, stray quotes, doubled operators, common identifier typos.
- Do not change behavior, add features, or refactor for style — only fix errors that would break execution."""

MODE_NOTES = """
Template — Notes mode:
- Prefer short headings and scannable bullets.
- Keep tone informal-but-clear; good for personal notes, drafts, or chat logs."""

MODE_API_DOCS = """
Template — API docs mode:
- Structure as reference documentation: operations or endpoints, parameters, bodies, responses, status codes, and examples.
- Use tables only when they clarify parameters or fields."""

MODE_INSTRUCTIONS = {
    "readme": MODE_README,
    "notes": MODE_NOTES,
    "api_docs": MODE_API_DOCS,
}


def build_system_prompt(mode: str, fix_code: bool = False) -> str:
    extra = MODE_INSTRUCTIONS.get(mode, MODE_INSTRUCTIONS["readme"])
    parts = [SYSTEM_BASE, extra]
    if fix_code:
        parts.append(FIX_CODE_SUFFIX)
    return "\n".join(parts)


def build_user_message(text: str) -> str:
    return "Input:\n<<<\n" + text.strip() + "\n>>>"

# OpenRouter model id (see https://openrouter.ai/models)
# Default when using OpenRouter (see https://openrouter.ai/models)
DEFAULT_MODEL_OPENROUTER = os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini")
# Default when using api.openai.com directly
DEFAULT_MODEL_OPENAI = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

app = Flask(__name__)


def get_client():
    """OpenRouter if OPENROUTER_API_KEY is set; else official OpenAI if OPENAI_API_KEY."""
    r_key = os.environ.get("OPENROUTER_API_KEY")
    o_key = os.environ.get("OPENAI_API_KEY")
    if r_key:
        referer = os.environ.get("OPENROUTER_HTTP_REFERER", "http://127.0.0.1:5000")
        title = os.environ.get("OPENROUTER_APP_TITLE", "GPT-Cleaner")
        return OpenAI(
            api_key=r_key,
            base_url=OPENROUTER_BASE,
            default_headers={
                "HTTP-Referer": referer,
                "X-Title": title,
            },
        )
    if o_key:
        return OpenAI(api_key=o_key)
    return None


def get_default_model():
    if os.environ.get("OPENROUTER_API_KEY"):
        return DEFAULT_MODEL_OPENROUTER
    return DEFAULT_MODEL_OPENAI


def get_max_output_tokens() -> int:
    """
    Cap completion length so OpenRouter does not reserve the model default (often 16k),
    which can trigger 402 on low credit. Override with MAX_OUTPUT_TOKENS in .env.
    """
    raw = os.environ.get("MAX_OUTPUT_TOKENS") or os.environ.get(
        "OPENROUTER_MAX_TOKENS", ""
    )
    default = 4096
    if not raw.strip():
        return default
    try:
        n = int(raw)
    except ValueError:
        return default
    return max(256, min(n, 32000))


def count_fence_blocks(text: str) -> int:
    if not text:
        return 0
    n = text.count("```")
    return n // 2


def count_heading_sections(md: str) -> int:
    if not md:
        return 0
    return len(re.findall(r"^#{1,6}\s+\S", md, re.MULTILINE))


_LANG_ALIASES = {
    "py": "Python",
    "python": "Python",
    "js": "JavaScript",
    "javascript": "JavaScript",
    "ts": "TypeScript",
    "typescript": "TypeScript",
    "tsx": "TypeScript",
    "jsx": "JavaScript",
    "json": "JSON",
    "bash": "Shell",
    "sh": "Shell",
    "shell": "Shell",
    "ps1": "PowerShell",
    "powershell": "PowerShell",
    "html": "HTML",
    "css": "CSS",
    "sql": "SQL",
    "go": "Go",
    "rust": "Rust",
    "rs": "Rust",
    "java": "Java",
    "c": "C",
    "cpp": "C++",
    "csharp": "C#",
    "cs": "C#",
    "rb": "Ruby",
    "ruby": "Ruby",
    "php": "PHP",
    "swift": "Swift",
    "kt": "Kotlin",
    "kotlin": "Kotlin",
}


def detect_language_label(source: str, output_md: str) -> str:
    m = re.search(r"^```(\w+)", output_md, re.MULTILINE)
    if m:
        raw = m.group(1).strip().lower()
        if raw in _LANG_ALIASES:
            return _LANG_ALIASES[raw]
        if raw:
            return raw.replace("-", " ").title() + " Code"
    blob = (source or "") + "\n" + (output_md or "")
    low = blob.lower()
    if re.search(r"\bdef\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import\b", low):
        return "Python Code"
    if re.search(r"function\s*\w*\s*\(|=>|\bconst\s+\w+\s*=", low):
        return "JavaScript / TypeScript Code"
    if re.search(r"<\?php|->\w+", low):
        return "PHP Code"
    if re.search(r"func\s+\(|package\s+main\b", low):
        return "Go Code"
    if re.search(r"#include\s*<|int\s+main\s*\(", low):
        return "C / C++ Code"
    if "```" in output_md or "`" in source:
        return "Code / Technical"
    return "Notes / Mixed content"


def build_insights(source: str, output_md: str) -> dict:
    sections = count_heading_sections(output_md)
    blocks_in = count_fence_blocks(source)
    blocks_out = count_fence_blocks(output_md)
    label = detect_language_label(source, output_md)

    chips = [
        {"text": f"Detected: {label}"},
        {"text": f"Sections Created: {sections}"},
    ]
    if blocks_out > 0:
        chips.append(
            {
                "text": f"Code Blocks Fixed: {blocks_out}"
                + (f" (input had {blocks_in})" if blocks_in != blocks_out else ""),
            }
        )
    else:
        chips.append({"text": "Code Blocks Fixed: 0"})

    return {
        "detected_label": label,
        "sections_created": sections,
        "code_blocks_in": blocks_in,
        "code_blocks_out": blocks_out,
        "chips": chips,
    }


@app.route("/")
def home():
    return render_template("landing.html")


@app.route("/app")
def tool():
    return render_template("tool.html")


@app.route("/clean", methods=["POST"])
def clean():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Missing or empty 'text' field."}), 400

    mode = (data.get("mode") or "readme").strip().lower()
    # Backwards compatibility with older clients
    legacy = {"basic": "notes", "smart": "readme"}
    if mode in legacy:
        mode = legacy[mode]
    if mode not in MODE_INSTRUCTIONS:
        mode = "readme"

    fix_code = bool(data.get("fix_code"))

    client = get_client()
    if not client:
        return (
            jsonify(
                {
                    "error": "Server is not configured. Set OPENROUTER_API_KEY (recommended) "
                    "or OPENAI_API_KEY in .env or environment."
                }
            ),
            503,
        )

    system = build_system_prompt(mode, fix_code=fix_code)
    model_id = get_default_model()
    max_tokens = get_max_output_tokens()
    user_msg = build_user_message(text)

    try:
        response = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.22,
            max_tokens=max_tokens,
        )
        content = response.choices[0].message.content
        if content is None:
            return jsonify({"error": "Model returned empty content."}), 502
        md = content.strip()
        insights = build_insights(text, md)
        return jsonify(
            {
                "markdown": md,
                "mode": mode,
                "fix_code": fix_code,
                "insights": insights,
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 502


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)

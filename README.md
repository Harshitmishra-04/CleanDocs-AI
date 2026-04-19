# GPT-Cleaner

Turn messy AI-generated text into clean, structured **Markdown** — READMEs, notes, and API-style docs — with a Flask + OpenRouter backend and a small vanilla JS frontend.

**Routes:** `/` = landing page · `/app` = editor

> **Tip for your repo:** add a screenshot of the “See the difference” demo (`docs/screenshot.png`) and link it here after your first run.

## Features

- Templates: **README**, **Notes**, **API Docs** · optional **Fix code errors** in fenced blocks  
- Side-by-side **word diff** (additions / removals) · history with preview, delete, load into editor  
- Exports: Markdown, GitHub-style README copy, HTML, `.md`, print / PDF  
- Dark mode by default (toggle on home + app; synced via `localStorage`)  
- Friendly errors (credits / input size / rate limit)

## Requirements

- Python **3.10+**
- An [OpenRouter](https://openrouter.ai/) API key (or `OPENAI_API_KEY` for OpenAI’s API directly)

## Quick start

```bash
cd gpt-cleaner
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env   # Windows: copy; Unix: cp — then edit .env
python app.py
```

Open **http://127.0.0.1:5000/** for the marketing page, or **http://127.0.0.1:5000/app** for the editor.

### Environment

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Primary key (recommended) |
| `OPENROUTER_MODEL` | Default: `openai/gpt-4o-mini` |
| `OPENAI_API_KEY` | Used if OpenRouter key is unset |
| `MAX_OUTPUT_TOKENS` | Default `4096` — lower if you hit 402 / credit limits |

See `.env.example` for optional OpenRouter headers.

## API

`POST /clean` with JSON:

```json
{
  "text": "your messy content",
  "mode": "readme",
  "fix_code": false
}
```

`mode`: `readme` | `notes` | `api_docs` · `fix_code`: optional boolean.

## Project layout

```
gpt-cleaner/
  app.py                 # Flask: routes /, /app, POST /clean
  requirements.txt
  .env.example
  templates/
    landing.html         # Marketing + demo
    tool.html            # Editor UI
  static/
    css/style.css
    js/app.js            # App logic
    js/landing.js        # Landing theme toggle
```

## License

MIT — see [LICENSE](LICENSE).

## Contributing

Issues and PRs welcome. Keep changes focused; match existing code style.

"""Entry point the Tab Highway shell starts: uvicorn tabhighway_engine:app

Run with the StemDeck backend folder as the working directory and on the import path, so that
`app.main` resolves to the pinned StemDeck release.

Environment:
  TABHIGHWAY_ENGINE_SECRET   required; the per-launch secret every request must carry.
  TABHIGHWAY_ORIGINS         comma-separated page origins allowed to call the engine
                             (default: the desktop shell's own origin).
"""

import os

from app.main import app as stemdeck_app  # the pinned StemDeck release, unmodified

from guard import guard
from ytdlp_fix import restore_youtube_search

restore_youtube_search()

_origins = [o.strip() for o in os.environ.get("TABHIGHWAY_ORIGINS", "http://tauri.localhost").split(",") if o.strip()]

app = guard(stemdeck_app, secret=os.environ.get("TABHIGHWAY_ENGINE_SECRET", ""), origins=_origins)

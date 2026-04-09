import os
import subprocess
import logging
import threading
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from youtube_search import YoutubeSearch

from app.database import (
    init_db,
    upsert_movies,
    get_all_movies,
    get_movie,
    set_status,
    get_setting,
    set_setting,
    get_path_mappings,
    set_path_mappings,
    is_setup_complete,
    mark_setup_complete,
)
from app.radarr import fetch_movies

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("themearr")

app = FastAPI(title="Themearr")

STATIC_DIR = Path(__file__).parent / "static"
VERSION_FILE = Path(os.getenv("THEMEARR_VERSION_FILE", "/opt/themearr/VERSION"))
GITHUB_REPO = os.getenv("GITHUB_REPO", "Actuallbug2005/themearr")
UPDATER_CMD = os.getenv("THEMEARR_UPDATER_CMD", "sudo /usr/local/bin/themearr-update")

_update_lock = threading.Lock()
_update_in_progress = False
_update_error = ""


@app.on_event("startup")
def startup():
    init_db()


def _setup_payload() -> dict:
    return {
        "setupComplete": is_setup_complete(),
        "radarrUrl": get_setting("radarr_url", ""),
        "radarrApiKeySet": bool(get_setting("radarr_api_key", "").strip()),
        "pathMappings": get_path_mappings(),
    }


# ── API ──────────────────────────────────────────────────────────────────────

@app.post("/api/sync")
async def sync_radarr():
    if not is_setup_complete():
        raise HTTPException(status_code=400, detail="App setup is not complete")

    try:
        movies = await fetch_movies()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Radarr error: {exc}")
    upsert_movies(movies)
    return {"synced": len(movies)}


@app.get("/api/setup/status")
def setup_status():
    return _setup_payload()


class PathMapping(BaseModel):
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)


class SetupRequest(BaseModel):
    radarr_url: str = Field(min_length=1)
    radarr_api_key: str = ""
    path_mappings: list[PathMapping] = Field(default_factory=list)


@app.post("/api/setup")
def save_setup(req: SetupRequest):
    existing_key = get_setting("radarr_api_key", "").strip()
    api_key = req.radarr_api_key.strip() or existing_key
    if not api_key:
        raise HTTPException(status_code=400, detail="Radarr API key is required")

    set_setting("radarr_url", req.radarr_url.strip())
    set_setting("radarr_api_key", api_key)
    set_path_mappings([mapping.model_dump() for mapping in req.path_mappings])
    mark_setup_complete()
    return _setup_payload()


@app.get("/api/movies")
def list_movies():
    return get_all_movies()


@app.get("/api/search/{movie_id}")
def search_youtube(movie_id: int):
    movie = get_movie(movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    query = f"{movie['title']} {movie['year']} theme song"
    log.info("YouTube search: %s", query)

    try:
        results = YoutubeSearch(query, max_results=3).to_dict()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"YouTube search error: {exc}")

    videos = []
    for r in results:
        vid_id = r.get("id", "")
        # youtube-search returns ids prefixed with /watch?v= sometimes
        if vid_id.startswith("/watch?v="):
            vid_id = vid_id[len("/watch?v="):]
        videos.append(
            {
                "videoId": vid_id,
                "title": r.get("title", ""),
                "thumbnail": r.get("thumbnails", [None])[0],
                "duration": r.get("duration", ""),
                "channel": r.get("channel", ""),
            }
        )
    return {"movie": movie, "results": videos}


class DownloadRequest(BaseModel):
    movie_id: int
    video_id: str


def _current_version() -> str:
    env_version = os.getenv("APP_VERSION", "").strip()
    if env_version:
        return env_version

    if VERSION_FILE.exists():
        value = VERSION_FILE.read_text(encoding="utf-8").strip()
        if value:
            return value
    return "dev"


def _latest_main_version() -> str:
    url = f"https://api.github.com/repos/{GITHUB_REPO}/commits/main"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "themearr"}
    resp = httpx.get(url, timeout=10, headers=headers)
    resp.raise_for_status()
    return resp.json()["sha"][:12]


def _run_update() -> None:
    global _update_in_progress, _update_error
    try:
        subprocess.run(
            UPDATER_CMD,
            shell=True,
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception as exc:
        log.exception("Update failed")
        _update_error = str(exc)
    finally:
        _update_in_progress = False


@app.get("/api/version")
def app_version():
    current = _current_version()
    latest = ""
    check_error = ""

    try:
        latest = _latest_main_version()
    except Exception as exc:
        log.warning("Version check failed: %s", exc)
        check_error = str(exc)

    return {
        "current": current,
        "latest": latest,
        "updateAvailable": bool(latest and current != latest),
        "updating": _update_in_progress,
        "updateError": _update_error,
        "checkError": check_error,
        "repo": GITHUB_REPO,
    }


@app.post("/api/update")
def app_update():
    global _update_in_progress, _update_error

    if _update_in_progress:
        return {"started": False, "detail": "Update already in progress"}

    with _update_lock:
        if _update_in_progress:
            return {"started": False, "detail": "Update already in progress"}
        _update_in_progress = True
        _update_error = ""

        thread = threading.Thread(target=_run_update, daemon=True)
        thread.start()

    return {"started": True}


@app.post("/api/download")
def download_theme(req: DownloadRequest):
    movie = get_movie(req.movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    folder = movie["folderName"]
    if not folder:
        raise HTTPException(status_code=400, detail="Movie has no folder path")

    url = f"https://www.youtube.com/watch?v={req.video_id}"
    output_template = os.path.join(folder, "theme.%(ext)s")

    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", output_template,
        url,
    ]
    log.info("Running: %s", " ".join(cmd))

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        log.error("yt-dlp stderr: %s", proc.stderr)
        raise HTTPException(
            status_code=500,
            detail=f"yt-dlp failed (exit {proc.returncode}): {proc.stderr[-500:]}",
        )

    set_status(req.movie_id, "downloaded")
    return {"status": "downloaded", "movie_id": req.movie_id}


# ── Static files ─────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    return FileResponse(str(STATIC_DIR / "index.html"))

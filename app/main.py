import os
import subprocess
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from youtube_search import YoutubeSearch

from app.database import init_db, upsert_movies, get_all_movies, get_movie, set_status
from app.radarr import fetch_movies

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("themearr")

app = FastAPI(title="Themearr")

STATIC_DIR = Path(__file__).parent / "static"


@app.on_event("startup")
def startup():
    init_db()


# ── API ──────────────────────────────────────────────────────────────────────

@app.post("/api/sync")
async def sync_radarr():
    try:
        movies = await fetch_movies()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Radarr error: {exc}")
    upsert_movies(movies)
    return {"synced": len(movies)}


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

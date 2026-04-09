import os
import httpx

RADARR_URL = os.getenv("RADARR_URL", "http://localhost:7878")
RADARR_API_KEY = os.getenv("RADARR_API_KEY", "")
RADARR_PATH_MAP = os.getenv("RADARR_PATH_MAP", "")


def _parse_path_mappings(raw: str) -> list[tuple[str, str]]:
    mappings = []
    if not raw:
        return mappings

    for pair in raw.split(";"):
        pair = pair.strip()
        if not pair or "=" not in pair:
            continue
        src, dst = pair.split("=", 1)
        src = src.strip().rstrip("/")
        dst = dst.strip().rstrip("/")
        if src and dst:
            mappings.append((src, dst))
    return mappings


PATH_MAPPINGS = _parse_path_mappings(RADARR_PATH_MAP)


def _apply_path_mapping(path: str) -> str:
    for src, dst in PATH_MAPPINGS:
        if path == src:
            return dst
        if path.startswith(src + "/"):
            return dst + path[len(src):]
    return path


async def fetch_movies() -> list[dict]:
    url = f"{RADARR_URL.rstrip('/')}/api/v3/movie"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, params={"apikey": RADARR_API_KEY})
        resp.raise_for_status()
        data = resp.json()

    result = []
    for m in data:
        folder = m.get("path") or m.get("folderName") or ""
        folder = _apply_path_mapping(folder)
        result.append(
            {
                "id": m["id"],
                "title": m["title"],
                "year": m.get("year"),
                "folderName": folder,
            }
        )
    return result

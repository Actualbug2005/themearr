import httpx

from app.database import get_setting, get_path_mappings


def _apply_path_mapping(path: str) -> str:
    for item in get_path_mappings():
        src = item["source"]
        dst = item["target"]
        if path == src:
            return dst
        if path.startswith(src + "/"):
            return dst + path[len(src):]
    return path


async def fetch_movies() -> list[dict]:
    radarr_url = get_setting("radarr_url", "").strip()
    radarr_api_key = get_setting("radarr_api_key", "").strip()

    if not radarr_url or not radarr_api_key:
        raise RuntimeError("Radarr settings have not been configured")

    url = f"{radarr_url.rstrip('/')}/api/v3/movie"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, params={"apikey": radarr_api_key})
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

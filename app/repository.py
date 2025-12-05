import json
from pathlib import Path
from threading import Lock
from typing import Any

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

_FILE_LOCK = Lock()


def _file_path(name: str) -> Path:
    return DATA_DIR / f"{name}.json"


def read_data(name: str, default: Any) -> Any:
    path = _file_path(name)
    if not path.exists():
        write_data(name, default)
        return default
    with _FILE_LOCK:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)


def write_data(name: str, data: Any) -> None:
    path = _file_path(name)
    with _FILE_LOCK:
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)


def next_id(prefix: str, collection: list[dict[str, Any]]) -> str:
    if not collection:
        return f"{prefix}_1"
    last = sorted(collection, key=lambda x: int(str(x['id']).split('_')[-1]))[-1]
    return f"{prefix}_{int(str(last['id']).split('_')[-1]) + 1}"

"""JSONResponse stand-in — records status and body so tests can inspect them."""
from typing import Any


class JSONResponse:
    def __init__(self, content: Any = None, status_code: int = 200, **_: Any) -> None:
        self.content = content
        self.status_code = status_code

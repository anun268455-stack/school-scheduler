"""Minimum FastAPI stand-in — mock_api only uses FastAPI, HTTPException."""
from typing import Any, Callable


class HTTPException(Exception):
    def __init__(self, status_code: int, detail: Any = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def Body(default: Any = None, **_: Any) -> Any:
    return default


class Request:
    """ตัวแทนเล็กที่สุด — ตัวทดสอบส่ง SimpleNamespace(headers={...}) เข้า route ตรง ๆ"""
    headers: dict = {}


class FastAPI:
    def __init__(self, **kw: Any) -> None:
        self.kw = kw
        self.routes: list[tuple[str, str, Callable]] = []
        self.middlewares: list[Callable] = []
        self.added: list[tuple[Any, dict]] = []
        self.events: dict[str, list[Callable]] = {}

    def _verb(self, verb: str) -> Callable:
        def deco_factory(path: str, **_: Any) -> Callable:
            def deco(fn: Callable) -> Callable:
                self.routes.append((verb, path, fn))
                return fn
            return deco
        return deco_factory

    def __getattr__(self, name: str) -> Callable:
        if name in ("get", "post", "put", "patch", "delete", "head", "options"):
            return self._verb(name)
        raise AttributeError(name)

    def middleware(self, _kind: str) -> Callable:
        def deco(fn: Callable) -> Callable:
            self.middlewares.append(fn)
            return fn
        return deco

    def add_middleware(self, cls: Any, **kw: Any) -> None:
        self.added.append((cls, kw))

    def on_event(self, name: str) -> Callable:
        def deco(fn: Callable) -> Callable:
            self.events.setdefault(name, []).append(fn)
            return fn
        return deco

"""Guard that wraps the unmodified StemDeck app for use by the Tab Highway desktop shell.

Two things are added, and nothing in StemDeck changes:
  * a cross-origin allowance for the shell's own page origin only, so the page can call the engine;
  * a per-launch secret header required on every request, so no other website open in the user's
    browser can post jobs to the loopback port.
"""

import hmac

from starlette.middleware.cors import CORSMiddleware
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

SECRET_HEADER = b"x-tabhighway-secret"


class _SecretGate:
    def __init__(self, app: ASGIApp, secret: str) -> None:
        self.app = app
        self.secret = secret.encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            supplied = dict(scope["headers"]).get(SECRET_HEADER, b"")
            if not hmac.compare_digest(supplied, self.secret):
                if scope["type"] == "http":
                    await PlainTextResponse("Forbidden", status_code=403)(scope, receive, send)
                else:
                    await send({"type": "websocket.close", "code": 1008})
                return
        await self.app(scope, receive, send)


def guard(app: ASGIApp, *, secret: str, origins: list[str]) -> ASGIApp:
    """Return `app` behind the secret gate, with cross-origin access for `origins` only."""
    if not secret:
        raise ValueError("an engine secret is required")
    return CORSMiddleware(
        _SecretGate(app, secret),
        allow_origins=origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["X-TabHighway-Secret", "Content-Type"],
    )

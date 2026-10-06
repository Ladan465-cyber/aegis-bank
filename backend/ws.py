import asyncio
import json


class Hub:
    """Pushes live fraud-ops events to connected analyst dashboards."""

    def __init__(self):
        self.clients = set()
        self.loop = None

    async def connect(self, ws):
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws):
        self.clients.discard(ws)

    async def _send_all(self, message: str):
        for ws in list(self.clients):
            try:
                await ws.send_text(message)
            except Exception:
                self.disconnect(ws)

    def publish(self, event: dict):
        """Thread-safe: callable from FastAPI's sync (threadpool) endpoints."""
        if self.loop and self.clients:
            asyncio.run_coroutine_threadsafe(self._send_all(json.dumps(event, default=str)), self.loop)


hub = Hub()

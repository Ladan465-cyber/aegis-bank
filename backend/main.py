import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from config import CORS_ORIGINS
from database import Base, engine, SessionLocal
from models import User
from routers import auth, accounts, transfers, admin
from security import decode_token
from ws import hub


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    hub.loop = asyncio.get_running_loop()
    yield


app = FastAPI(title="Aegis Bank API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
for r in (auth, accounts, transfers, admin):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws/admin")
async def ws_admin(ws: WebSocket, token: str = ""):
    try:
        payload = decode_token(token, "access")
        with SessionLocal() as db:
            user = db.get(User, int(payload["sub"]))
            if not user or user.role != "admin":
                raise PermissionError
    except Exception:
        await ws.close(code=4401)
        return
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws)

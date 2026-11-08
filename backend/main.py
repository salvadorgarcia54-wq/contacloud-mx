from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db, SessionLocal
from seed.sat_catalog import seed_sat_catalog
from models.user import User
from models.fixed_asset import FixedAsset
from models.temp_password import TempPassword
from models.support_ticket import SupportTicket, SupportConfig
from routers import auth, clients, accounts, journals, reports, bank, cfdi, fiscal, users, export, audit, temp_passwords, support
from routers.auth import get_password_hash, ensure_demo_assistant_user

app = FastAPI(title="ContaCloud MX", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(clients.router)
app.include_router(accounts.router)
app.include_router(journals.router)
app.include_router(reports.router)
app.include_router(bank.router)
app.include_router(cfdi.router)
app.include_router(fiscal.router)
app.include_router(users.router)
app.include_router(export.router)
app.include_router(audit.router)
app.include_router(temp_passwords.router)
app.include_router(support.router)

@app.on_event("startup")
def on_startup():
    init_db()
    
    db = SessionLocal()
    try:
        seed_sat_catalog(db)
        
        # Create default admin user if no users exist
        if db.query(User).first() is None:
            hashed_pw = get_password_hash("admin123")
            admin = User(
                username="admin",
                email="admin@contacloud.mx",
                hashed_password=hashed_pw,
                role="admin",
                full_name="Administrador"
            )
            db.add(admin)
            db.commit()
            print("Default admin user created (admin/admin123)")
        ensure_demo_assistant_user(db)
    finally:
        db.close()

@app.get("/api/health")
def health_check():
    return {"status": "ok"}

import os
import shutil
from fastapi import HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

_BANNER_SRC = r"C:\Users\MAQRFDCSVDR01\.gemini\antigravity\brain\46268c39-ae23-4ba7-9939-8f4f35a4ed5a\.user_uploaded\media_1794096108298_79b05723.png"
_BANNER_DEST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "assets", "banner_inicio.png"))
if os.path.exists(_BANNER_SRC) and not os.path.exists(_BANNER_DEST):
    try:
        os.makedirs(os.path.dirname(_BANNER_DEST), exist_ok=True)
        shutil.copy2(_BANNER_SRC, _BANNER_DEST)
    except Exception:
        pass

@app.get("/api/assets/banner-inicio")
def get_banner_inicio():
    for path in (_BANNER_DEST, _BANNER_SRC):
        if os.path.exists(path):
            return FileResponse(path, media_type="image/png")
    raise HTTPException(status_code=404, detail="Banner not found")

frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.exists(frontend_dist):
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not Found")
        file_path = os.path.join(frontend_dist, full_path)
        if full_path and full_path != "index.html" and os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        
        response = FileResponse(os.path.join(frontend_dist, "index.html"))
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
else:
    @app.get("/")
    def root():
        return {"app": "ContaCloud MX", "version": "1.0.0"}

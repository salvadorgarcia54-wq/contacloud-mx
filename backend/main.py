from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db, SessionLocal
from seed.sat_catalog import seed_sat_catalog
from models.user import User
from models.fixed_asset import FixedAsset
from models.temp_password import TempPassword
from models.support_ticket import SupportTicket, SupportConfig
from models.saas import SaasTenant, SaasInvoice
from routers import auth, clients, accounts, journals, reports, bank, cfdi, fiscal, users, export, audit, temp_passwords, support, saas, iterumbot
from routers.auth import get_password_hash, ensure_demo_assistant_user, ensure_saas_superadmin_user, ensure_primary_admin_user

app = FastAPI(title="Iterumx", version="2.0.0")

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
app.include_router(saas.router)
app.include_router(iterumbot.router)

@app.on_event("startup")
def on_startup():
    init_db()
    
    db = SessionLocal()
    try:
        seed_sat_catalog(db)
        
        # Create default admin user if no users exist
        if db.query(User).first() is None:
            hashed_pw = get_password_hash("AVIAF1827$")
            admin = User(
                username="admin",
                email="admin@contacloud.mx",
                hashed_password=hashed_pw,
                role="admin",
                full_name="Administrador"
            )
            db.add(admin)
            db.commit()
            print("Default admin user created (admin/AVIAF1827$)")
        ensure_primary_admin_user(db)
        ensure_saas_superadmin_user(db)
        ensure_demo_assistant_user(db)
    finally:
        db.close()

@app.get("/api/health")
def health_check():
    return {"status": "ok"}

import json
import os
import shutil
from fastapi import Depends, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from routers.auth import get_current_user

_BANNER_SRC = r"C:\Users\MAQRFDCSVDR01\.gemini\antigravity\brain\46268c39-ae23-4ba7-9939-8f4f35a4ed5a\.user_uploaded\media_1794096108298_79b05723.png"
_BANNER_DEST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "assets", "banner_inicio.png"))
if os.path.exists(_BANNER_SRC) and not os.path.exists(_BANNER_DEST):
    try:
        os.makedirs(os.path.dirname(_BANNER_DEST), exist_ok=True)
        shutil.copy2(_BANNER_SRC, _BANNER_DEST)
    except Exception:
        pass

_ITERUMX_ISOTIPO_SRC = r"C:\Users\MAQRFDCSVDR01\.gemini\antigravity\brain\0e5bad98-ba0b-4e0f-b1bb-1944704a7a2d\.user_uploaded\media_1794175443714_60b4153c.png"
_LOGO_DEST_ASSETS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "assets", "logo.png"))
_LOGO_DEST_PUBLIC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "logo.png"))
if os.path.exists(_ITERUMX_ISOTIPO_SRC):
    for dest_logo in (_LOGO_DEST_ASSETS, _LOGO_DEST_PUBLIC):
        try:
            os.makedirs(os.path.dirname(dest_logo), exist_ok=True)
            shutil.copy2(_ITERUMX_ISOTIPO_SRC, dest_logo)
        except Exception:
            pass

_HERO_BG_SRC = r"C:\Users\MAQRFDCSVDR01\.gemini\antigravity\brain\0e5bad98-ba0b-4e0f-b1bb-1944704a7a2d\.user_uploaded\media_1794183400981_b9e827fa.jpg"
_HERO_BG_PUBLIC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "hero-binary-bg.jpg"))
_HERO_BG_ASSETS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "assets", "hero-binary-bg.jpg"))
if os.path.exists(_HERO_BG_SRC):
    for dest_hero in (_HERO_BG_PUBLIC, _HERO_BG_ASSETS):
        try:
            os.makedirs(os.path.dirname(dest_hero), exist_ok=True)
            shutil.copy2(_HERO_BG_SRC, dest_hero)
        except Exception:
            pass

_FOOTER_BG_SRC = r"C:\Users\MAQRFDCSVDR01\.gemini\antigravity\brain\0e5bad98-ba0b-4e0f-b1bb-1944704a7a2d\.user_uploaded\media_1794185099054_a047b00c.jpg"
_FOOTER_BG_PUBLIC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "footer-binary-bg.jpg"))
_FOOTER_BG_ASSETS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "assets", "footer-binary-bg.jpg"))
if os.path.exists(_FOOTER_BG_SRC):
    for dest_footer in (_FOOTER_BG_PUBLIC, _FOOTER_BG_ASSETS):
        try:
            os.makedirs(os.path.dirname(dest_footer), exist_ok=True)
            shutil.copy2(_FOOTER_BG_SRC, dest_footer)
        except Exception:
            pass

try:
    import sys as _sys
    _proj_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if _proj_root not in _sys.path:
        _sys.path.insert(0, _proj_root)
    from crear_icono_escritorio import create_desktop_shortcut
    create_desktop_shortcut()
except Exception:
    pass

@app.get("/api/assets/iterumx-isotipo")
def get_iterumx_isotipo():
    for path in (_ITERUMX_ISOTIPO_SRC, _LOGO_DEST_ASSETS, _LOGO_DEST_PUBLIC):
        if os.path.exists(path):
            return FileResponse(path, media_type="image/png")
    raise HTTPException(status_code=404, detail="Isotipo not found")

@app.get("/api/assets/landing-hero-bg")
def get_landing_hero_bg():
    for path in (_HERO_BG_SRC, _HERO_BG_PUBLIC, _HERO_BG_ASSETS):
        if os.path.exists(path):
            return FileResponse(path, media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Hero background not found")

@app.get("/api/assets/landing-footer-bg")
def get_landing_footer_bg():
    for path in (_FOOTER_BG_SRC, _FOOTER_BG_PUBLIC, _FOOTER_BG_ASSETS):
        if os.path.exists(path):
            return FileResponse(path, media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Footer background not found")

@app.get("/api/assets/banner-inicio")
def get_banner_inicio():
    for path in (_BANNER_DEST, _BANNER_SRC):
        if os.path.exists(path):
            return FileResponse(path, media_type="image/png")
    raise HTTPException(status_code=404, detail="Banner not found")

_DEMO_IMAGE_PUBLIC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "demo-iterumx-image.png"))
_DEMO_VIDEO_PUBLIC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "demo-iterumx.mp4"))
_DEMO_VIDEO_CONFIG = os.path.abspath(os.path.join(os.path.dirname(__file__), "demo_video_config.json"))

@app.get("/api/assets/demo-video-info")
def get_demo_video_info():
    config = {"mode": "none", "url": "", "media_type": "image/png", "title": "Vista del Programa — Interfaz de Iterumx"}
    if os.path.exists(_DEMO_VIDEO_CONFIG):
        try:
            with open(_DEMO_VIDEO_CONFIG, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    config.update(saved)
        except Exception:
            pass
    if config.get("mode") in ("image", "file") and os.path.exists(_DEMO_IMAGE_PUBLIC):
        return {
            "mode": "image",
            "url": "/api/assets/demo-video-stream",
            "media_type": config.get("media_type") or "image/png",
            "title": config.get("title") or "Vista del Programa — Interfaz de Iterumx",
        }
    if os.path.exists(_DEMO_IMAGE_PUBLIC):
        return {
            "mode": "image",
            "url": "/api/assets/demo-video-stream",
            "media_type": "image/png",
            "title": config.get("title") or "Vista del Programa — Interfaz de Iterumx",
        }
    return {"mode": "none", "url": "", "title": config.get("title")}

@app.get("/api/assets/demo-video-stream")
def get_demo_video_stream():
    media_type = "image/png"
    if os.path.exists(_DEMO_VIDEO_CONFIG):
        try:
            with open(_DEMO_VIDEO_CONFIG, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict) and saved.get("media_type"):
                    media_type = saved["media_type"]
        except Exception:
            pass
    if os.path.exists(_DEMO_IMAGE_PUBLIC):
        return FileResponse(_DEMO_IMAGE_PUBLIC, media_type=media_type)
    if os.path.exists(_DEMO_VIDEO_PUBLIC):
        return FileResponse(_DEMO_VIDEO_PUBLIC, media_type="video/mp4")
    raise HTTPException(status_code=404, detail="Imagen del programa no encontrada")

@app.post("/api/assets/demo-video")
async def save_demo_video(
    file: UploadFile = File(None),
    video_url: str = Form(None),
    duration_seconds: float = Form(0),
    title: str = Form("Vista del Programa — Interfaz de Iterumx"),
    current_user: User = Depends(get_current_user),
):
    if (current_user.username or "").strip().lower() not in ("admin", "sgadmin", "superadmin"):
        raise HTTPException(status_code=403, detail="Solo el administrador principal puede modificar la imagen de la landing.")

    os.makedirs(os.path.dirname(_DEMO_IMAGE_PUBLIC), exist_ok=True)
    if file is not None and file.filename:
        with open(_DEMO_IMAGE_PUBLIC, "wb") as out_file:
            shutil.copyfileobj(file.file, out_file)
        content_type = file.content_type or "image/png"
        cfg = {
            "mode": "image",
            "url": "/api/assets/demo-video-stream",
            "media_type": content_type,
            "title": title or "Vista del Programa — Interfaz de Iterumx",
        }
        with open(_DEMO_VIDEO_CONFIG, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return cfg

    raise HTTPException(status_code=400, detail="Selecciona una imagen válida del programa.")

@app.delete("/api/assets/demo-video")
def delete_demo_video(
    current_user: User = Depends(get_current_user),
):
    if (current_user.username or "").strip().lower() not in ("admin", "sgadmin", "superadmin"):
        raise HTTPException(status_code=403, detail="Solo el administrador principal puede quitar la imagen de la landing.")

    for path in (_DEMO_VIDEO_CONFIG, _DEMO_IMAGE_PUBLIC, _DEMO_VIDEO_PUBLIC):
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception:
                pass
    return {"mode": "none", "url": ""}

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
        return {"app": "Iterumx", "version": "2.0.0"}

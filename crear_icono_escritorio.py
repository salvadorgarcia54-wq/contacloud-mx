import os
import subprocess
from PIL import Image

PROJECT_DIR = os.path.abspath(os.path.dirname(__file__))
ISOTIPO_SRC = r"C:\Users\MAQRFDCSVDR01\.gemini\antigravity\brain\0e5bad98-ba0b-4e0f-b1bb-1944704a7a2d\.user_uploaded\media_1794175443714_60b4153c.png"
FALLBACK_LOGO = os.path.join(PROJECT_DIR, "frontend", "src", "assets", "logo.png")
ICO_PATH = os.path.join(PROJECT_DIR, "iterumx.ico")
VBS_PATH = os.path.join(PROJECT_DIR, "iniciar_iterumx.vbs")
BAT_PATH = os.path.join(PROJECT_DIR, "start_iterumx.bat")


def ensure_ico_file() -> str:
    src = ISOTIPO_SRC if os.path.exists(ISOTIPO_SRC) else FALLBACK_LOGO
    if not os.path.exists(src):
        return ""
    try:
        img = Image.open(src).convert("RGBA")
        max_side = max(img.width, img.height)
        square = Image.new("RGBA", (max_side, max_side), (255, 255, 255, 0))
        offset = ((max_side - img.width) // 2, (max_side - img.height) // 2)
        square.paste(img, offset, img)
        square.save(
            ICO_PATH,
            format="ICO",
            sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
        )
        return ICO_PATH
    except Exception as e:
        print("Error creating iterumx.ico:", e)
        return ""


def create_desktop_shortcut():
    ico_file = ensure_ico_file()
    target_path = VBS_PATH if os.path.exists(VBS_PATH) else BAT_PATH

    ps_script = f"""
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath 'Iterumx.lnk'
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = '{target_path}'
$Shortcut.WorkingDirectory = '{PROJECT_DIR}'
$Shortcut.Description = 'Abrir Iterumx - Plataforma Contable y Fiscal'
"""
    if ico_file and os.path.exists(ico_file):
        ps_script += f"$Shortcut.IconLocation = '{ico_file},0'\n"
    ps_script += "$Shortcut.Save()\n"

    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
            check=False,
            capture_output=True,
            timeout=10,
        )
    except Exception as e:
        print("Note creating shortcut:", e)


if __name__ == "__main__":
    create_desktop_shortcut()

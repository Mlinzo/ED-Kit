# PyInstaller spec: a one-file EDExplorerKit.exe with the built frontend inside (as `web/`,
# where app.config.default_static_dir looks for it in a frozen exe).
# Build with packaging/build-exe.ps1: it builds the frontend first.
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

here = Path(SPECPATH)
root = here.parent
backend = root / "backend"
web = root / "frontend" / "dist"
if not (web / "index.html").is_file():
    raise SystemExit("frontend/dist is missing: run `npm run build` in frontend/ first")

a = Analysis(
    [str(backend / "app" / "main.py")],
    pathex=[str(backend)],
    datas=[(str(web), "web")],
    # uvicorn picks its loop / protocol implementations by name at runtime.
    hiddenimports=collect_submodules("uvicorn"),
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="EDExplorerKit",
    icon=str(here / "icon.ico"),  # frontend/public/favicon.svg, rendered
    console=True,  # the log window; closing it stops the app
    upx=False,
)

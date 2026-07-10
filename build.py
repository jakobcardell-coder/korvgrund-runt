#!/usr/bin/env python3
"""
Bygger en självständig index.html från src.html + styles.css + app.js + bilder.
CSS, JS och bilderna (base64) bakas in så att sidan fungerar överallt —
även när previewen/filen öppnas utan webbserver.

Kör:  python3 build.py
Redigera src.html (struktur), styles.css (stil) eller app.js (logik) och kör om.
"""
import base64
import pathlib

ROOT = pathlib.Path(__file__).parent

def b64(path):
    return base64.b64encode((ROOT / path).read_bytes()).decode("ascii")

html = (ROOT / "src.html").read_text(encoding="utf-8")
css = (ROOT / "styles.css").read_text(encoding="utf-8")
js = (ROOT / "app.js").read_text(encoding="utf-8")

hero_b64 = b64("assets/hero-web.jpg")
action_b64 = b64("assets/action-web.jpg")

# Lägg actionbandets bakgrund sist i CSS:en (base64 samlat på ett ställe).
# Hero är en <video> med fotot som poster (bakas in nedan).
css_full = (
    css
    + f"\n.action-photo{{background-image:url(data:image/jpeg;base64,{action_b64})}}\n"
)

# Baka in CSS
html = html.replace(
    '<link rel="stylesheet" href="styles.css" />',
    f"<style>\n{css_full}\n</style>",
)
# Baka in JS
html = html.replace(
    '<script src="app.js"></script>',
    f"<script>\n{js}\n</script>",
)
# Baka in hero-videons poster (fotot som visas direkt och som fallback)
html = html.replace("__HERO_POSTER__", f"data:image/jpeg;base64,{hero_b64}")

(ROOT / "index.html").write_text(html, encoding="utf-8")

size = (ROOT / "index.html").stat().st_size
print(f"index.html byggd — {size/1024:.0f} KB (självständig)")
if '<link rel="stylesheet" href="styles.css"' in html:
    print("VARNING: CSS-länken byttes inte ut!")
if '<script src="app.js"' in html:
    print("VARNING: JS-scriptet byttes inte ut!")

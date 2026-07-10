# Bilder & bygge — Korvgrund Runt

`index.html` är **självständig**: CSS, JavaScript och bilderna är inbakade direkt i filen.
Därför fungerar den överallt — dubbelklicka filen, öppna i preview eller lägg på en webbserver,
utan att något behöver ligga bredvid.

## Källfiler (det du redigerar)
| Fil | Innehåll |
|-----|----------|
| `src.html` | HTML-struktur (mall) |
| `styles.css` | All stil |
| `app.js` | All logik |
| `assets/hero-web.jpg` | Hero-bild (bakas in) |
| `assets/action-web.jpg` | Actionband-bild (bakas in) |

Redigera dem och kör sedan bygget så uppdateras `index.html`:

```
python3 build.py
```

`index.html` genereras av bygget — redigera **inte** den direkt (ändringar skrivs över).

## Byta bild
Lägg din nya bild som `assets/hero-web.jpg` (hero) eller `assets/action-web.jpg` (actionband)
— liggande, gärna ~1500 px bred — och kör `python3 build.py`. Bilderna beskärs automatiskt.

## Bildkälla & licens
Riktiga racingfoton från Wikimedia Commons:
- Hero: Roberto — CC BY-SA 4.0
- Actionband: Rennbootarchiv Schulze — CC BY-SA 3.0

Krediten står i sidfoten (krävs av CC BY-SA). Byter du bild, uppdatera krediten i `src.html`.

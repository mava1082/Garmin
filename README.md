# Garmin träningsdashboard

En lokal dashboard som hämtar din Garmin-data och visar hur du mår och utvecklas, med ett konkret
träningsråd för dagen.

![Översikt](docs/screenshot.png)

## Vad den visar

| Del | Vad det betyder |
|---|---|
| **Dagens rekommendation** | En beredskapspoäng 0–100 som väger ihop form (TSB), HRV mot din normalnivå, vilopuls och nattens sömn, och översätter den till *kvalitetspass / normal träning / lugnt pass / vila*. |
| **Fitness, trötthet, form** | Belastning per pass räknas som Banister-TRIMP (tid × pulsreserv). Fitness (CTL) är 42 dagars viktat snitt, trötthet (ATL) 7 dagars och form = fitness − trötthet. |
| **Veckovolym** | Timmar per sport och vecka, de senaste 12 veckorna, mot ditt veckomål. |
| **Intensitet** | Tid per pulszon de senaste 4 veckorna och fördelningen lätt/medel/hårt jämfört med 80/20-modellen. |
| **Återhämtning** | Vilopuls, HRV (med 7-dagarssnitt) och sömn per natt. |
| **Aerob effektivitet** | Meter per hjärtslag på lugna löppass. En stigande kurva betyder bättre kondition. |
| **Insikter** | Automatiska varningar och tips: för snabb ökning, hög akut belastning, för mycket tid i zon 3, sjunkande HRV, sömnbrist, veckomål. |
| **Rekord och senaste pass** | Längsta pass, snabbaste snittempo, största veckan och en tabell över senaste passen. |

## Kom igång på mobilen (ingen kodning, ingen dator)

Dashboarden körs helt hos GitHub. Var tredje timme hämtar GitHub din Garmin-data, bygger sidan
och publicerar den på **https://mava1082.github.io/Garmin/**. Datan krypteras med ett lösenord som
du väljer, så ingen annan kan läsa den, trots att sidan är publik. Allt nedan går att göra i
mobilens webbläsare på github.com.

1. **Gör repot publikt** (krävs för gratis GitHub Pages):
   *Settings → General* → längst ner under *Danger Zone* → **Change visibility → Make public**.
   Bara koden blir synlig. Din nyckel och din data syns aldrig.
2. **Lägg in två hemligheter**: *Settings → Secrets and variables → Actions* → **New repository secret**.
   - Name: `GARMIN_PERSONAL_API_KEY`, Secret: din Personal API Key från Garmin
   - Name: `DASHBOARD_PASSWORD`, Secret: ett lösenord du hittar på (minst 8 tecken). Det är det du skriver på mobilen.
3. **Slå på GitHub Pages**: *Settings → Pages* → under *Build and deployment*, välj Source **GitHub Actions**.
4. **Kör första gången**: fliken *Actions* → **Uppdatera dashboard** → **Run workflow** → **Run workflow**.
   Det tar 2–5 minuter. Får du frågan om att aktivera workflows, godkänn.
5. **Öppna** https://mava1082.github.io/Garmin/ på mobilen och skriv ditt lösenord.
6. **Lägg den på hemskärmen** så att den beter sig som en app:
   - *iPhone (Safari):* Dela-knappen → **Lägg till på hemskärmen**
   - *Android (Chrome):* ⋮-menyn → **Lägg till på startskärmen**

**Att veta**
- Datan uppdateras automatiskt var tredje timme. Knappen **Uppdatera** i dashboarden öppnar
  GitHub, där du trycker *Run workflow* för att hämta direkt.
- **Inställningar** (veckomål, kön, egen maxpuls/vilopuls) ändrar du i filen `settings.json`
  i repot: öppna filen, tryck på pennan, ändra och tryck *Commit changes*. `null` betyder att
  värdet hämtas från dina pulszoner i Garmin.
- **När Garmin-nyckeln går ut** byter du värdet på hemligheten `GARMIN_PERSONAL_API_KEY` (steg 2).
- GitHub pausar schemalagda körningar om repot inte har någon aktivitet på 60 dagar. Du får ett
  mejl om det. Tryck då *Enable workflow* under *Actions*.
- Utan nyckel visas demodata, så du kan se hur sidan ser ut redan innan steg 2.

## Köra på din egen dator (alternativ)

1. Installera [Python](https://www.python.org/downloads/). *Windows:* kryssa i **"Add python.exe to PATH"**.
2. Ladda ner repot som ZIP (**Code → Download ZIP**) och packa upp det.
3. Dubbelklicka på **`start.bat`** (Windows) eller **`start.command`** (Mac). Dashboarden öppnas i webbläsaren.
4. Klicka **Koppla Garmin** och klistra in din Personal API Key.

### För utvecklare

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m garmin_dashboard --open
```

## Koppla din Garmin-data

### Garmin Personal API (rekommenderat)

Garmins officiella, kostnadsfria API för din egen data. Det släpptes i oktober 2026.

1. Logga in på Garmin Connect på webben och skapa en **Personal API Key** under Garmins
   utvecklarsidor. Välj giltighetstid (30 dagar–1 år). Nyckeln visas bara en gång, så spara den.
2. Klistra in den via **Koppla Garmin** i dashboarden, eller lägg den själv i `.env`:
   ```ini
   GARMIN_PERSONAL_API_KEY=din-nyckel
   ```
   När nyckeln finns används Personal API automatiskt (`GARMIN_SOURCE=personal_api`).
3. Hämta historik och starta:
   ```bash
   python -m garmin_dashboard.sync --days 365
   python -m garmin_dashboard
   ```

Dashboarden använder Garmins officiella Python-klient
([`garmin-connect-personal-api-python`](https://github.com/garmin/connect-personal-api-python)).
Den byter nyckeln mot en åtkomsttoken som gäller i 24 timmar och sparas i `~/.config/garmin/`.
Därefter hämtas aktiviteter med pulszoner, dagliga sammanfattningar (vilopuls, steg, stress,
Body Battery), HRV och sömn. Maxpuls och vilopuls hämtas från dina pulszoner i Garmin tills du
ändrar dem själv under ⚙︎.

VO₂max ingår inte i Personal API, så den rutan visas inte.

**Om något ser tomt ut**: kör `python -m garmin_dashboard.probe`. Det visar strukturen på varje
svar (nycklar och typer, inte dina värden) och vad dashboarden lyckades tolka. Det är säkert att dela.

När nyckeln går ut skapar du en ny i Garmin Connect och byter värdet i `.env`.

### Alternativ: garminconnect (inofficiellt)

Biblioteket [`garminconnect`](https://github.com/cyberjunky/python-garminconnect) loggar in med
e-post och lösenord som Garmin Connect-appen. Det ger även VO₂max.

```ini
GARMIN_SOURCE=garminconnect
GARMIN_EMAIL=du@example.com
GARMIN_PASSWORD=...
```

Kör första synken i terminalen (`python -m garmin_dashboard.sync --days 365`) så att du kan skriva
in en MFA-kod. Tokens sparas sedan i `~/.garminconnect`.

## Inställningar

Under ⚙︎ i dashboarden anger du maxpuls, vilopuls, kön (påverkar TRIMP-formeln) och veckomål i
timmar. Korrekt maxpuls är viktigast: den styr både belastningen och zonuppskattningen.

## Kommandon

```bash
python -m garmin_dashboard                       # starta webbservern
python -m garmin_dashboard.sync --days 180       # synka (inkrementellt)
python -m garmin_dashboard.sync --days 365 --full  # hämta om allt
python -m garmin_dashboard.probe                 # felsök Personal API-svar
python -m pytest                                 # tester
```

## Struktur

```
garmin_dashboard/
  analytics.py      belastning, CTL/ATL/TSB, beredskap, insikter, rekord
  sync.py           hämtar från vald källa till SQLite (data/garmin.db)
  build_static.py   bygger den krypterade mobilsidan (körs av GitHub Actions)
  server.py         FastAPI: /api/dashboard, /api/sync, /api/settings
  sources/          demo, personal_api, garminconnect
  static/           dashboarden (HTML/CSS/JS + Chart.js lokalt)
```

`.env`, `data/` och `site/` ignoreras av git. I GitHub Actions sparas databasen i Actions-cachen, och den publicerade sidan innehåller bara krypterad data.

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

## Kom igång

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m garmin_dashboard          # öppna http://127.0.0.1:8000
```

Utan inställningar körs **demoläget** med ett års syntetisk träning, så du ser direkt hur allt fungerar.

## Koppla din Garmin-data

Ordet "API-nyckel" kan betyda två olika saker hos Garmin, och dashboarden stöder båda:

### A) Ditt vanliga Garmin Connect-konto (enklast)

Använder biblioteket [`garminconnect`](https://github.com/cyberjunky/python-garminconnect), som loggar in
som Garmin Connect-appen. Det ger mest data: pulszoner per pass, HRV, Body Battery och VO₂max.

```ini
GARMIN_SOURCE=garminconnect
GARMIN_EMAIL=du@example.com
GARMIN_PASSWORD=...
```

Kör första synken i terminalen så att du kan skriva in en MFA-kod om du har tvåstegsverifiering:

```bash
python -m garmin_dashboard.sync --days 365
```

Därefter sparas tokens i `~/.garminconnect`, och du kan ta bort lösenordet ur `.env` och synka med knappen i dashboarden.

### B) Garmin Connect Developer Program (consumer key + secret)

Om du har ett godkänt utvecklarkonto har du fått en *consumer key* och en *consumer secret*:

```ini
GARMIN_SOURCE=health_api
GARMIN_CONSUMER_KEY=...
GARMIN_CONSUMER_SECRET=...
```

Godkänn sedan appen för ditt eget konto en gång. Kommandot skriver ut access-token som du klistrar in i `.env`:

```bash
python -m garmin_dashboard.health_auth
```

Data hämtas från Health API:s pull-endpoints (`dailies`, `sleeps`, `hrv`, `activities`). Den här
vägen är otestad mot riktiga nycklar. Garmins pull-endpoints har en begränsad lagringstid, och vissa
appar är konfigurerade enbart för push, så kontrollera inställningarna i utvecklarportalen. Health
API skickar inte zontider per pass, så zonerna uppskattas från snittpuls.

## Inställningar

Under ⚙︎ i dashboarden anger du maxpuls, vilopuls, kön (påverkar TRIMP-formeln) och veckomål i
timmar. Korrekt maxpuls är viktigast: den styr både belastningen och zonuppskattningen.

## Kommandon

```bash
python -m garmin_dashboard                       # starta webbservern
python -m garmin_dashboard.sync --days 180       # synka (inkrementellt)
python -m garmin_dashboard.sync --days 365 --full  # hämta om allt
python -m pytest                                 # tester
```

## Struktur

```
garmin_dashboard/
  analytics.py      belastning, CTL/ATL/TSB, beredskap, insikter, rekord
  sync.py           hämtar från vald källa till SQLite (data/garmin.db)
  server.py         FastAPI: /api/dashboard, /api/sync, /api/settings
  sources/          demo, garminconnect, health_api
  static/           dashboarden (HTML/CSS/JS + Chart.js lokalt)
```

All data stannar lokalt i `data/garmin.db`. `.env` och `data/` ignoreras av git.

# FORM

Din privata träningsapp: träning, återhämtning, sömn och vikt i ett lugnt gränssnitt, med en coach som motiverar varje förslag. Byggd för iPhone som installerbar webbapp, och fungerar även på dator.

**Idag · Träning · Återhämtning · Kropp · Coach**

## Så hänger det ihop

```
Garmin Personal API ──(GitHub Actions, varannan timme)──▶ FORM-server (Cloudflare Worker + D1) ◀── appen på mobilen
        nyckeln finns bara här                        lösenordsskyddad, sparar allt          inloggning med session
```

- **Synken** körs i GitHub Actions, eftersom Garmin bevisligen godtar anrop därifrån. Den hämtar bara det som är nytt, håller Garmins anropsgräns, väntar vid 429 och försöker igen nästa gång om något misslyckas.
- **Servern** är en Cloudflare Worker med databasen D1, gratisnivån räcker. Den lagrar data, sköter inloggningen och tar emot check-ins, planändringar och vikt.
- **Appen** räknar ut rekommendationerna i telefonen med samma regler som är testade här, utan någon AI-modell.

## Kom igång (allt går från mobilen)

Du har redan `GARMIN_PERSONAL_API_KEY` och `DASHBOARD_PASSWORD` som hemligheter i GitHub. FORM använder samma hemligheter.

1. **Skapa ett gratis Cloudflare-konto** på [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) och bekräfta e-postadressen.
2. **Skapa en API-token:** gå till [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) och tryck **Create Token**.
   - Välj mallen **Edit Cloudflare Workers** och tryck **Use template**.
   - Under *Permissions*, tryck **+ Add more** och lägg till **Account → D1 → Edit**.
   - Under *Account Resources* väljer du ditt konto. Tryck **Continue to summary** och sedan **Create Token**.
   - Kopiera token. Den visas bara en gång.
3. **Lägg in token i GitHub:** *Settings → Secrets and variables → Actions → New repository secret*. Namnet ska vara `CLOUDFLARE_API_TOKEN` och värdet din token.
4. **Driftsätt:** *Actions → FORM – driftsätt → Run workflow*. När körningen är grön står appens adress i sammanfattningen, till exempel `https://form.form-xxxxxx.workers.dev`.
5. **Hämta Garmin-data:** *Actions → FORM – synka Garmin → Run workflow*. Den första körningen hämtar drygt ett år och tar några minuter.
6. **Öppna adressen i Safari** och logga in med ditt `DASHBOARD_PASSWORD`. Tryck **Dela → Lägg till på hemskärmen**.

Valfritt: skapa en *fine-grained personal access token* i GitHub med behörigheten **Actions: Read and write** för det här repot och spara den som `FORM_GITHUB_TOKEN`. Då startar knappen **Uppdatera** en Garmin-synk direkt. Utan den uppdateras datan automatiskt varannan timme.

## Säkerhet och integritet

- **Garmin-nyckeln** finns bara som GitHub-hemlighet och används bara av synkjobbet. Den finns inte i appen, i webbläsaren, på servern, i loggar eller i git.
- **Inloggningen** är ett lösenord som kontrolleras på servern. Du får en session i en HttpOnly-, Secure- och SameSite=Strict-cookie som gäller i 30 dagar. Efter fem felaktiga försök låses inloggningen i 15 minuter. Alla API-anrop som ändrar något kräver dessutom ett eget huvud som skydd mot CSRF.
- **Synkjobbet** skickar data till servern med en egen token. Den härleds ur lösenordet, så du behöver ingen extra hemlighet.
- **Ingen hälsodata skickas till någon AI.** Appen använder ingen språkmodell.
- **Ingen hälsodata cachas i telefonen.** Bara appskalet cachas för snabb start. Vid utloggning avslutas sessionen på servern.
- **Export och radering** finns under *Inställningar → Dina data*. Radering påverkar inte din data i Garmin Connect.
- **Demoläget** genereras i telefonen, märks tydligt och blandas aldrig med riktiga data.

## Vad Garmin Personal API ger

Det här är verifierat mot Garmins officiella Python-klient (`garmin-connect-personal-api-python` 1.0.0) och mot riktiga svar från ditt konto.

| Område | Status | Kommentar |
|---|---|---|
| API-nyckel → åtkomsttoken | verifierat | Token gäller 24 h. Det finns ingen refresh-token, så en ny hämtas med nyckeln. |
| Anropsgräns | verifierat | Ca 100 anrop per tidsfönster. Svaret 429 innehåller `retryInSeconds`. |
| Aktiviteter (sidindelad lista) | verifierat | Typ, tid, distans, puls, fart, Training Effect. Tid i pulszoner ingår inte. |
| Dagssammanfattning | verifierat | Vilopuls, steg, stress, Body Battery (nästlat format). |
| HRV per natt | verifierat | Nattsnitt, veckosnitt, Garmins normalintervall och status. |
| Sömn per natt | verifierat | Längd, tider, faser och poäng. Natten räknas till uppvakningsdagen. |
| Pulszoner per sport | verifierat | Zongränser, metod (t.ex. % av maxpuls) och maxpuls. |
| FIT-fil per aktivitet | dokumenterat | Tidsserier och varv. Används för grafer och tid i zoner. |
| Vikt och kroppssammansättning (Index S2) | dokumenterat | Hämtas om vågen synkar till Garmin Connect. |
| VO₂max, Training Readiness, Training Status | saknas | Finns inte bland Personal API:s endpoints. |
| Skicka pass till klockan | saknas | API:et är skrivskyddat. |
| Webhooks | saknas | Endast hämtning, därför körs synken på schema. |
| StrengthLog | saknas | Det finns ingen integration, men appen kan importera StrengthLogs CSV-export. |

*Dokumenterat* betyder att endpointen finns i Garmins klient men att svaren inte har setts från ditt konto än. Kör *FORM – synka Garmin* med **probe** ikryssat för att se svarens struktur. Inga värden visas.

## Rekommendationerna

Reglerna finns i `src/core/` och är täckta av tester. Källorna visas i appen under *Coach → Principer och källor*.

- **Återhämtning** är appens egen bedömning i fyra nivåer med säkerhetsgrad. Den är uttryckligen inte Garmins Training Readiness. En enskild dålig natt eller låg HRV kan som mest sänka dagen till "Ta det lugnare". Din egen check-in väger tyngre än klockan.
- **Passförslag** följer ditt veckoupplägg (vecka A/B). Varje förslag innehåller syfte, uppvärmning, huvuddel, nedvarvning, RPE, prattest och dina zoner, plus en motivering med datum och värden.
- **Hårda pass:** högst ett intervallpass per vecka och minst 48 timmar emellan. Missade hårda pass staplas aldrig på senare dagar.
- **Knä och smärta:** ingen löpning vid aktuella knäbesvär eller rapporterad smärta. Appen ställer inga diagnoser och föreslår aldrig att du ska träna igenom smärta. Vid kraftig eller ihållande smärta hänvisar den till vården.
- **Planändringar** sparas bara när du har godkänt förslaget.

## Utveckling

```bash
cd form
npm install
npm test            # 65+ tester: motor, Garmin-adapter, server
npm run typecheck
npm run build
npx wrangler d1 migrations apply form-db --local
npx wrangler dev --local     # http://localhost:8787 (lösenord i .dev.vars)
npx tsx tests/e2e/seed.ts    # testdata via synkens ingest-API
```

Struktur: `src/core` (domän och regler), `src/garmin` (Personal API-adapter, FIT), `src/sync` (körs i Actions), `src/worker` (server), `src/web` (appen), `migrations` (databas).

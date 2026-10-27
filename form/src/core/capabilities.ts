/**
 * What the Garmin Personal API gives FORM, and how sure we are.
 * "verifierat" = seen in live responses from your account.
 * "dokumenterat" = in Garmin's official client, not yet seen live.
 */
export type CapStatus = "verifierat" | "dokumenterat" | "saknas";

export const CAPABILITIES: { area: string; status: CapStatus; note: string }[] = [
  { area: "API-nyckel → åtkomsttoken", status: "verifierat", note: "Nyckeln byts mot en token som gäller 24 h. Ingen refresh-token – en ny hämtas från nyckeln." },
  { area: "Anropsgräns", status: "verifierat", note: "Ca 100 anrop per tidsfönster; Garmin svarar 429 med väntetid. Synken håller takten och väntar." },
  { area: "Aktiviteter (lista, sidindelad)", status: "verifierat", note: "Typ, tid, distans, puls, fart, Training Effect." },
  { area: "Dagssammanfattning", status: "verifierat", note: "Vilopuls, steg, stress och Body Battery." },
  { area: "HRV per natt", status: "verifierat", note: "Nattligt snitt, veckosnitt, Garmins normalintervall och status." },
  { area: "Sömn per natt", status: "verifierat", note: "Längd, tider, faser (uppskattning) och sömnpoäng." },
  { area: "Pulszoner per sport", status: "verifierat", note: "Zongränser, metod och maxpuls från Garmin Connect." },
  { area: "FIT-fil per aktivitet", status: "dokumenterat", note: "Tidsserier (puls, tempo, effekt, kadens, varv) läses ur originalfilen." },
  { area: "Vikt och kroppssammansättning (Index S2)", status: "dokumenterat", note: "Hämtas om vågen synkar till Garmin Connect." },
  { area: "Aktivitetsdetalj och kopplade träningspass", status: "dokumenterat", note: "Används inte ännu." },
  { area: "VO₂max, Training Readiness, Training Status", status: "saknas", note: "Finns inte bland Personal API:s endpoints." },
  { area: "Skicka träningspass till klockan", status: "saknas", note: "Personal API är skrivskyddat – inga uppladdningar." },
  { area: "Webhooks/push", status: "saknas", note: "Bara hämtning (pull). Synken körs på schema." },
  { area: "StrengthLog", status: "saknas", note: "Ingen integration. Import av StrengthLogs CSV-export stöds i appen." },
];

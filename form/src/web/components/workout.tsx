import { MODALITY_LABEL } from "../../core/activities";
import type { Suggestion } from "../../core/coach";
import type { Workout } from "../../core/workouts";
import { Notice } from "./ui";

const KIND: Record<Workout["kind"], string> = { strength: "Styrka", easy: "Lugn kondition", intervals: "Intervaller", recovery: "Återhämtning", rest: "Vila" };
const SRC: Record<string, string> = { plan: "Plan", garmin: "Garmin", "check-in": "Du", regel: "Regel", historik: "Historik" };

export const kindLabel = (w: Workout) => `${KIND[w.kind]}${w.modality && w.kind !== "strength" && w.kind !== "rest" ? ` · ${MODALITY_LABEL[w.modality]}` : ""}`;

export function WorkoutDetails({ s }: { s: Suggestion }) {
  const w = s.workout;
  const block = (title: string, steps: Workout["warmup"]) => steps.length > 0 && (
    <div class="step">
      <h4>{title}</h4>
      <ul>{steps.map((st) => <li>{st.minutes ? <b>{st.minutes} min · </b> : null}{st.text}</li>)}</ul>
    </div>
  );
  return (
    <div class="stack">
      <p class="secondary">{w.purpose}</p>
      {w.kind !== "rest" && <div class="card quiet" style="padding:14px">
        <div class="stack" style="gap:6px">
          <div><b>Intensitet:</b> {w.intensity.rpe}</div>
          <div><b>Prattest:</b> {w.intensity.talk}</div>
          {w.intensity.zones && <div><b>Puls:</b> {w.intensity.zones}</div>}
          {w.intensity.personal && <div class="secondary small">{w.intensity.personal}</div>}
        </div>
      </div>}
      <div class="steps">{block("Uppvärmning", w.warmup)}{block("Huvuddel", w.main)}{block("Nedvarvning", w.cooldown)}</div>
      {w.shorter && <Notice kind="info"><b>Kortare alternativ:</b> {w.shorter}</Notice>}
      {w.notes.map((n) => <Notice kind="info">{n}</Notice>)}
      {s.notices.filter((n) => !n.startsWith("Gör dagens check-in")).map((n) => <Notice>{n}</Notice>)}
      <div>
        <h4 class="section-title" style="margin:6px 0 10px">Därför föreslår vi detta</h4>
        <ul class="reasons">{s.reasons.map((r) => <li><span class="src">{SRC[r.source] ?? r.source}</span><span>{r.text}</span></li>)}</ul>
        <p class="muted tiny" style="margin-top:12px">Förslagen bygger på regler du kan läsa under Coach → Principer och källor. Inga siffror hittas på; saknas data står det så.</p>
      </div>
    </div>
  );
}

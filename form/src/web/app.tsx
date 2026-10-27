import { useState } from "preact/hooks";
import { Icon, useAsync } from "./components/ui";
import { Body } from "./pages/body";
import { Coach } from "./pages/coach";
import { Recovery } from "./pages/recovery";
import { Settings } from "./pages/settings";
import { Today } from "./pages/today";
import { Training } from "./pages/training";
import { navigate, useRoute } from "./router";
import { useStore } from "./store";

const TABS = [
  { path: "idag", label: "Idag", icon: "today" },
  { path: "traning", label: "Träning", icon: "training" },
  { path: "aterhamtning", label: "Återhämtning", icon: "recovery" },
  { path: "kropp", label: "Kropp", icon: "body" },
  { path: "coach", label: "Coach", icon: "coach" },
];

export function App() {
  const store = useStore();
  const route = useRoute();
  if (store.status === "loading") return <Loading />;
  if (store.status === "login") return <Login />;
  if (store.status === "error" || !store.bundle) return <ErrorView />;
  const b = store.bundle;
  const [top, sub, id] = route;
  return (
    <>
      <main class="app">
        {b.mode === "demo" && <div class="banner demo" role="status"><span><b>Demoläge</b> – allt du ser är påhittat och sparas inte.</span><button class="link" onClick={() => store.logout()}>Lämna</button></div>}
        {store.error && <div class="banner error" role="alert"><span>{store.error}</span><button class="link" onClick={() => store.refresh()}>Försök igen</button></div>}
        {top === "traning" ? <Training sub={sub} id={id} /> : top === "aterhamtning" ? <Recovery /> : top === "kropp" ? <Body /> : top === "coach" ? <Coach /> : top === "installningar" ? <Settings /> : <Today />}
      </main>
      <div class="tabbar">
        <nav aria-label="Huvudmeny">{TABS.map((t) => (
          <a class="tab" href={`#/${t.path}`} aria-current={top === t.path || (t.path === "idag" && !TABS.some((x) => x.path === top) && top !== "installningar") ? "page" : undefined}
            onClick={(e) => { e.preventDefault(); navigate(t.path); }}>
            <Icon name={t.icon} /><span>{t.label}</span>
          </a>))}</nav>
      </div>
    </>
  );
}

function Loading() {
  return (
    <main class="app" aria-busy="true">
      <div class="skeleton" style="height:40px;width:55%;margin:12px 0 24px" />
      <div class="skeleton" style="height:180px;margin-bottom:14px" />
      <div class="skeleton" style="height:220px" />
    </main>
  );
}

function ErrorView() {
  const store = useStore();
  return (
    <div class="login"><div class="card">
      <p class="wordmark">FORM</p>
      <h2 style="margin-top:18px">Kunde inte nå servern</h2>
      <p class="secondary" style="margin-top:8px">{store.error ?? "Okänt fel."} Kontrollera uppkopplingen.</p>
      <div class="row" style="margin-top:18px"><button class="btn primary" onClick={() => location.reload()}>Försök igen</button><button class="btn" onClick={() => store.enterDemo()}>Visa demo</button></div>
    </div></div>
  );
}

function Login() {
  const store = useStore();
  const [pw, setPw] = useState("");
  const { busy, error, run } = useAsync();
  return (
    <div class="login">
      <form class="card fade-in" onSubmit={(e) => { e.preventDefault(); run(() => store.login(pw)); }}>
        <p class="wordmark">FORM</p>
        <h1 style="font-size:28px;margin-top:22px">Din träning, begriplig.</h1>
        <p class="secondary" style="margin-top:8px">Logga in med lösenordet du valde i GitHub (DASHBOARD_PASSWORD).</p>
        <label class="field" style="margin-top:22px">Lösenord
          <input class="input" type="password" autocomplete="current-password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} required /></label>
        {error && <p class="small" style="color:var(--attention);margin-top:10px" role="alert">{error}</p>}
        <button class="btn primary block" style="margin-top:16px" disabled={busy || !pw}>{busy ? "Loggar in…" : "Logga in"}</button>
        <div class="divider" />
        <button type="button" class="btn ghost block" onClick={() => store.enterDemo()}>Utforska med påhittade data</button>
        <p class="tiny muted" style="margin-top:10px;text-align:center">Demoläget blandas aldrig med dina riktiga data.</p>
      </form>
    </div>
  );
}

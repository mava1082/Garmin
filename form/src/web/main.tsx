import { render } from "preact";
import { App } from "./app";
import { StoreProvider } from "./store";
import "./styles.css";

render(<StoreProvider><App /></StoreProvider>, document.getElementById("root")!);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

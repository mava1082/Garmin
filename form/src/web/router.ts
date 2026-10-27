import { useEffect, useState } from "preact/hooks";

/** Hash routing keeps the app a single static page that works offline and on GitHub-less hosting. */
export function navigate(path: string) {
  location.hash = `#/${path}`;
  window.scrollTo({ top: 0 });
}

export function currentPath(): string {
  return location.hash.replace(/^#\/?/, "") || "idag";
}

export function useRoute(): string[] {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return path.split("/");
}

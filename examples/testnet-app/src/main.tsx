import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

/*
 * No <StrictMode> here, deliberately.
 *
 * StrictMode mounts, runs effect cleanups, then remounts — and @kollectyve/react 0.1.0-alpha.1
 * destroyed the memoised client in that cleanup, handing the remount a dead one: socket gone,
 * every read hanging forever, no error in the console. Fixed in the provider from alpha.2
 * (teardown is deferred so a remount cancels it); restore StrictMode once this app is on it.
 */
createRoot(document.getElementById("root")!).render(<App />);

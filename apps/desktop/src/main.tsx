import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { connect } from "./store/live.ts";

const root = document.getElementById("root");
if (root === null) throw new Error("The page has no #root element.");
connect();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

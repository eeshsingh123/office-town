import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { followRecentPosts } from "./features/feed/recent-posts.ts";
import { showNotices } from "./features/requests/notifications.ts";
import { connect } from "./store/live.ts";
import { applyTheme } from "./ui/theme.ts";

const root = document.getElementById("root");
if (root === null) throw new Error("The page has no #root element.");
applyTheme();
connect();
showNotices();
followRecentPosts();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

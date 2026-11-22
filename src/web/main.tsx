import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./globals.css";
import { SessionProvider } from "./session";
import { PreferencesProvider } from "./preferences";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <PreferencesProvider>
          <App />
        </PreferencesProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);

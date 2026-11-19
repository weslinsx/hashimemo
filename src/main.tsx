import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Bubble } from "./Bubble";
import "./styles/app.css";

const bubble = new URLSearchParams(window.location.search).has("bubble");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {bubble ? <Bubble /> : <App />}
  </React.StrictMode>,
);

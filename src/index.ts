declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

import "./energy-custom-graph-card";
import "./energy-custom-graph-card-editor";

window.customCards = window.customCards || [];
window.customCards.push({
  type: "new-statistics-graph",
  name: "New Statistics Graph",
  description:
    "General-purpose graph for any recorder statistics, history, and forecast data with custom stacking, dual axes, and colors.",
});

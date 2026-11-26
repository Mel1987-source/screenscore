import { $, includeAnimation, state } from "./core.js";
import { hasImdbData, imdbDataDate } from "./imdbData.js";
import { syncConfigured } from "./sync.js";

export function openSettings() {
  $("apiKey").value = state.key;
  $("workerProxyUrl").value = state.proxy;
  $("showAdult").checked = state.showAdult;
  $("includeAnimation").checked = includeAnimation();
  $("syncToken").value = state.syncToken;
  $("syncStatus").textContent = syncConfigured() ? "" : "Ανενεργός";
  $("datasetStatus").textContent = hasImdbData()
    ? `Δεδομένα IMDb: ενημέρωση ${imdbDataDate()}.`
    : "Δεν βρέθηκαν τα ημερήσια δεδομένα IMDb (data/imdb-titles.json). Χωρίς αυτά δεν υπάρχουν βαθμολογίες — δες το README για το GitHub Action.";
  $("settingsMessage").textContent = "";
  $("settingsDialog").showModal();
}

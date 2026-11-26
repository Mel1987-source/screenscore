// Netflix / Cinobo availability in Cyprus, carried in the daily IMDb data (JustWatch data via TMDB).
// Bit 1 = Netflix, bit 2 = Cinobo. No other services are shown anywhere.
import { $ } from "./core.js";
import { datasetItem } from "./imdbData.js";

export const SERVICES = [
  { bit: 1, name: "Netflix", cls: "svc-netflix" },
  { bit: 2, name: "Cinobo", cls: "svc-cinobo" },
];
export function serviceBits(x) {
  if (typeof x._where === "number") return x._where;
  const d = datasetItem(x);
  return d ? d._where || 0 : 0;
}
export function serviceNames(x) {
  const bits = serviceBits(x);
  return SERVICES.filter((s) => bits & s.bit);
}
// The "Where to watch" filter: 0 = everything, otherwise a bitmask of accepted services.
export function selectedServices() {
  return Number($("serviceFilter")?.value) || 0;
}
export function matchesService(x) {
  const mask = selectedServices();
  return !mask || Boolean(serviceBits(x) & mask);
}
export function serviceChipsHtml(x) {
  return serviceNames(x)
    .map((s) => `<span class="service-chip ${s.cls}">${s.name}</span>`)
    .join("");
}

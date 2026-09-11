import { config } from "../../config.js";
import type { ProviderKind, WhatsAppConnection, WhatsAppProvider } from "../types.js";
import { CloudAPIProvider } from "./CloudAPIProvider.js";
import { DemoProvider } from "./DemoProvider.js";
import { EvolutionProvider } from "./EvolutionProvider.js";

const evolutionProvider = new EvolutionProvider();
const cloudApiProvider = new CloudAPIProvider();
const demoProvider = new DemoProvider();

export function resolveProviderKind(requested: ProviderKind = "evolution"): ProviderKind {
  if (config.demoMode) return "demo";
  return requested;
}

export function getProvider(kind: ProviderKind | WhatsAppConnection): WhatsAppProvider {
  const provider = typeof kind === "string" ? kind : kind.provider;
  if (provider === "demo") return demoProvider;
  if (provider === "evolution") return evolutionProvider;
  if (provider === "cloud_api") return cloudApiProvider;
  throw new Error(`Unknown WhatsApp provider: ${String(provider)}`);
}

export { evolutionProvider };

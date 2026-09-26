/**
 * lib/turrets.ts
 * Frontend API helpers for Turrets txFunctions.
 */

export type TurretsType = "dca" | "stop_loss";

export interface TurretsDeployment {
  id: string;
  ownerPublicKey: string;
  type: TurretsType;
  status: "active" | "paused";
  config: Record<string, unknown>;
  deploymentHash: string;
  createdAt: string;
  nextRunAt: string | null;
  lastExecutedAt: string | null;
  lastCheckedAt: string | null;
  lastObservedPriceUsd: number | null;
  lastError: string | null;
}

export interface TurretsExecutionHistory {
  id: string;
  deploymentId: string;
  status: string;
  message: string;
  result: Record<string, unknown> | null;
  createdAt: string;
}

function apiBase() {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
}

async function parseJson(res: Response) {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "Turrets API request failed");
  }
  return json.data;
}

export async function createTurretsChallenge(params: {
  ownerPublicKey: string;
  type: TurretsType;
  config: Record<string, unknown>;
}) {
  const res = await fetch(`${apiBase()}/api/turrets/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  return parseJson(res) as Promise<{
    challengeXDR: string;
    deploymentHash: string;
    normalizedConfig: Record<string, unknown>;
    networkPassphrase: string;
  }>;
}

export async function deployTurretsFunction(params: {
  ownerPublicKey: string;
  type: TurretsType;
  config: Record<string, unknown>;
  deploymentHash: string;
  signedChallengeXDR: string;
}) {
  const res = await fetch(`${apiBase()}/api/turrets/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  return parseJson(res) as Promise<TurretsDeployment>;
}

export async function listTurretsFunctions(ownerPublicKey: string) {
  const res = await fetch(
    `${apiBase()}/api/turrets?ownerPublicKey=${encodeURIComponent(ownerPublicKey)}`
  );

  return parseJson(res) as Promise<TurretsDeployment[]>;
}

export interface TurretsDcaRequest {
  ownerPublicKey: string;
  intervalMinutes: number;
  amountQuote: number;
  quoteAssetCode?: string;
  quoteAssetIssuer?: string | null;
}

export interface TurretsStopLossRequest {
  ownerPublicKey: string;
  thresholdPrice: number;
  amountSell: number;
  sellAssetCode?: string;
  sellAssetIssuer?: string | null;
  cooldownMinutes?: number;
}

export interface TurretsAutomationResponse extends TurretsDeployment {
  turretSignerAddress: string;
}

export async function createDcaAutomation(params: TurretsDcaRequest) {
  const res = await fetch(`${apiBase()}/api/turrets/dca`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  return parseJson(res) as Promise<TurretsAutomationResponse>;
}

export async function createStopLossAutomation(params: TurretsStopLossRequest) {
  const res = await fetch(`${apiBase()}/api/turrets/stop-loss`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  return parseJson(res) as Promise<TurretsAutomationResponse>;
}

export async function getTurretSignerAddress(): Promise<string> {
  const res = await fetch(`${apiBase()}/api/turrets/signer`);
  const data = (await parseJson(res)) as { turretSignerAddress: string };
  return data.turretSignerAddress;
}
export async function getTurretsHistory(id: string) {
  const res = await fetch(`${apiBase()}/api/turrets/${encodeURIComponent(id)}/history`);
  return parseJson(res) as Promise<TurretsExecutionHistory[]>;
}

export async function pauseTurretsFunction(id: string) {
  const res = await fetch(`${apiBase()}/api/turrets/${encodeURIComponent(id)}/pause`, {
    method: "POST",
  });

  return parseJson(res) as Promise<TurretsDeployment>;
}

export async function resumeTurretsFunction(id: string) {
  const res = await fetch(`${apiBase()}/api/turrets/${encodeURIComponent(id)}/resume`, {
    method: "POST",
  });

  return parseJson(res) as Promise<TurretsDeployment>;
}

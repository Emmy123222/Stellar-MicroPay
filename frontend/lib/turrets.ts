/**
 * lib/turrets.ts
 * Frontend API helpers for Turrets txFunctions.
 */

import { apiFetch } from "./api";

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


/** Request a signed-challenge XDR from the backend for deploying a new Turrets automation. */
export async function createTurretsChallenge(params: {
  ownerPublicKey: string;
  type: TurretsType;
  config: Record<string, unknown>;
}) {
  return apiFetch<{
    challengeXDR: string;
    deploymentHash: string;
    normalizedConfig: Record<string, unknown>;
    networkPassphrase: string;
  }>("/api/turrets/challenge", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Submit the signed challenge to deploy a new Turrets automation and return the created deployment. */
export async function deployTurretsFunction(params: {
  ownerPublicKey: string;
  type: TurretsType;
  config: Record<string, unknown>;
  deploymentHash: string;
  signedChallengeXDR: string;
}) {
  return apiFetch<TurretsDeployment>("/api/turrets/deploy", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Fetch all Turrets deployments owned by the given public key. */
export async function listTurretsFunctions(
  ownerPublicKey: string
): Promise<TurretsDeployment[]> {
  const result = await apiFetch<TurretsDeployment[]>(
    `/api/turrets?ownerPublicKey=${encodeURIComponent(ownerPublicKey)}`
  );
  return Array.isArray(result) ? result : [];
}

/** Fetch the execution history for a Turrets deployment by id. */
export async function getTurretsHistory(
  id: string
): Promise<TurretsExecutionHistory[]> {
  const result = await apiFetch<TurretsExecutionHistory[]>(
    `/api/turrets/${encodeURIComponent(id)}/history`
  );
  return Array.isArray(result) ? result : [];
}

/** Pause an active Turrets deployment by id. */
export async function pauseTurretsFunction(
  id: string
): Promise<TurretsDeployment> {
  return apiFetch<TurretsDeployment>(
    `/api/turrets/${encodeURIComponent(id)}/pause`,
    {
      method: "POST",
    }
  );
}

/** Resume a paused Turrets deployment by id. */
export async function resumeTurretsFunction(
  id: string
): Promise<TurretsDeployment> {
  return apiFetch<TurretsDeployment>(
    `/api/turrets/${encodeURIComponent(id)}/resume`,
    {
      method: "POST",
    }
  );
}

import type { StixDraftSummary, StixObjectSummary } from "./stix";

export type StixConnectionState = "committed" | "draft";

export interface StixConnectionEndpoint {
  available: boolean;
  displayName: string;
  localId: string | null;
  objectType: string;
  stixId: string | null;
}

export interface StixConnection {
  id: string;
  relationshipType: string;
  source: StixConnectionEndpoint;
  state: StixConnectionState;
  target: StixConnectionEndpoint;
}

export function draftDisplayName(draft: StixDraftSummary): string {
  for (const property of ["name", "value", "subject"]) {
    const value = draft.properties[property];
    if (typeof value === "string" && value.trim()) return value;
  }
  return `${readableToken(draft.objectType)} draft`;
}

export function buildStixConnections(
  objects: readonly StixObjectSummary[],
  drafts: readonly StixDraftSummary[],
): StixConnection[] {
  const endpoints = new Map<string, StixConnectionEndpoint>();
  for (const object of objects) {
    if (object.objectType === "relationship") continue;
    endpoints.set(object.localId, {
      available: true,
      displayName: object.displayName,
      localId: object.localId,
      objectType: object.objectType,
      stixId: object.stixId,
    });
  }
  for (const draft of drafts) {
    if (draft.objectType === "relationship") continue;
    endpoints.set(draft.localId, {
      available: true,
      displayName: draftDisplayName(draft),
      localId: draft.localId,
      objectType: draft.objectType,
      stixId: draft.replacesStixId ?? null,
    });
  }

  const committed = objects.flatMap<StixConnection>((object) => {
    const relationship = object.relationship;
    if (!relationship) return [];
    return [
      {
        id: object.localId,
        relationshipType: relationship.relationshipType,
        source: endpointForReference(endpoints, relationship.sourceId, relationship.sourceRef),
        state: "committed",
        target: endpointForReference(endpoints, relationship.targetId, relationship.targetRef),
      },
    ];
  });
  const draftConnections = drafts.flatMap<StixConnection>((draft) => {
    if (
      draft.objectType !== "relationship" ||
      !draft.sourceId ||
      !draft.targetId ||
      !draft.relationshipType
    ) {
      return [];
    }
    return [
      {
        id: draft.localId,
        relationshipType: draft.relationshipType,
        source: endpointForLocalId(endpoints, draft.sourceId),
        state: "draft",
        target: endpointForLocalId(endpoints, draft.targetId),
      },
    ];
  });
  return [...committed, ...draftConnections];
}

export function connectionsForEndpoint(
  connections: readonly StixConnection[],
  localId: string,
): { incoming: StixConnection[]; outgoing: StixConnection[] } {
  return {
    incoming: connections.filter((connection) => connection.target.localId === localId),
    outgoing: connections.filter((connection) => connection.source.localId === localId),
  };
}

function endpointForReference(
  endpoints: ReadonlyMap<string, StixConnectionEndpoint>,
  localId: string | undefined,
  stixId: string,
): StixConnectionEndpoint {
  if (localId) {
    const endpoint = endpoints.get(localId);
    if (endpoint) return endpoint;
  }
  return {
    available: false,
    displayName: stixId,
    localId: null,
    objectType: stixId.split("--", 1)[0] ?? "unknown",
    stixId,
  };
}

function endpointForLocalId(
  endpoints: ReadonlyMap<string, StixConnectionEndpoint>,
  localId: string,
): StixConnectionEndpoint {
  return (
    endpoints.get(localId) ?? {
      available: false,
      displayName: localId,
      localId,
      objectType: "unknown",
      stixId: null,
    }
  );
}

function readableToken(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

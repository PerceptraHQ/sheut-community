import { describe, expect, it } from "vitest";
import type { StixDraftSummary, StixObjectSummary } from "./stix";
import { buildStixConnections, connectionsForEndpoint } from "./stixConnections";

const APT1_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const UGLY_GORILLA_ID = "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb";
const JACK_WANG_ID = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";

const objects: StixObjectSummary[] = [
  {
    localId: APT1_ID,
    stixId: "intrusion-set--da1065ce-972c-4605-8755-9cd1074e3b5a",
    objectType: "intrusion-set",
    displayName: "APT1",
    modified: "2015-05-15T09:12:16.000Z",
  },
  {
    localId: UGLY_GORILLA_ID,
    stixId: "threat-actor--6d179234-61fc-40c4-ae86-3d53308d8e65",
    objectType: "threat-actor",
    displayName: "Ugly Gorilla",
    modified: "2015-05-15T09:12:16.000Z",
  },
  {
    localId: JACK_WANG_ID,
    stixId: "identity--a9119a87-6576-46af-bfd7-4fbe55926671",
    objectType: "identity",
    displayName: "JackWang",
    modified: "2015-05-15T09:12:16.000Z",
  },
  {
    localId: "765815fb-d993-4a1d-959f-7f7bcc4a5eb3",
    stixId: "relationship--765815fb-d993-4a1d-959f-7f7bcc4a5eb3",
    objectType: "relationship",
    displayName: "relationship--765815fb-d993-4a1d-959f-7f7bcc4a5eb3",
    modified: "2015-05-15T09:12:16.000Z",
    relationship: {
      relationshipType: "attributed-to",
      sourceRef: "intrusion-set--da1065ce-972c-4605-8755-9cd1074e3b5a",
      targetRef: "threat-actor--6d179234-61fc-40c4-ae86-3d53308d8e65",
      sourceId: APT1_ID,
      targetId: UGLY_GORILLA_ID,
    },
  },
];

const drafts: StixDraftSummary[] = [
  {
    localId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
    objectType: "relationship",
    properties: {},
    sourceId: UGLY_GORILLA_ID,
    targetId: JACK_WANG_ID,
    relationshipType: "attributed-to",
  },
];

describe("STIX connection projections", () => {
  it("keeps APT1 attribution outgoing and exposes it as incoming for the target", () => {
    const connections = buildStixConnections(objects, drafts);

    const apt1 = connectionsForEndpoint(connections, APT1_ID);
    expect(apt1.incoming).toEqual([]);
    expect(apt1.outgoing).toHaveLength(1);
    expect(apt1.outgoing[0]).toEqual(
      expect.objectContaining({ relationshipType: "attributed-to", state: "committed" }),
    );

    const uglyGorilla = connectionsForEndpoint(connections, UGLY_GORILLA_ID);
    expect(uglyGorilla.incoming[0]?.source.displayName).toBe("APT1");
    expect(uglyGorilla.outgoing[0]?.target.displayName).toBe("JackWang");
    expect(uglyGorilla.outgoing[0]?.state).toBe("draft");
  });

  it("retains an unavailable external endpoint instead of dropping the relationship", () => {
    const externalRef = "identity--94624865-2709-443f-9b4c-2891985fd69b";
    const connections = buildStixConnections(
      [
        ...objects,
        {
          localId: "94624865-2709-443f-9b4c-2891985fd69b",
          stixId: "relationship--94624865-2709-443f-9b4c-2891985fd69b",
          objectType: "relationship",
          displayName: "External attribution",
          modified: "2015-05-15T09:12:16.000Z",
          relationship: {
            relationshipType: "attributed-to",
            sourceRef: objects[0]?.stixId ?? "",
            targetRef: externalRef,
            sourceId: APT1_ID,
          },
        },
      ],
      drafts,
    );

    const external = connectionsForEndpoint(connections, APT1_ID).outgoing.find(
      (connection) => connection.target.stixId === externalRef,
    );
    expect(external?.target).toEqual(
      expect.objectContaining({
        available: false,
        displayName: externalRef,
        objectType: "identity",
      }),
    );
  });
});

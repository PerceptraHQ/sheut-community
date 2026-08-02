import type { StixObjectType } from "./stix";

export type StixFieldKind =
  | "text"
  | "textarea"
  | "integer"
  | "number"
  | "boolean"
  | "timestamp"
  | "string-list"
  | "reference"
  | "reference-list"
  | "json"
  | "enum";

export interface StixFieldDefinition {
  description?: string;
  kind: StixFieldKind;
  required?: boolean;
  managed?: boolean;
  options?: readonly string[];
  referenceTypes?: readonly string[];
  structuredRoot?: "list" | "object";
}

export interface StixObjectSchema {
  fields: Readonly<Record<string, StixFieldDefinition>>;
  requirements?: readonly string[];
}

const field = (
  kind: StixFieldKind,
  options: Partial<Omit<StixFieldDefinition, "kind">> = {},
): StixFieldDefinition => ({ kind, ...options });
const required = (kind: StixFieldKind, options: readonly string[] = []) =>
  field(kind, { required: true, ...(options.length ? { options } : {}) });
const structured = (structuredRoot: "list" | "object", requiredValue = false) =>
  field("json", { structuredRoot, ...(requiredValue ? { required: true } : {}) });
const reference = (...referenceTypes: string[]) => field("reference", { referenceTypes });
const references = (...referenceTypes: string[]) => field("reference-list", { referenceTypes });

const commonDomainFields = {
  created: field("timestamp", { required: true, managed: true }),
  modified: field("timestamp", { required: true, managed: true }),
  created_by_ref: reference("identity"),
  labels: field("string-list"),
  revoked: field("boolean"),
  confidence: field("integer"),
  lang: field("text"),
  external_references: structured("list"),
  object_marking_refs: references("marking-definition"),
  granular_markings: structured("list"),
  extensions: structured("object"),
} satisfies Record<string, StixFieldDefinition>;

const commonObservableFields = {
  defanged: field("boolean"),
  object_marking_refs: references("marking-definition"),
  granular_markings: structured("list"),
  extensions: structured("object"),
} satisfies Record<string, StixFieldDefinition>;

const named = {
  name: required("text"),
  description: field("textarea"),
};

const domain = (
  fields: Record<string, StixFieldDefinition>,
  requirements: readonly string[] = [],
): StixObjectSchema => ({
  fields: { ...commonDomainFields, ...fields },
  ...(requirements.length ? { requirements } : {}),
});
const observable = (
  fields: Record<string, StixFieldDefinition>,
  requirements: readonly string[] = [],
): StixObjectSchema => ({
  fields: { ...commonObservableFields, ...fields },
  ...(requirements.length ? { requirements } : {}),
});

const implementationLanguages = [
  "applescript",
  "bash",
  "c",
  "c++",
  "c#",
  "go",
  "java",
  "javascript",
  "lua",
  "objective-c",
  "perl",
  "php",
  "powershell",
  "python",
  "ruby",
  "rust",
  "scala",
  "swift",
  "typescript",
  "visual-basic",
] as const;

const identitySectors = [
  "agriculture",
  "aerospace",
  "automotive",
  "chemical",
  "commercial",
  "communications",
  "construction",
  "defense",
  "education",
  "energy",
  "entertainment",
  "financial-services",
  "government",
  "healthcare",
  "hospitality-leisure",
  "infrastructure",
  "insurance",
  "legal",
  "manufacturing",
  "mining",
  "non-profit",
  "pharmaceuticals",
  "retail",
  "technology",
  "telecommunications",
  "transportation",
  "utilities",
] as const;

const infrastructureTypes = [
  "amplification",
  "anonymization",
  "botnet",
  "command-and-control",
  "control-system",
  "exfiltration",
  "firewall",
  "hosting-malware",
  "hosting-target-lists",
  "phishing",
  "reconnaissance",
  "routers-switches",
  "staging",
  "workstation",
] as const;

export const stixObjectSchemas: Readonly<Record<StixObjectType, StixObjectSchema>> = {
  "attack-pattern": domain({
    ...named,
    aliases: field("string-list"),
    kill_chain_phases: structured("list"),
  }),
  campaign: domain({
    ...named,
    aliases: field("string-list"),
    first_seen: field("timestamp"),
    last_seen: field("timestamp"),
    objective: field("textarea"),
  }),
  "course-of-action": domain(named),
  grouping: domain({
    name: field("text"),
    description: field("textarea"),
    context: required("enum", ["suspicious-activity", "malware-analysis", "unspecified"]),
    object_refs: required("reference-list"),
  }),
  identity: domain({
    ...named,
    roles: field("string-list"),
    identity_class: field("enum", {
      options: ["individual", "group", "system", "organization", "class", "unknown"],
    }),
    sectors: field("string-list", { options: identitySectors }),
    contact_information: field("textarea"),
  }),
  incident: domain(named),
  indicator: domain({
    indicator_types: field("string-list"),
    name: field("text"),
    description: field("textarea"),
    pattern: required("textarea"),
    pattern_type: field("enum", {
      required: true,
      options: ["stix", "pcre", "sigma", "snort", "suricata", "yara"],
      description:
        "Pattern language: STIX, PCRE, Sigma, Snort, Suricata, or YARA. This tells consumers how to interpret the pattern.",
    }),
    pattern_version: field("text"),
    valid_from: required("timestamp"),
    valid_until: field("timestamp"),
    kill_chain_phases: structured("list"),
  }),
  infrastructure: domain({
    ...named,
    infrastructure_types: field("string-list", { options: infrastructureTypes }),
    aliases: field("string-list"),
    kill_chain_phases: structured("list"),
    first_seen: field("timestamp"),
    last_seen: field("timestamp"),
  }),
  "intrusion-set": domain({
    ...named,
    aliases: field("string-list"),
    first_seen: field("timestamp"),
    last_seen: field("timestamp"),
    goals: field("string-list"),
    resource_level: field("text"),
    primary_motivation: field("text"),
    secondary_motivations: field("string-list"),
  }),
  location: domain(
    {
      name: field("text"),
      description: field("textarea"),
      latitude: field("number"),
      longitude: field("number"),
      precision: field("number"),
      region: field("text"),
      country: field("text"),
      administrative_area: field("text"),
      city: field("text"),
      street_address: field("text"),
      postal_code: field("text"),
    },
    [
      "Provide a region, a country, or both latitude and longitude. Precision requires coordinates.",
    ],
  ),
  malware: domain(
    {
      malware_types: field("string-list"),
      is_family: required("boolean"),
      name: field("text"),
      description: field("textarea"),
      aliases: field("string-list"),
      kill_chain_phases: structured("list"),
      first_seen: field("timestamp"),
      last_seen: field("timestamp"),
      operating_system_refs: references("software"),
      architecture_execution_envs: field("string-list"),
      implementation_languages: field("string-list", { options: implementationLanguages }),
      capabilities: field("string-list"),
      sample_refs: references("artifact", "file"),
    },
    ["Name is required when Is Family is true."],
  ),
  "malware-analysis": domain({
    product: required("text"),
    version: field("text"),
    configuration_version: field("text"),
    modules: field("string-list"),
    analysis_engine_version: field("text"),
    analysis_definition_version: field("text"),
    submitted: field("timestamp"),
    analysis_started: field("timestamp"),
    analysis_ended: field("timestamp"),
    result_name: field("text"),
    result: field("enum", { options: ["malicious", "suspicious", "benign", "unknown"] }),
    host_vm_ref: reference("software"),
    operating_system_ref: reference("software"),
    installed_software_refs: references("software"),
    analysis_sco_refs: field("reference-list"),
    sample_ref: reference("artifact", "file"),
  }),
  note: domain({
    abstract: field("text"),
    content: required("textarea"),
    authors: field("string-list"),
    object_refs: required("reference-list"),
  }),
  "observed-data": domain(
    {
      first_observed: required("timestamp"),
      last_observed: required("timestamp"),
      number_observed: required("integer"),
      object_refs: field("reference-list"),
      objects: structured("object"),
    },
    [
      "Provide Object Refs for STIX 2.1 observations, or legacy embedded Objects for compatible imported data.",
    ],
  ),
  opinion: domain({
    explanation: field("textarea"),
    authors: field("string-list"),
    object_refs: required("reference-list"),
    opinion: required("enum", [
      "strongly-disagree",
      "disagree",
      "neutral",
      "agree",
      "strongly-agree",
    ]),
  }),
  report: domain({
    report_types: field("string-list", {
      options: [
        "attack-pattern",
        "campaign",
        "identity",
        "incident",
        "indicator",
        "intrusion-set",
        "malware",
        "observed-data",
        "threat-actor",
        "threat-report",
        "tool",
        "vulnerability",
      ],
    }),
    ...named,
    published: required("timestamp"),
    object_refs: required("reference-list"),
  }),
  "threat-actor": domain({
    threat_actor_types: field("string-list", {
      options: [
        "activist",
        "competitor",
        "crime-syndicate",
        "criminal",
        "hacker",
        "insider-accidental",
        "insider-disgruntled",
        "nation-state",
        "private-sector",
        "sensationalist",
        "spy",
        "terrorist",
        "unknown",
      ],
    }),
    ...named,
    aliases: field("string-list"),
    roles: field("string-list"),
    goals: field("string-list"),
    first_seen: field("timestamp"),
    last_seen: field("timestamp"),
    sophistication: field("text"),
    resource_level: field("text"),
    primary_motivation: field("text"),
    secondary_motivations: field("string-list"),
    personal_motivations: field("string-list"),
  }),
  tool: domain({
    ...named,
    aliases: field("string-list"),
    tool_types: field("string-list"),
    tool_version: field("text"),
    kill_chain_phases: structured("list"),
  }),
  vulnerability: domain(named),
  artifact: observable(
    {
      mime_type: field("text"),
      payload_bin: field("textarea"),
      url: field("text"),
      hashes: structured("object"),
      encryption_algorithm: field("text"),
      decryption_key: field("text"),
    },
    [
      "Provide Payload Bin, or provide URL together with Hashes. Payload Bin and URL are mutually exclusive.",
    ],
  ),
  "autonomous-system": observable({
    number: required("integer"),
    name: field("text"),
    rir: field("text"),
  }),
  directory: observable({
    path: required("text"),
    path_enc: field("text"),
    ctime: field("timestamp"),
    mtime: field("timestamp"),
    atime: field("timestamp"),
    contains_refs: field("reference-list"),
  }),
  "domain-name": observable({
    value: required("text"),
    resolves_to_refs: references("domain-name", "ipv4-addr", "ipv6-addr"),
  }),
  "email-addr": observable({
    value: required("text"),
    display_name: field("text"),
    belongs_to_ref: reference("user-account"),
  }),
  "email-message": observable(
    {
      is_multipart: required("boolean"),
      date: field("timestamp"),
      content_type: field("text"),
      from_ref: reference("email-addr"),
      sender_ref: reference("email-addr"),
      to_refs: references("email-addr"),
      cc_refs: references("email-addr"),
      bcc_refs: references("email-addr"),
      message_id: field("text"),
      subject: field("text"),
      received_lines: field("string-list"),
      additional_header_fields: structured("object"),
      body: field("textarea"),
      body_multipart: structured("list"),
      raw_email_ref: reference("artifact"),
    },
    ["Use Body only when Is Multipart is false; use Body Multipart only when it is true."],
  ),
  file: observable(
    {
      hashes: structured("object"),
      size: field("integer"),
      name: field("text"),
      name_enc: field("text"),
      magic_number_hex: field("text"),
      mime_type: field("text"),
      ctime: field("timestamp"),
      mtime: field("timestamp"),
      atime: field("timestamp"),
      parent_directory_ref: reference("directory"),
      contains_refs: field("reference-list"),
      content_ref: reference("artifact"),
    },
    ["Provide at least one of Hashes or Name."],
  ),
  "ipv4-addr": observable({
    value: required("text"),
    resolves_to_refs: references("mac-addr"),
    belongs_to_refs: references("autonomous-system"),
  }),
  "ipv6-addr": observable({
    value: required("text"),
    resolves_to_refs: references("mac-addr"),
    belongs_to_refs: references("autonomous-system"),
  }),
  "mac-addr": observable({ value: required("text") }),
  mutex: observable({ name: required("text") }),
  "network-traffic": observable({
    start: field("timestamp"),
    end: field("timestamp"),
    is_active: field("boolean"),
    src_ref: field("reference"),
    dst_ref: field("reference"),
    src_port: field("integer"),
    dst_port: field("integer"),
    protocols: required("string-list"),
    src_byte_count: field("integer"),
    dst_byte_count: field("integer"),
    src_packets: field("integer"),
    dst_packets: field("integer"),
    ipfix: structured("object"),
    src_payload_ref: reference("artifact"),
    dst_payload_ref: reference("artifact"),
    encapsulates_refs: references("network-traffic"),
    encapsulated_by_ref: reference("network-traffic"),
  }),
  process: observable(
    {
      is_hidden: field("boolean"),
      pid: field("integer"),
      created_time: field("timestamp"),
      cwd: field("text"),
      command_line: field("textarea"),
      environment_variables: structured("object"),
      opened_connection_refs: references("network-traffic"),
      creator_user_ref: reference("user-account"),
      image_ref: reference("file"),
      parent_ref: reference("process"),
      child_refs: references("process"),
    },
    ["Provide at least one Process-specific property."],
  ),
  software: observable({
    name: required("text"),
    cpe: field("text"),
    swid: field("text"),
    languages: field("string-list"),
    vendor: field("text"),
    version: field("text"),
  }),
  url: observable({ value: required("text") }),
  "user-account": observable(
    {
      user_id: field("text"),
      credential: field("text"),
      account_login: field("text"),
      account_type: field("text"),
      display_name: field("text"),
      is_service_account: field("boolean"),
      is_privileged: field("boolean"),
      can_escalate_privs: field("boolean"),
      is_disabled: field("boolean"),
      account_created: field("timestamp"),
      account_expires: field("timestamp"),
      credential_last_changed: field("timestamp"),
      account_first_login: field("timestamp"),
      account_last_login: field("timestamp"),
    },
    ["Provide at least one User Account-specific property."],
  ),
  "windows-registry-key": observable(
    {
      key: field("text"),
      values: structured("list"),
      modified_time: field("timestamp"),
      creator_user_ref: reference("user-account"),
      number_of_subkeys: field("integer"),
    },
    ["Provide at least one Registry Key-specific property."],
  ),
  "x509-certificate": observable(
    {
      is_self_signed: field("boolean"),
      hashes: structured("object"),
      version: field("text"),
      serial_number: field("text"),
      signature_algorithm: field("text"),
      issuer: field("text"),
      validity_not_before: field("timestamp"),
      validity_not_after: field("timestamp"),
      subject: field("text"),
      subject_public_key_algorithm: field("text"),
      subject_public_key_modulus: field("text"),
      subject_public_key_exponent: field("integer"),
      x509_v3_extensions: structured("object"),
    },
    ["Provide at least one X.509 Certificate-specific property."],
  ),
  relationship: domain({
    relationship_type: field("text", { required: true, managed: true }),
    description: field("textarea"),
    source_ref: field("reference", { required: true, managed: true }),
    target_ref: field("reference", { required: true, managed: true }),
    start_time: field("timestamp"),
    stop_time: field("timestamp"),
  }),
  sighting: domain({
    description: field("textarea"),
    first_seen: field("timestamp"),
    last_seen: field("timestamp"),
    count: field("integer"),
    sighting_of_ref: required("reference"),
    observed_data_refs: references("observed-data"),
    where_sighted_refs: references("identity", "location"),
    summary: field("boolean"),
  }),
  "marking-definition": {
    fields: {
      created: field("timestamp", { required: true, managed: true }),
      name: field("text"),
      created_by_ref: reference("identity"),
      external_references: structured("list"),
      object_marking_refs: references("marking-definition"),
      granular_markings: structured("list"),
      extensions: structured("object"),
      definition_type: field("text"),
      definition: structured("object"),
    },
    requirements: [
      "Provide Definition Type and Definition unless an Extension defines the marking. Canonical TLP markings use the standard fixed identifiers.",
    ],
  },
  "language-content": domain({
    object_ref: required("reference"),
    object_modified: field("timestamp"),
    contents: structured("object", true),
  }),
  "extension-definition": domain({
    name: required("text"),
    description: field("textarea"),
    schema: required("text"),
    version: required("text"),
    extension_types: required("string-list"),
    extension_properties: field("string-list"),
  }),
};

const domainTypes = new Set<StixObjectType>([
  "attack-pattern",
  "campaign",
  "course-of-action",
  "grouping",
  "identity",
  "incident",
  "indicator",
  "infrastructure",
  "intrusion-set",
  "location",
  "malware",
  "malware-analysis",
  "note",
  "observed-data",
  "opinion",
  "report",
  "threat-actor",
  "tool",
  "vulnerability",
  "relationship",
  "sighting",
  "extension-definition",
  "language-content",
]);

export function initialStixFieldValues(
  objectType: StixObjectType,
  now = new Date().toISOString(),
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (domainTypes.has(objectType)) {
    values.created = now;
    values.modified = now;
  } else if (objectType === "marking-definition") {
    values.created = now;
  }
  if (objectType === "indicator") {
    values.pattern_type = "stix";
    values.valid_from = now;
  } else if (objectType === "malware") {
    values.is_family = false;
  } else if (objectType === "observed-data") {
    values.first_observed = now;
    values.last_observed = now;
    values.number_observed = 1;
  } else if (objectType === "opinion") {
    values.opinion = "neutral";
  } else if (objectType === "report") {
    values.published = now;
  } else if (objectType === "email-message") {
    values.is_multipart = false;
  }
  return values;
}

const relationshipSuggestions = new Map<string, readonly string[]>([
  ["attack-pattern:malware", ["delivers", "uses"]],
  ["attack-pattern:identity", ["targets"]],
  ["attack-pattern:location", ["targets"]],
  ["attack-pattern:vulnerability", ["targets"]],
  ["attack-pattern:tool", ["uses"]],
  ["campaign:intrusion-set", ["attributed-to"]],
  ["campaign:threat-actor", ["attributed-to"]],
  ["campaign:infrastructure", ["compromises", "uses"]],
  ["campaign:location", ["originates-from", "targets"]],
  ["campaign:identity", ["targets"]],
  ["campaign:vulnerability", ["targets"]],
  ["campaign:attack-pattern", ["uses"]],
  ["campaign:malware", ["uses"]],
  ["campaign:tool", ["uses"]],
  ["course-of-action:indicator", ["investigates", "mitigates"]],
  ["course-of-action:attack-pattern", ["mitigates"]],
  ["course-of-action:malware", ["mitigates"]],
  ["course-of-action:tool", ["mitigates"]],
  ["course-of-action:vulnerability", ["mitigates"]],
  ["domain-name:domain-name", ["resolves-to"]],
  ["domain-name:ipv4-addr", ["resolves-to"]],
  ["domain-name:ipv6-addr", ["resolves-to"]],
  ["identity:location", ["located-at"]],
  ["indicator:observed-data", ["based-on"]],
  ["indicator:attack-pattern", ["indicates"]],
  ["indicator:campaign", ["indicates"]],
  ["indicator:infrastructure", ["indicates"]],
  ["intrusion-set:threat-actor", ["attributed-to"]],
  ["indicator:intrusion-set", ["indicates"]],
  ["indicator:malware", ["indicates"]],
  ["indicator:threat-actor", ["indicates"]],
  ["indicator:tool", ["indicates"]],
  ["infrastructure:infrastructure", ["communicates-with", "consists-of", "controls", "uses"]],
  ["infrastructure:ipv4-addr", ["communicates-with", "consists-of"]],
  ["infrastructure:ipv6-addr", ["communicates-with", "consists-of"]],
  ["infrastructure:domain-name", ["communicates-with", "consists-of"]],
  ["infrastructure:url", ["communicates-with", "consists-of"]],
  ["infrastructure:observed-data", ["consists-of"]],
  ["infrastructure:malware", ["controls", "delivers", "hosts"]],
  ["infrastructure:vulnerability", ["has"]],
  ["infrastructure:tool", ["hosts"]],
  ["infrastructure:location", ["located-at"]],
  ["intrusion-set:infrastructure", ["compromises", "hosts", "owns", "uses"]],
  ["intrusion-set:location", ["originates-from", "targets"]],
  ["intrusion-set:identity", ["targets"]],
  ["intrusion-set:vulnerability", ["targets"]],
  ["intrusion-set:attack-pattern", ["uses"]],
  ["intrusion-set:malware", ["uses"]],
  ["intrusion-set:tool", ["uses"]],
  ["ipv4-addr:autonomous-system", ["belongs-to"]],
  ["ipv4-addr:mac-addr", ["resolves-to"]],
  ["ipv6-addr:autonomous-system", ["belongs-to"]],
  ["ipv6-addr:mac-addr", ["resolves-to"]],
  ["malware:threat-actor", ["authored-by"]],
  ["malware:intrusion-set", ["authored-by"]],
  ["malware:infrastructure", ["beacons-to", "exfiltrate-to", "targets", "uses"]],
  ["malware:ipv4-addr", ["communicates-with"]],
  ["malware:ipv6-addr", ["communicates-with"]],
  ["malware:domain-name", ["communicates-with"]],
  ["malware:url", ["communicates-with"]],
  ["malware:malware", ["controls", "downloads", "drops", "uses", "variant-of"]],
  ["malware:tool", ["downloads", "drops", "uses"]],
  ["malware:file", ["downloads", "drops"]],
  ["malware:vulnerability", ["exploits", "targets"]],
  ["malware:location", ["originates-from", "targets"]],
  ["malware:identity", ["targets"]],
  ["malware:attack-pattern", ["uses"]],
  [
    "malware-analysis:malware",
    ["analysis-of", "characterizes", "dynamic-analysis-of", "static-analysis-of"],
  ],
  ["threat-actor:identity", ["attributed-to", "impersonates", "targets"]],
  ["threat-actor:infrastructure", ["compromises", "hosts", "owns", "uses"]],
  ["threat-actor:location", ["located-at", "targets"]],
  ["threat-actor:vulnerability", ["targets"]],
  ["threat-actor:attack-pattern", ["uses"]],
  ["threat-actor:malware", ["uses"]],
  ["threat-actor:tool", ["uses"]],
  ["tool:malware", ["delivers", "drops"]],
  ["tool:vulnerability", ["has", "targets"]],
  ["tool:identity", ["targets"]],
  ["tool:infrastructure", ["targets"]],
  ["tool:location", ["targets"]],
]);

const relationshipObservableTypes = new Set<string>([
  "artifact",
  "autonomous-system",
  "directory",
  "domain-name",
  "email-addr",
  "email-message",
  "file",
  "ipv4-addr",
  "ipv6-addr",
  "mac-addr",
  "mutex",
  "network-traffic",
  "process",
  "software",
  "url",
  "user-account",
  "windows-registry-key",
  "x509-certificate",
]);

export function relationshipTypeSuggestions(sourceType: string, targetType: string): string[] {
  const specific = relationshipSuggestions.get(`${sourceType}:${targetType}`) ?? [];
  const consistsOfObservable =
    sourceType === "infrastructure" && relationshipObservableTypes.has(targetType)
      ? ["consists-of"]
      : [];
  const sameTypeRelationships =
    sourceType !== "" && sourceType === targetType ? ["derived-from", "duplicate-of"] : [];
  return [
    ...new Set([...specific, ...consistsOfObservable, "related-to", ...sameTypeRelationships]),
  ];
}

const relationshipEndpointTypes = new Set<StixObjectType>([
  "attack-pattern",
  "campaign",
  "course-of-action",
  "grouping",
  "identity",
  "incident",
  "indicator",
  "infrastructure",
  "intrusion-set",
  "location",
  "malware",
  "malware-analysis",
  "note",
  "observed-data",
  "opinion",
  "report",
  "threat-actor",
  "tool",
  "vulnerability",
  "artifact",
  "autonomous-system",
  "directory",
  "domain-name",
  "email-addr",
  "email-message",
  "file",
  "ipv4-addr",
  "ipv6-addr",
  "mac-addr",
  "mutex",
  "network-traffic",
  "process",
  "software",
  "url",
  "user-account",
  "windows-registry-key",
  "x509-certificate",
]);

export function isRelationshipEndpointType(objectType: string): boolean {
  return relationshipEndpointTypes.has(objectType as StixObjectType) || objectType.startsWith("x-");
}

export function readableStixName(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

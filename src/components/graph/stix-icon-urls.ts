export function iconUrlFor(objectType: string): string {
  return iconUrls[objectType] ?? fallbackIconUrl;
}

export function readableType(objectType: string) {
  return objectType.replaceAll("-", " ");
}

const fallbackIconUrl = new URL(
  "../../assets/stix-icons/stix2_custom_object_icon_tiny_round_v1.svg",
  import.meta.url,
).href;

const iconUrls: Record<string, string> = {
  "attack-pattern": new URL(
    "../../assets/stix-icons/stix2_attack_pattern_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  campaign: new URL(
    "../../assets/stix-icons/stix2_campaign_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "course-of-action": new URL(
    "../../assets/stix-icons/stix2_course_of_action_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  grouping: new URL(
    "../../assets/stix-icons/stix2_grouping_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  identity: new URL(
    "../../assets/stix-icons/stix2_identity_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  incident: new URL(
    "../../assets/stix-icons/stix2_incident_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  indicator: new URL(
    "../../assets/stix-icons/stix2_indicator_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  infrastructure: new URL(
    "../../assets/stix-icons/stix2_infrastructure_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "intrusion-set": new URL(
    "../../assets/stix-icons/stix2_intrusion_set_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  location: new URL(
    "../../assets/stix-icons/stix2_location_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  malware: new URL("../../assets/stix-icons/stix2_malware_icon_tiny_round_v1.png", import.meta.url)
    .href,
  "malware-analysis": new URL(
    "../../assets/stix-icons/stix2_malware_analysis_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  note: new URL("../../assets/stix-icons/stix2_note_icon_tiny_round_v1.png", import.meta.url).href,
  "observed-data": new URL(
    "../../assets/stix-icons/stix2_observed_data_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  opinion: new URL("../../assets/stix-icons/stix2_opinion_icon_tiny_round_v1.png", import.meta.url)
    .href,
  relationship: new URL(
    "../../assets/stix-icons/stix2_relationship_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  report: new URL("../../assets/stix-icons/stix2_report_icon_tiny_round_v1.png", import.meta.url)
    .href,
  sighting: new URL(
    "../../assets/stix-icons/stix2_sighting_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "threat-actor": new URL(
    "../../assets/stix-icons/stix2_threat_actor_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  tool: new URL("../../assets/stix-icons/stix2_tool_icon_tiny_round_v1.png", import.meta.url).href,
  vulnerability: new URL(
    "../../assets/stix-icons/stix2_vulnerability_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  artifact: new URL(
    "../../assets/stix-icons/stix2_artifact_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "autonomous-system": new URL(
    "../../assets/stix-icons/stix2_autonomous_system_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  directory: new URL(
    "../../assets/stix-icons/stix2_directory_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "domain-name": new URL(
    "../../assets/stix-icons/stix2_domain_name_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "email-addr": new URL(
    "../../assets/stix-icons/stix2_email_addr_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "email-message": new URL(
    "../../assets/stix-icons/stix2_email_message_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  file: new URL("../../assets/stix-icons/stix2_file_icon_tiny_round_v1.png", import.meta.url).href,
  "ipv4-addr": new URL(
    "../../assets/stix-icons/stix2_ipv4_addr_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "ipv6-addr": new URL(
    "../../assets/stix-icons/stix2_ipv6_addr_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "mac-addr": new URL(
    "../../assets/stix-icons/stix2_mac_addr_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  mutex: new URL("../../assets/stix-icons/stix2_mutex_icon_tiny_round_v1.png", import.meta.url)
    .href,
  "network-traffic": new URL(
    "../../assets/stix-icons/stix2_network_traffic_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  process: new URL("../../assets/stix-icons/stix2_process_icon_tiny_round_v1.png", import.meta.url)
    .href,
  software: new URL(
    "../../assets/stix-icons/stix2_software_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  url: new URL("../../assets/stix-icons/stix2_url_icon_tiny_round_v1.png", import.meta.url).href,
  "user-account": new URL(
    "../../assets/stix-icons/stix2_user_account_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "windows-registry-key": new URL(
    "../../assets/stix-icons/stix2_windows_registry_key_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "x509-certificate": new URL(
    "../../assets/stix-icons/stix2_x509_certificate_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "marking-definition": new URL(
    "../../assets/stix-icons/stix2_marking_definition_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
  "language-content": new URL(
    "../../assets/stix-icons/stix2_language_icon_tiny_round_v1.png",
    import.meta.url,
  ).href,
};

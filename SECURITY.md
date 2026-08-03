# Security policy

## Supported versions

Sheut is pre-release software. Security fixes are applied to the current
`main` branch until the first supported release line is declared here.

## Report a vulnerability

Use GitHub's [private vulnerability reporting
form](https://github.com/PerceptraHQ/sheut-community/security/advisories/new) to
open a private security advisory. Do not report suspected vulnerabilities in
public issues, discussions, pull requests, or social media.

Include only the minimum information needed to reproduce the issue:

- affected commit or version;
- operating system;
- impact and attack prerequisites;
- reproducible steps or a minimal proof of concept; and
- a suggested mitigation, if known.

Do not submit real threat intelligence, credentials, personal data, customer
data, encryption keys, or live malware. Use synthetic fixtures and redact
paths, database content, and identifiers.

PerceptraHQ aims to acknowledge reports within three business days and provide
an initial assessment within seven calendar days. We will coordinate
remediation and disclosure in the private advisory, and credit reporters who
want attribution. Security fixes, local encryption, recovery, and data
portability are never restricted to a paid edition.

## Scope priorities

High-priority areas include:

- local project encryption, key handling, and recovery;
- Tauri command and capability boundaries;
- imported STIX, JSON, documents, archives, and attachments;
- path traversal, unsafe file handling, and command execution;
- rich-text sanitization and script injection;
- secret, project-content, or intelligence leakage; and
- release artifact integrity and dependency compromise.

Detailed internal security design material is not part of the public Community
repository. This policy is the authoritative public reporting boundary.

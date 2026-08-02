# Contributing to Sheut

Thank you for helping build Sheut Community. This repository is the public,
offline-first product; proprietary Enterprise work belongs in the private
Enterprise repository.

## Before you start

- Read the [product specification](docs/product-spec.md),
  [architecture](docs/architecture.md), and
  [security model](docs/security.md).
- Search existing issues before opening a new one.
- Discuss large behavior, storage, schema, licensing, or security changes in an
  issue before implementation.
- Never include real intelligence, credentials, malware, personal data, or
  customer material in issues, tests, screenshots, or commits.

## Development setup

Install the Rust and Node versions declared by `rust-toolchain.toml` and
`.node-version`. Use the package manager pinned in `package.json`:

```sh
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

Dependency lifecycle scripts are denied unless explicitly recorded in
`pnpm-workspace.yaml`. Do not broaden that policy to make an install pass.

Rust changes follow the official [Rust Style Guide](https://doc.rust-lang.org/style-guide/).
The repository's pinned `rustfmt` and Clippy checks are the enforceable source
of truth for formatting and lint conformance during hardening and release work.

## Workflow

1. Branch from `main` using `feat/`, `fix/`, `docs/`, `refactor/`, or `chore/`.
2. Keep each change focused and include tests for behavior.
3. Use [Conventional Commits](https://www.conventionalcommits.org/):
   `type(scope): summary`. Every commit must include a blank line followed by
   a body of at least 40 characters explaining why the change is needed and
   what it does. Keep body lines at or below 100 characters and record
   verification or compatibility decisions when they matter.
4. Run `corepack pnpm check:push` before pushing.
5. Open a pull request and complete its security and verification sections.
6. Resolve every required review and required check before merge.

Direct pushes, force pushes, and branch deletion are blocked on `main`.

## Pull request expectations

- Explain why the change is needed and what is intentionally out of scope.
- Include runtime evidence for user-visible behavior.
- Record durable architectural rationale in the product, architecture, or
  security documentation when a decision would be expensive to reverse.
- Update timeless documentation in the same pull request.
- Preserve unknown STIX properties and data portability.
- Provide rollback or recovery for changes that can mutate user data.

By contributing, you agree that your contribution is licensed under the
Mozilla Public License 2.0.

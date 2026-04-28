# Security Policy

## Reporting a Vulnerability

If you discover a security issue in SAIO, please report it **privately** instead of opening a public issue.

**How to report**:

- Email: [lorenzo@revolutionmarketing.us](mailto:lorenzo@revolutionmarketing.us)
- Subject line: `[SECURITY] <short description>`
- Include:
  - Affected version (release tag or commit SHA)
  - OS and environment
  - Reproduction steps or PoC
  - Impact assessment (what an attacker could do)
  - Suggested fix if you have one

## Response timeline

- **Initial response**: within 72 hours
- **Triage and confirmation**: within 7 days
- **Fix and coordinated disclosure**: typically within 30-90 days depending on severity

We follow a coordinated disclosure model: once a fix is available, we publish it together with credit to the reporter (if desired).

## Supported versions

Only the latest tagged release on `main` receives security fixes. Older versions are unsupported — please upgrade to receive patches.

## Hall of Fame

Security researchers who responsibly disclose valid issues will be acknowledged here (with permission).

_(empty for now — be the first!)_

## Out of scope

- Issues already publicly disclosed elsewhere
- Vulnerabilities requiring physical access to the user's machine
- Self-XSS that requires the user to paste arbitrary code
- Issues in third-party dependencies (please report upstream first)

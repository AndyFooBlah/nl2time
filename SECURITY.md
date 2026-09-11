# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in nl2time, please report it responsibly.

**Please do not open a public GitHub issue for security vulnerabilities.**

Preferred: use GitHub's private vulnerability reporting — the **"Report a vulnerability"** button under this repository's **Security** tab. It opens a private channel visible only to the maintainer.

Alternatively, email **andrew.brook@fooblah.org**.

Include as much detail as you can:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

We will acknowledge your report within 48 hours and aim to release a fix within 14 days for critical issues.

## Scope

This policy covers:

- The `nl2time` npm package (the TypeScript library published from `src/`, including the `nl2time/llm` and `nl2time/corpus` subpaths)
- The `nl2time` PyPI package (the Python engine published from `python/`)

The corpus data, scripts, and examples in this repository are development tooling and are not published to either registry.

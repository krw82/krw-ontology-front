# Desktop API Contracts v1

These schemas are the canonical product boundary for `krw-local-worker`.

- Server routes emit versioned, sanitized DTOs.
- Web session IDs, `user_id`, auth tokens, and Web action URLs are not part of
  the Desktop resource contracts.
- `krw-local-worker` vendors these files with SHA-256 checksums.
- Breaking changes require a new contract version.

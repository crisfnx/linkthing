# Fixtures

Inputs for the golden tests (PRD §8.5): one file per adapter and locale, plus
`urls-edge-cases.txt` for the URL rules. Each fixture has an expected output
next to it in the test that uses it.

## Before committing a fixture

Fixtures come from real exports, so anonymize them first:

- Replace every name with a placeholder (`Cris`, `Alex`, `Sam`), consistently
  within a file, so sender-set and nearby-message logic still see the same
  people.
- Remove phone numbers, email addresses and anything that identifies a person
  or a private group.
- Replace private URLs (shared docs, invite links, anything with a token) with
  public ones of the same shape.
- Keep everything that makes the format what it is: timestamps, `U+200E` and
  `U+202F` characters, line endings, system messages, attachment placeholders.
  Prettier skips this folder for that reason.

## Raw exports

Put unedited exports in `tests/fixtures/raw/`. That folder is git-ignored, so
they never reach the repository.

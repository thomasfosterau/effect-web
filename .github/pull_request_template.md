## Summary

Describe what changed and why. If this closes an issue, add `Closes #N` so it auto-closes on merge to `main`. For an extraction PR, list which SOURCE APP files (website / gardeneria / preferenceflow) the package supersedes — the apps' adoption issues delete them.

## Verification

Run the gates in [AGENTS.md](../blob/main/AGENTS.md#verification) and list each command with its final pass/fail. If a gate could not run, say which and why.

## Changeset

Name the changeset(s) under `.changeset/`, or say why none is needed (see [AGENTS.md](../blob/main/AGENTS.md#branches-and-pull-requests)).

## Notes

Anything reviewers should pay special attention to: exported signatures, peer ranges, `sideEffects: false` (no top-level statements in `dist/`), behaviour ported from an application that must stay compatible with what it serves today.

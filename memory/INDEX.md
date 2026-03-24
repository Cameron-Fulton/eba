# Memory Packet Index

| ID     | Date       | Slug                        | Summary (one line)                                              | Parent |
|--------|------------|-----------------------------|-----------------------------------------------------------------|--------|
| mp-001 | 2026-03-21 | eba-test-run-architecture-gaps | First live EBA test: identified SOP rigidity, permission sandbox blocking, single-tenant concurrency gap, and designed multi-agent upgrade path | — |
| mp-002 | 2026-03-21 | multi-agent-architecture-built | Full implementation: SQLite task queue (WAL, atomic claim, depends_on), merge agent (10 rules, 3 never-drop fields), per-agent isolation, multi-agent run.ts loop. 283 tests, PR #1. | mp-001 |
| mp-003 | 2026-03-22 | provider-hardening-merge-to-main | GeminiProvider callWithTools (4/4 providers complete), /audit + /harden, feature branch merged to main. 288 tests, 31 suites, all green. Project feature-complete. | mp-002 |
| mp-004 | 2026-03-23 | task-intake-and-target-aware-design | Built task intake system (CLI arg + drop zone + context discovery), merged to main. Designed target-aware tool-shed spec. 315 tests, 35 suites. Next: implement tool-shed targeting. | mp-003 |
| mp-005 | 2026-03-23 | target-aware-toolshed-and-nk-promotion | Implemented target-aware tool-shed (ToolShedConfig, blocklist, dual NK, .eba/ artifacts) + NK promotion (score/generalize/promote with cold start safeguard). /harden passed. 366 tests, 37 suites. | mp-004 |

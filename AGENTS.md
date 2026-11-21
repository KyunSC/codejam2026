# codejam2026

CodeJam 16 (McGill) hackathon repo. The app is `Brim/`: accounts payable automation for a fictional company, Harborline Logistics, from inbox to simulated payment.

## Layout

| Path | What |
| -- | -- |
| `Brim/` | The Next.js app. Read `Brim/AGENTS.md` and `Brim/README.md` before working in it |
| `Brim/PLAN.md` | What to build and why |
| `Brim/BUILD_PLAN.md` | Exact rules, contracts and build order |
| `Brim/loops/` | Overnight agent loop prompts |
| `Brim/brim_ap_dataset/` | The Harborline dataset (CSVs, inbox emails, incoming invoice PDFs/scans) |
| `*.pdf` (root) | Hackathon brief and opening ceremony slides |

**Never open the files listed in `Brim/brim_ap_dataset/sealed_invoices.txt`, or the emails that carry them.** They stand in for the judges' hidden batch. See `Brim/AGENTS.md`.

## Git

- **Never push without asking first.** Make the changes, show what changed, and wait for an explicit go-ahead. Approval for push does not carry over to the next.
- Never force-push, rewrite history, or delete branches without asking.
- Never commit `.env` or other secrets. `Brim/.env.example` is the template.
- If on `main`, create a branch before committing.

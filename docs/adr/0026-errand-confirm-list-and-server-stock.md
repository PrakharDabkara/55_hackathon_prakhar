# 0026. Errand: confirm a goal's items in one multi-select; the server loads stock for every resolved item

Status: Accepted · 2026-10-17 (Day 14b live findings)

## Context

A live test of "chai banane ka saaman" gave "Samjha: 2 cheezein", the either/or question "chai patti ya chai masala?" and a plan with only chai patti: chini and doodh were never planned. The model dropped items, and `submit_plan` decided what was looked up.

## Decision

1. **A goal is confirmed once, as a list.** When the task names a goal rather than items, the prompt tells the model to propose the usual items and ask one `ask_user` with `multiSelect` and the defaults in `preselected`. It never asks either/or between a common default and a rarer variant.
2. **`ask_user` and the answer.** `ask_user` takes optional `multiSelect` and `preselected` (up to 8 options with `multiSelect`, 4 without). `POST /errands/:id/answer` takes `selected` (indexes of ticked options) with optional `text` ("Kuch aur?"); the server turns it into one sanitised answer line for the model. Typed text is checked like any answer.
3. **The server decides what is planned.** Every item `resolve_item` placed in the errand is in the plan, whatever `submit_plan` claimed or left out. The server loads the stock on record for each (plus the errand's own confirmed answers); the model's `not_found` is overruled for these items. Items that did not resolve stay out.
4. **A remembered answer is not a confirmation.** A `likely` item reads "Pichhla jawab: aaj / kal / N din pehle", never "Confirmed".
5. **The screen** shows identical plans once (no tabs, no badge), a "Nahi mila" group after the found items, and, when nothing was found, "Abhi kisi dukaan ne jawab nahi diya" with a button that starts the same errand again. The errand id is in the address (`/app/errand/<id>`) and `ErrandView` carries `lat` and `lng`, so a reload shows the same errand.

## Alternatives rejected

- **Ask the model to be more careful.** It is what failed; the server already holds the facts to check it.
- **A separate "confirm" tool.** `ask_user` already pauses and resumes the errand; one more field is smaller than a second pause path.

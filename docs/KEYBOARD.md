# Keyboard capture in browsers

All bindings live in `packages/data/json/keymap.json`. Function keys are not used (owner decision, 2026-10-11).

## What is verified automatically

`e2e/keymap.spec.ts` presses every chord in `keymap.json` and asserts the effect (camera moved, mode set, command sent, selection changed). It runs in Chromium and WebKit locally, and in Chromium, Firefox and WebKit in CI. A new keymap entry without an expectation fails the test.

Playwright delivers synthetic key events to the page. That proves the game handles each chord and calls `preventDefault()`. It **cannot** prove that the browser itself doesn't grab a shortcut first, because browser-level accelerators are never triggered by synthetic events. The table below covers that gap from documented browser behavior.

## Browser-reserved shortcuts that affect our bindings

| Chord | Ours | Chrome / Edge | Firefox | Safari | Notes |
|---|---|---|---|---|---|
| Ctrl+1–9 | Assign control group | Windows/Linux: switches tabs, page never sees it | Windows/Linux: switches tabs | Not reserved (tabs are Cmd+1–9) | Works on macOS in every browser. Elsewhere, use **Alt+1–9** (shipped fallback) or fullscreen + Keyboard Lock |
| Alt+1–9 | Assign control group (fallback) | Free | Linux: switches tabs | Free | macOS types special characters, but we bind `event.code`, so it still works |
| Shift+1–9 | Add to group | Free | Free | Free | |
| 1–9 | Select group | Free | Free | Free | |
| Ctrl+A | Select army | Select-all is prevented | Prevented | Prevented | On macOS, Cmd+A also triggers it (Cmd is treated as Ctrl) |
| Tab | Cycle subgroups | Focus move prevented | Prevented | Prevented | |
| Space | Jump to alert | Page scroll prevented | Prevented | Prevented | |
| Backspace | Jump to base | No default action | No default action | No default action | |
| Esc | Cancel / menu | Also exits fullscreen; can't be prevented without Keyboard Lock | Same | Same | With Keyboard Lock (Chromium) the browser requires a long press to exit |
| Alt+R, Alt+S | Repair / sell | Free | Windows: Alt+S would open the History menu; prevented by our `preventDefault()` | Free | Re-check on Windows Firefox when convenient |
| Ctrl+W/T/N | not bound | Always reserved | Always reserved | Always reserved | Only capturable with Keyboard Lock in fullscreen |

## Fullscreen and Keyboard Lock

The pause menu (Esc) has a **Fullscreen** button. It requests fullscreen, then calls `navigator.keyboard.lock()` where available (Chromium only). In that state the page receives reserved chords such as Ctrl+1–9 and Ctrl+W on every OS. Firefox and Safari don't implement Keyboard Lock, so players there should use Alt+digit for control groups on Windows/Linux.

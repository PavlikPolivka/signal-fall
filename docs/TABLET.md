# Tablet pass (iPad)

Playing on an iPad (2026-10-25) turned up a set of problems, and a review in the iPad emulator (WebKit, touch,
1194×834) found more. Prioritised; status kept up to date here.

| # | Problem | Fix | Status |
|---|---|---|---|
| T1 | Fullscreen button fullscreens the menu's background video, not the game | Use Safari's prefixed fullscreen call on the page; hide the button where the browser can't fullscreen a page (iPhone); point to *Add to Home Screen*, which runs the game without browser bars | done: on iPad and iPhone the button explains Add to Home Screen (a manifest makes that a fullscreen app); elsewhere the browser fullscreen, prefixed where needed |
| T2 | Tapping build buttons quickly zooms the page | No double-tap or pinch zoom of the page anywhere (the map keeps its own pinch zoom) | done |
| T3 | Tapping a build button opens its info card, which then stays | Cards open on mouse hover only; on touch a long press opens the card, and any tap closes it | done |
| T4 | The placement grid follows the bumps of the hills, hard to read | A flat grid at the height the building will stand at | done |
| T5 | Mouse and keyboard wording on a tablet ("Press B, then a letter", "Right-click: cancel", key letters on every button) | On touch, the key letters are hidden and the hints talk about taps | done: hints, card footers and the tutorial tips speak in taps |
| T6 | No way to cancel a queued unit or building, or to repeat one, without a right-click or Ctrl | The long-press card has Cancel one, Cancel all and Repeat buttons | done |
| T7 | Placing a building has no preview: the first tap on the map places it | On touch, the first tap shows the building there (drag to move it), a second tap on it or ✓ builds, ✕ cancels | done: first tap shows the building, a tap on the same spot or ✓ Place in the touch bar builds it, a tap elsewhere moves it |
| T8 | A tap near the screen edge can start edge-scrolling | Edge scrolling only for a mouse | done |
| T9 | Long press selects text or opens Safari's callout; the page rubber-bands when dragged | No text selection, callouts or overscroll in the game | done |
| T10 | Controls under the iPad's home bar and rounded corners | Keep clear of the safe areas | done: the page stays inside the safe area (no viewport-fit=cover; the home-screen app keeps a black status bar) |
| T11 | Small touch targets (sidebar tabs, control-group buttons, menu buttons) | Bigger targets on touch screens | partly: sidebar tabs and control groups |
| T12 | Portrait iPad: the sidebar and command bar crowd the map | Check the layout in portrait and fix what crowds | done: in portrait the command panel moves under the build list and the map runs the full height |
| T13 | Minimap: dragging on it should pan the view | Drag on the minimap pans | done: drag pans (Safari no longer takes the drag); holding still orders the selection there |
| T14 | Double-tap a unit to select every one of its kind on screen (the double-click of a mouse) | Double-tap selects the type | done (taps already went through the double-click logic) |
| T15 | Two-finger tap as a quick "cancel / deselect" | Two-finger tap = Esc | done |

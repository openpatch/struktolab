---
"struktolab": minor
---

The editor can go back to the structogram it started with. `reset()` restores it — the inline code, pseudocode or JSON, else `src`, else an empty one — together with its code, clears the undo history and fires `reset` (and `change`). With the new `resettable` attribute a **Reset** button beside Undo/Redo does that after asking, so a host that saves a student's work (an LMS, a hyperbook) can offer a way back to the task and drop its saved copy on `reset`.

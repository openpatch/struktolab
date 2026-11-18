---
"struktolab": patch
---

The editor and the renderer draw the structogram again when they get wider or narrower, so the text keeps its `font-size`. Before, the diagram was drawn once for the starting width and then stretched, so dragging a side panel smaller shrank the text with it.

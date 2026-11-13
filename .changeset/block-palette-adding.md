---
"struktolab": minor
---

Rework adding nodes in the editor.

- A block palette under the toolbar: drag a block into the diagram, or pick it and then pick the place. Works the same with mouse, pen, finger and keyboard.
- While placing or moving, the diagram opens a gap with a "+" block at every place the block can go, so targets are big, never overlap, and sit exactly where the node will land. This also fixes nodes that could not be added at the end of an if/else branch.
- Empty branches, cases, loop bodies and the end of the diagram show a "+" block at all times; an if/else with two empty branches gets a body to click into.
- A new node opens its text editor right away; on touch, tapping a selected node again edits it.
- Every node gets a "+" button to insert after it; a do-while's buttons sit in its footer so they are reachable, and a switch's "+ Case" button no longer overlaps them.
- Moving a node out of a body no longer leaves a duplicate slot behind.

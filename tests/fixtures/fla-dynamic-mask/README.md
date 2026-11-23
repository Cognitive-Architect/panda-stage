# Dynamic mask fixtures

Animate 2023 saved these synthetic 30 fps documents and rendered the reference
images. The fixture ZIPs were repacked without the directory records to make the
local and central directory headers consistent. File payloads were preserved.

| Fixture | Reference frames | What to compare |
| --- | --- | --- |
| `MASK.fla` | 1, 4, 8 | The shape tween changes the left window. Red stays in front of blue. Object Motion moves both orange openings together and leaves the gap transparent. |
| `MASK-NESTED.fla` | 1, 4, 8 | The mirrored Graphic window keeps its hole and intersects the content symbol's inner window. The MovieClip window changes position at frames 4 and 7. These PNGs are extracted from Animate's continuous eight-frame transparent video. |
| `MASK-EDGE.fla` | 1, 4, 6 | The left mask has a blank key at frame 4. The middle mask is hidden in authoring but continues clipping in the export. The right mask ends after frame 3. The left and right content become fully visible from frame 4. |

In Panda Stage's FLA workbench, select the main-scene frame sequence. Render
frames 1–8 for the two moving samples, or frames 1–6 for the boundary sample.
Compare the resulting transparent frames to the corresponding PNGs.

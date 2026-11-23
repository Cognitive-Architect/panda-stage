# OM-2D Animate fixture

`OM-2D.fla` was created in Adobe Animate 2023 for issue #1224. The 480 × 320,
30 fps scene starts with four blank frames. Its single motion span covers
frames 5–16. The rectangle has separate X/Y curves, an off-centre pivot
(11.2, 27), rotation, unequal X/Y scaling, X skew, and alpha from 100% to 50%.
Animate exported the three reference PNGs. The blue fill's interior alpha at
frames 5, 10 and 16 is 255, 196 and 127 respectively.

The saved archive reported a central-directory size 54 bytes larger than
its actual directory. The checked-in copy corrects that size field and keeps
the Animate-authored entries byte-for-byte.

In Panda Stage's FLA workbench, select the main scene and render frames 5–16
before importing as an animation. The fixtures contain no private artwork.

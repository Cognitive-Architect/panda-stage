# Demo project assets

These files back every asset record in `../project-v1.example.json` so the
human-readable example is also a filesystem-consistent project fixture.

- `bamboo-background.png` is generated procedurally by this repository.
- The neutral and happy placeholders are copied from the repository-owned
  `public/probe/panda-character.png` fixture.
- `opening-dialogue.wav` is copied from the repository-generated
  `public/probe/preview-tone.wav` fixture.

Regenerate all four files with:

```bash
pnpm assets:generate-demo-project-fixtures
```

The two expression files intentionally share one placeholder image. Their
separate paths preserve the example project's expression/reference contract;
final demo artwork belongs to the later demo-content milestone.

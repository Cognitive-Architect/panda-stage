export function LegacyWorkspace(): React.JSX.Element {
  return (
    <div
      aria-label="Legacy editor workspace"
      className="legacy-workspace"
      data-testid="legacy-workspace-scroll"
      id="legacy-workspace"
    >
      <p
        className="legacy-workspace-empty"
        data-testid="legacy-workspace-empty"
      >
        动作预设已迁入右侧检查器。兼容工作区不再挂载重复动作面板。
      </p>
    </div>
  );
}

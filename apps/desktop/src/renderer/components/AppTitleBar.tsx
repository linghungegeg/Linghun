import { useEffect, useState } from "react";
import type { Platform } from "../../bridge/events";
import type { ThemeMode } from "../hooks/useTheme";

const THEME_LABEL: Record<ThemeMode, string> = {
  light: "☀",
  dark: "☾",
  system: "◐",
};

type Props = {
  themeMode: ThemeMode;
  onCycleTheme: () => void;
};

// frameless 自绘标题栏：拖拽区 + 主题切换 + Win 风格右侧控制按钮。
// 控制按钮区标 no-drag，避免落入 -webkit-app-region: drag。
export function AppTitleBar({ themeMode, onCycleTheme }: Props) {
  const [maximized, setMaximized] = useState(false);
  const [platform, setPlatform] = useState<Platform>("win32");

  useEffect(() => {
    void window.linghunBridge.queryWindowState().then((s) => {
      setMaximized(s.maximized);
      setPlatform(s.platform);
    });
    return window.linghunBridge.onWindowState((s) => setMaximized(s.maximized));
  }, []);

  const controls = (
    <div className="titlebar-controls">
      <button
        type="button"
        className="win-ctl"
        title="最小化"
        onClick={() => window.linghunBridge.windowControl("minimize")}
      >
        ─
      </button>
      <button
        type="button"
        className="win-ctl"
        title={maximized ? "还原" : "最大化"}
        onClick={() => window.linghunBridge.windowControl("toggle_maximize")}
      >
        {maximized ? "❐" : "▢"}
      </button>
      <button
        type="button"
        className="win-ctl win-ctl-close"
        title="关闭"
        onClick={() => window.linghunBridge.windowControl("close")}
      >
        ✕
      </button>
    </div>
  );

  // mac 控制按钮在左，win/linux 在右
  const macControls = platform === "darwin";

  return (
    <div className="titlebar">
      {macControls && controls}
      <span className="titlebar-title">Linghun</span>
      <div className="titlebar-spacer" />
      <button
        type="button"
        className="titlebar-action"
        title={`主题：${themeMode}`}
        onClick={onCycleTheme}
      >
        {THEME_LABEL[themeMode]}
      </button>
      {!macControls && controls}
    </div>
  );
}

export interface ProjectOpenCandidateValidation {
  valid: boolean;
  message: string;
}

const WINDOWS_DRIVE_ROOT = /^[a-z]:[\\/]/iu;
const WINDOWS_UNC_ROOT = /^\\\\[^\\/]+[\\/][^\\/]+/u;
const WINDOWS_INVALID_PATH_CHARACTER = /[<>"|?*]/u;

export function validateProjectOpenCandidate(
  rawCandidate: string,
  activeProjectRoot?: string | null,
): ProjectOpenCandidateValidation {
  const candidate = rawCandidate.trim();
  if (!candidate) {
    return {
      valid: false,
      message: '请输入 .pandastage 项目文件夹路径。',
    };
  }
  const pathWithoutDrive = WINDOWS_DRIVE_ROOT.test(candidate)
    ? candidate.slice(2)
    : candidate;
  if (WINDOWS_INVALID_PATH_CHARACTER.test(pathWithoutDrive)) {
    return {
      valid: false,
      message: '项目文件夹路径包含 Windows 不允许的字符。',
    };
  }
  if (
    !WINDOWS_DRIVE_ROOT.test(candidate) &&
    !WINDOWS_UNC_ROOT.test(candidate)
  ) {
    return {
      valid: false,
      message: '请输入完整的 Windows 项目文件夹路径。',
    };
  }
  if (!candidate.replace(/[\\/]+$/u, '').toLowerCase().endsWith('.pandastage')) {
    return {
      valid: false,
      message: '请选择以 .pandastage 结尾的项目文件夹。',
    };
  }
  if (
    activeProjectRoot &&
    sameProjectRoot(candidate, activeProjectRoot)
  ) {
    return {
      valid: false,
      message: '该项目当前已经打开。',
    };
  }
  return {
    valid: true,
    message: '将检查项目文件夹中的 project.json。',
  };
}

const PROJECT_OPEN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  CURRENT_PROJECT_DIRTY: '当前项目有未保存的更改，无法重复打开。',
  SWITCH_CANCELLED: '已取消项目切换，当前修改保持不变。',
  SWITCH_SAVE_FAILED: '保存当前项目失败，未切换项目。',
  SWITCH_DISCARD_FAILED: '无法安全放弃当前修改，未切换项目。',
  INVALID_PROJECT_ROOT: '请选择以 .pandastage 结尾的有效项目文件夹。',
  PROJECT_NOT_FOUND: '项目文件夹不存在，请检查路径后重试。',
  PROJECT_FILE_NOT_FOUND: '该文件夹不是有效的 Panda Stage 项目：缺少 project.json。',
  INVALID_JSON: '项目文件损坏或格式不受支持，请检查 project.json。',
  UNSUPPORTED_VERSION: '该项目版本暂不受当前 Panda Stage 支持。',
  INVALID_PROJECT: 'project.json 的项目数据不完整或格式无效。',
  PROJECT_ID_MISMATCH: '项目身份与最近项目记录不一致。',
  RECENT_PROJECT_NOT_FOUND: '最近项目路径已失效，请移除记录或重新定位。',
  RECENT_PROJECT_MISMATCH: '最近项目身份不匹配，请重新定位正确的项目文件夹。',
  RECENT_PROJECT_CONFIG_INVALID: '最近项目配置无效，请重新打开项目。',
  RECENT_PROJECT_CONFIG_FAILED: '无法读取最近项目配置。',
  RECENT_PROJECT_RELOCATE_FAILED: '无法重新定位该项目。',
  TRACK_FAILED: '项目已读取，但无法建立编辑会话。',
  DETECT_FAILED: '项目已读取，但无法检查恢复内容。',
  STOP_FAILED: '无法安全结束当前项目会话，请稍后重试。',
  ROLLBACK_FAILED: '项目切换失败，且会话回滚不完整。请关闭应用后重试。',
  OPEN_FAILED: '无法打开项目，请确认目录存在且包含有效的 project.json。',
};

function errorCode(value: unknown): string | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string'
  ) {
    return value.code;
  }
  return null;
}

export function sameProjectRoot(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .replaceAll('/', '\\')
      .replace(/\\+$/u, '')
      .toLowerCase();
  return normalize(left) === normalize(right);
}

export function projectOpenErrorMessage(error: unknown): string {
  const directCode = errorCode(error);
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error
      ? error.cause
      : null;
  const causeCode = errorCode(cause);
  const mapped =
    (causeCode ? PROJECT_OPEN_ERROR_MESSAGES[causeCode] : undefined) ??
    (directCode ? PROJECT_OPEN_ERROR_MESSAGES[directCode] : undefined);
  if (mapped) return mapped;
  return error instanceof Error
    ? `无法打开项目：${error.message}`
    : '无法打开项目，请检查项目文件夹后重试。';
}

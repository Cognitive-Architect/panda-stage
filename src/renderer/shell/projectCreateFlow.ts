import {
  PROJECT_NAME_MAX_LENGTH,
  projectNameIssue,
  type ProjectNameIssueCode,
} from '../../shared/project-api';

/**
 * Renderer-side validation for the secure project creation flow.
 *
 * This module deliberately contains no path arithmetic: the Renderer submits a
 * parent directory and a bare project name, and the Main Process performs the
 * `.pandastage` join, the duplicate check, and the disk write. Everything here
 * exists purely to give the user immediate, localized feedback.
 */

export interface ProjectCreateFieldValidation {
  valid: boolean;
  message: string;
}

export interface ProjectCreateValidation {
  valid: boolean;
  parentDirectory: ProjectCreateFieldValidation;
  projectName: ProjectCreateFieldValidation;
}

const WINDOWS_DRIVE_ROOT = /^[a-z]:[\\/]/iu;
const WINDOWS_UNC_ROOT = /^\\\\[^\\/]+[\\/][^\\/]+/u;
const WINDOWS_INVALID_PATH_CHARACTER = /[<>"|?*]/u;

const PROJECT_NAME_ISSUE_MESSAGES: Readonly<
  Record<ProjectNameIssueCode, string>
> = {
  EMPTY: '请输入项目名称。',
  TOO_LONG: `项目名称最多 ${PROJECT_NAME_MAX_LENGTH} 个字符。`,
  PATH_SEPARATOR: '项目名称不能包含斜杠或反斜杠，请只填写名称本身。',
  RELATIVE_SEGMENT: '项目名称不能是 . 或 .. 这样的相对路径片段。',
  INVALID_CHARACTER: '项目名称包含 Windows 不允许的字符（如 < > : " | ? *）。',
  RESERVED_DEVICE_NAME: '该名称是 Windows 保留的设备名，请换一个名称。',
  TRAILING_DOT_OR_SPACE: '项目名称不能以句点或空格结尾。',
  REDUNDANT_EXTENSION:
    '项目名称无需自行添加 .pandastage 后缀，系统会自动补全。',
};

/**
 * Validates the directory the user picked to hold the new project.
 *
 * @param rawParentDirectory - Untrimmed directory path from the picker/input.
 */
export function validateNewProjectParentDirectory(
  rawParentDirectory: string,
): ProjectCreateFieldValidation {
  const parentDirectory = rawParentDirectory.trim();
  if (!parentDirectory) {
    return {
      valid: false,
      message: '请先选择新项目的存放文件夹。',
    };
  }
  const pathWithoutDrive = WINDOWS_DRIVE_ROOT.test(parentDirectory)
    ? parentDirectory.slice(2)
    : parentDirectory;
  if (WINDOWS_INVALID_PATH_CHARACTER.test(pathWithoutDrive)) {
    return {
      valid: false,
      message: '存放文件夹路径包含 Windows 不允许的字符。',
    };
  }
  if (
    !WINDOWS_DRIVE_ROOT.test(parentDirectory) &&
    !WINDOWS_UNC_ROOT.test(parentDirectory)
  ) {
    return {
      valid: false,
      message: '请输入完整的 Windows 文件夹路径。',
    };
  }
  return {
    valid: true,
    message: '新项目文件夹将创建在该目录中。',
  };
}

/**
 * Validates the bare project name against the shared Windows naming contract.
 *
 * @param rawProjectName - Untrimmed project name exactly as the user typed it.
 */
export function validateNewProjectName(
  rawProjectName: string,
): ProjectCreateFieldValidation {
  const issue = projectNameIssue(rawProjectName);
  if (issue) {
    return { valid: false, message: PROJECT_NAME_ISSUE_MESSAGES[issue] };
  }
  return {
    valid: true,
    message: '将在所选文件夹中创建同名项目文件夹。',
  };
}

/**
 * Validates both fields of the new-project form.
 *
 * @param rawParentDirectory - Untrimmed parent directory path.
 * @param rawProjectName - Untrimmed bare project name.
 */
export function validateNewProjectInput(
  rawParentDirectory: string,
  rawProjectName: string,
): ProjectCreateValidation {
  const parentDirectory = validateNewProjectParentDirectory(
    rawParentDirectory,
  );
  const projectName = validateNewProjectName(rawProjectName);
  return {
    valid: parentDirectory.valid && projectName.valid,
    parentDirectory,
    projectName,
  };
}

const PROJECT_CREATE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  PROJECT_ALREADY_EXISTS: '该文件夹中已存在同名项目，请换一个项目名称。',
  INVALID_PROJECT_ROOT: '项目名称或存放文件夹无效，请修改后重试。',
  PROJECT_NOT_WRITABLE: '没有写入权限，请换一个存放文件夹后重试。',
  PROJECT_NOT_FOUND: '存放文件夹不存在，请重新选择后重试。',
  INVALID_PROJECT: '新项目数据校验失败，请稍后重试。',
  CREATE_FAILED: '创建项目失败，请检查存放文件夹后重试。',
};

/**
 * Maps a creation failure to user-facing Chinese guidance.
 *
 * @param error - Either a `ProjectOperationError`-shaped object or a thrown
 *   error from the preload bridge.
 */
export function projectCreateErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    const mapped = PROJECT_CREATE_ERROR_MESSAGES[error.code];
    if (mapped) return mapped;
  }
  return error instanceof Error
    ? `创建项目失败：${error.message}`
    : '创建项目失败，请稍后重试。';
}

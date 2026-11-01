import { useState } from 'react';
import type { FlaCharacterCreateStatusResponse } from '../../../shared/fla-character-create-api';
import type {
  FlaCharacterCreateOperationState,
} from './FlaCharacterImportFlow';
import {
  decideFlaCharacterCreateStatus,
  readPendingFlaCharacterCreateRecord,
  samePendingFlaCharacterCreateCredential,
  type PendingFlaCharacterCreateCredential,
} from './fla-character-create-recovery';
import './fla-character-create-recovery.css';

export interface FlaCharacterCreateRecoveryPanelProps {
  credential: PendingFlaCharacterCreateCredential;
  onQuery(
    credential: PendingFlaCharacterCreateCredential,
  ): Promise<FlaCharacterCreateStatusResponse>;
  onResolved(
    credential: PendingFlaCharacterCreateCredential,
    result: 'committed' | 'not-committed',
  ): boolean | Promise<boolean>;
  onOperationStateChange(state: FlaCharacterCreateOperationState): void;
  onSafeExit(operationId: string): void;
}

function messageForStatus(
  status: FlaCharacterCreateStatusResponse,
): string {
  if (status.ok) {
    switch (status.status) {
      case 'IN_PROGRESS':
        return '保存仍在进行。继续查询结果；当前不能安全关闭。';
      case 'RECOVERY_REQUIRED':
        return 'Main 要求恢复保存，但当前状态没有提供可验证的恢复路径。请保留窗口和核对信息，继续查询；不要重新创建或关闭。';
      case 'FAILED':
        return '本次没有保存成功，可以重新准备角色。';
      case 'NOT_FOUND':
        return '没有找到本次保存记录。确认角色列表后，可以重新准备。';
      case 'COMMITTED':
        return '角色已保存。';
    }
  }
  if (status.error.code === 'OPERATION_ID_CONFLICT') {
    return '保存编号与记录不一致。不要重新创建；保持窗口打开并复制核对信息。';
  }
  if (status.error.code === 'OPERATION_IN_PROGRESS') {
    return '保存仍在进行。继续查询结果；当前不能安全关闭。';
  }
  if (status.error.code === 'RECOVERY_REQUIRED') {
    return 'Main 暂时无法核对这条保存记录。保留当前窗口和核对信息，联系维护者处理；不要重新创建。';
  }
  return '保存结果暂时无法确认。不要重新创建；保持窗口打开并保留核对信息。';
}

export function FlaCharacterCreateRecoveryPanel({
  credential,
  onQuery,
  onResolved,
  onOperationStateChange,
  onSafeExit,
}: FlaCharacterCreateRecoveryPanelProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    '有一项角色保存结果待核对。请使用同一编号查询，不要重新创建。',
  );
  const [safeExitAvailable, setSafeExitAvailable] = useState(false);
  const [copied, setCopied] = useState(false);

  const query = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setSafeExitAvailable(false);
    onOperationStateChange('in-progress');
    try {
      const status = await onQuery(credential);
      setMessage(messageForStatus(status));
      const persistedRecord = readPendingFlaCharacterCreateRecord();
      const hasVerifiedReentryCredential = persistedRecord.kind === 'valid' &&
        samePendingFlaCharacterCreateCredential(persistedRecord.credential, credential);
      const decision = decideFlaCharacterCreateStatus(credential, status, {
        hasVerifiedReentryCredential,
      });
      if (decision.kind === 'committed' || decision.kind === 'committed-project-not-current') {
        if (!status.ok || status.status !== 'COMMITTED') {
          onOperationStateChange('unknown');
          setMessage('保存结果无法与本次操作对应。保持窗口打开并复制核对信息。');
          return;
        }
        if (!hasVerifiedReentryCredential) {
          onOperationStateChange('unknown');
          setMessage('Main 已确认保存，但本机核对记录无法验证。保持窗口打开并复制核对信息。');
          return;
        }
        const resolved = await onResolved(credential, 'committed');
        if (!resolved) {
          if (decision.canClose) {
            setSafeExitAvailable(true);
            onOperationStateChange('safe-to-close');
            setMessage('保存已确认，项目尚未重新载入。本机核对记录已验证；可安全关闭后从项目中心重新打开项目。');
          } else {
            onOperationStateChange('unknown');
            setMessage('保存已确认，但当前项目快照尚未同步。请保持窗口打开并重试查询。');
          }
          return;
        }
        onOperationStateChange('terminal');
        return;
      }
      if (decision.kind === 'failed' || decision.kind === 'not-found') {
        const resolved = await onResolved(credential, 'not-committed');
        if (!resolved) {
          onOperationStateChange('unknown');
          setMessage('本次结果已核对，但本机核对信息无法清理。请保持窗口打开并重试查询。');
          return;
        }
        onOperationStateChange('terminal');
        return;
      }
      onOperationStateChange(decision.operationState);
    } catch {
      setMessage('查询没有返回结果。当前保持锁定；请重试查询或复制编号。');
      onOperationStateChange('unknown');
    } finally {
      setBusy(false);
    }
  };

  const copyReceipt = async (): Promise<void> => {
    const receipt = [
      `operationId=${credential.operationId}`,
      `projectId=${credential.projectId}`,
      `projectRoot=${credential.projectRoot}`,
      `baseRevision=${credential.baseRevision}`,
      `openInstanceId=${credential.openInstanceId}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(receipt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const prepareSafeClose = (): void => {
    onSafeExit(credential.operationId);
    setMessage('已允许安全关闭。请点击应用窗口右上角关闭按钮；核对记录会保留。');
  };

  return (
    <section
      aria-live="polite"
      className="fla-character-create-recovery"
      data-testid="fla-character-create-recovery"
      role="status"
    >
      <div className="fla-character-create-recovery-copy">
        <strong>角色保存待核对</strong>
        <p>{message}</p>
        <code>{credential.operationId}</code>
      </div>
      <div className="fla-character-create-recovery-actions">
        <button
          data-testid="fla-character-create-recovery-query"
          disabled={busy}
          onClick={() => void query()}
          type="button"
        >
          {busy ? '正在查询…' : '查询保存结果'}
        </button>
        <button
          data-testid="fla-character-create-recovery-copy"
          onClick={() => void copyReceipt()}
          type="button"
        >
          {copied ? '已复制' : '复制核对信息'}
        </button>
        {safeExitAvailable ? (
          <button
            data-testid="fla-character-create-recovery-safe-exit"
            onClick={prepareSafeClose}
            type="button"
          >
            允许安全关闭并保留核对记录
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function FlaCharacterCreateRecoveryUnavailable(): React.JSX.Element {
  return (
    <section
      aria-live="assertive"
      className="fla-character-create-recovery"
      data-testid="fla-character-create-recovery-unavailable"
      role="alert"
    >
      <div className="fla-character-create-recovery-copy">
        <strong>角色保存待核对</strong>
        <p>本机核对信息无法读取。请勿重新创建或关闭此窗口，保留当前状态并联系维护者。</p>
      </div>
    </section>
  );
}

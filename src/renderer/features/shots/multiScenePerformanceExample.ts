/**
 * Placeholder for 表演 mode. It doubles as an executable example: the text has
 * to clear the same Parser + Planner as real input, so two actions on one
 * dialogue never share a logical property (position + expression is fine, two
 * positions is a formal conflict) and no default duration outruns its Shot.
 *
 * Lives outside the panel so a unit test can plan the exact string the author
 * sees. Fixing the copy must never relax the conflict gate.
 */
export const PERFORMANCE_INPUT_PLACEHOLDER = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '对白：',
  '张三：你终于来了。',
  '李四：等你很久了。',
  '表演：',
  '1｜表情｜生气',
  '1｜抖动',
  '2｜右入场',
  '2｜放大｜1.20',
  '---',
  '镜头：宗门大厅',
  '背景：宗门大厅',
  '出场：张三、大长老',
  '站位：双人对话',
  '对白：',
  '大长老：你可知错？',
  '张三：弟子知错。',
  '表演：',
  '3｜淡入',
  '4｜移动｜x=1260｜y=760',
].join('\n');

/** 报告模板：生成中文报告骨架，交给 agent 填充与引用。 */

export const REPORT_TEMPLATES = {
  policy_brief: {
    label: '政策简报',
    sections: [
      ['摘要', '三句话讲清：政策是什么、影响谁、接下来看什么。'],
      ['政策要点', '逐条列出政策条款/文件号/发布机构，每条附来源 [n]。'],
      ['影响分析', '对行业/公司/个人的影响，区分确定性与推测。'],
      ['不确定性', '执行细则、时间表、口径变化等待核实项。'],
      ['参考来源', '用 sources references 生成，确保每条都有可点击 URL。'],
    ],
  },
  competitive: {
    label: '竞品分析',
    sections: [
      ['结论', '一句话给出谁领先、差在哪。'],
      ['市场概览', '规模、增速、主要玩家，附来源 [n]。'],
      ['竞品对比', '用表格对比价格/功能/渠道/份额；关键差异用图表。'],
      ['机会与威胁', '可验证的事实与判断分开写。'],
      ['参考来源', '每条来源可点击。'],
    ],
  },
  literature: {
    label: '文献综述',
    sections: [
      ['背景', '问题定义与研究范围。'],
      ['检索方法', '数据库、关键词、时间范围、纳入/排除标准。'],
      ['主要观点', '按流派/主题归纳，标注代表性来源 [n]。'],
      ['分歧与空白', '结论冲突之处、方法差异、尚未解决的问题。'],
      ['结论', '综合判断与后续研究方向。'],
      ['参考文献', '用 sources references 生成。'],
    ],
  },
  due_diligence: {
    label: '尽调 / 调研报告',
    sections: [
      ['对象概览', '主体、业务、股权/团队（仅写可核实信息）。'],
      ['关键数据', '营收/利润/用户/份额等，注明口径与来源 [n]。'],
      ['风险清单', '风险、证据、影响、待核实项。'],
      ['待核实问题', '需要进一步材料或访谈确认的问题。'],
      ['结论', '基于现有信息的判断与置信度。'],
      ['参考来源', '每条来源可点击。'],
    ],
  },
  weekly: {
    label: '周度跟踪',
    sections: [
      ['本周要点', '3–5 条最重要的变化。'],
      ['数据更新', '表格或图表呈现关键指标变化，标注数据日期。'],
      ['趋势判断', '与上周相比的边际变化。'],
      ['下周关注', '日程、数据发布、风险事件。'],
      ['参考来源', '每条来源可点击。'],
    ],
  },
};

export const TEMPLATE_NAMES = Object.keys(REPORT_TEMPLATES);

/**
 * 生成报告骨架 Markdown。
 * @param {object} input
 * @param {string} input.template - REPORT_TEMPLATES 的键
 * @param {string} [input.topic]
 * @param {string} [input.date] - YYYY-MM-DD
 * @param {string} [input.citation] - 引用格式说明，如「编号制 / GB-T 7714 / APA」
 */
export function scaffoldReport({ template, topic = '（研究主题）', date = '', citation = '编号制' }) {
  const spec = REPORT_TEMPLATES[template];
  if (!spec) throw new Error(`未知模板：${template}（可用：${TEMPLATE_NAMES.join(' / ')}）`);
  const lines = [`# ${topic}｜${spec.label}`, ''];
  lines.push(`> 报告日期：${date || '（待填）'}｜模板：${spec.label}｜引用格式：${citation}`);
  lines.push('> 提示：先检索核实再写；正文引用用 [n]，写完跑 report_lint。');
  lines.push('');
  spec.sections.forEach(([title, hint], index) => {
    lines.push(`## ${index + 1}. ${title}`);
    lines.push('');
    lines.push(`<!-- ${hint} -->`);
    lines.push('');
    if (title === '参考来源' || title === '参考文献') {
      lines.push('（用 sources references 生成完整来源清单）');
    } else {
      lines.push('（待填）');
    }
    lines.push('');
  });
  return lines.join('\n');
}

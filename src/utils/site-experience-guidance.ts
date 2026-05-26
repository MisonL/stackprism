import { redactText } from '@/utils/site-experience-redaction'

const cleanGuidanceText = (value: unknown): string => {
  const text = redactText(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 100)
}

export const buildAgentGuidance = (techProfile: Record<string, unknown>, limitations: string[]) => {
  const summaryParts = []
  const primaryFrontend = cleanGuidanceText(techProfile.primaryFrontend)
  if (primaryFrontend) {
    summaryParts.push(`优先复刻 ${primaryFrontend} 的前端体验。`)
  }
  summaryParts.push('优先复刻视觉层级、交互反馈、布局密度和信息结构。')
  const safeLimitations = limitations.map(cleanGuidanceText).filter(Boolean).slice(0, 3)
  if (safeLimitations.length) summaryParts.push(`注意 limitations: ${safeLimitations.join('、')}`)
  return {
    summary: summaryParts.join(' '),
    priorities: ['布局密度', '视觉层级', '交互反馈', '信息结构'],
    cautions: ['高置信证据优先', '低置信候选仅作参考', '隐私字段已脱敏']
  }
}

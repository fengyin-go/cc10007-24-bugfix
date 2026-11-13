import type {
  EntryRow,
  FieldGraveEventView,
  FieldGraveRecordView,
  FieldGraveView,
  GraveReferenceView,
  ReferenceGraveView,
  SideEvidenceView,
} from './types'

/**
 * 字段墓碑共用协议（field-grave/v1）。
 *
 * 这里原先拆成 schema_grave 与 lineage_grave 两份判定，字段侧和引用侧各算一套，
 * 结果同一字段在列表、详情、血缘与汇总里会出现不同结论。现在收拢为一个协议、一个判定入口：
 *
 * 边界：
 * 1. 元数据管理（schema）是字段定义的唯一主对象：章号、字段版本、墓碑终态只在这里产生；
 * 2. 血缘追踪（lineage）与汇总层建模（dws）只登记引用，读取同一份墓碑视图判定引用是否有效，
 *    不自行盖碑、不自行改写章号；
 * 3. 列表、侧栏、详情、导出与概览统计都走 buildFieldGraveView / buildReferenceGraveView，
 *    禁止页面各写一套章号结论。
 *
 * 规则：
 * - 墓碑只能盖在已生效定义上；
 * - 盖碑前列出引用它的血缘边与汇总度量，全部换章（不再引用该字段）后才能完成；
 * - 同一字段同一时间只允许一个有效章号，迟到动作只写旁证，不改写主对象；
 * - 重复立碑是幂等的，不新增墓碑、不重复改写历史。
 */

export const FIELD_MODULE_KEY = 'schema'
export const REFERENCE_MODULE_KEYS = ['lineage', 'dws'] as const
export type ReferenceModuleKey = (typeof REFERENCE_MODULE_KEYS)[number]

export const FIELD_GRAVE_PROTOCOL = 'field-grave/v1'
export const FIELD_CODE = '字段编号'
export const FIELD_VERSION = '版本号'
export const FIELD_CHAPTER = '章号'
export const REFERENCE_FIELD = '引用字段'
export const REFERENCE_CHAPTER = '引用章号'
export const GRAVE_STAMP_FIELD = '墓碑章号'
export const TOMBSTONE_ACTION = '作废下线'
export const REVISE_ACTION = '改章发布'
export const EFFECTIVE_ACTION = '生效发布'
export const SWITCH_ACTION = '引用换章'

/**
 * 各引用模块里可能保存字段编号的列：业务描述列（来源字段 / 度量列定义）与
 * 统一登记列（引用字段）都参与识别，换章时一并改写。章号只看 引用章号。
 */
export const REFERENCE_FIELDS: Record<ReferenceModuleKey, string[]> = {
  lineage: ['来源字段', '目标字段', REFERENCE_FIELD],
  dws: ['度量列定义', REFERENCE_FIELD],
}

export type GraveEvent = FieldGraveEventView

export type FieldGraveRecord = {
  protocol: string
  fieldCode: string
  /** 立碑时字段的有效章号。墓碑不会再获得新章号。 */
  stamp: number
  /** 立碑时字段定义的版本号，回看时用来核对字段版本。 */
  fieldVersion: string
  status: FieldGraveRecordView['status']
  requestedAt: string
  sealedAt: string
  retiredAt: string
  retireReason: string
  /** 首次申请立碑时看到的血缘边与汇总度量快照，作为历史证据保留。 */
  snapshot: GraveReferenceView[]
}

export type FieldLedger = {
  record: FieldGraveRecord | null
  history: GraveEvent[]
}

export type GraveLedger = {
  fields: Record<string, FieldLedger>
  evidence: SideEvidenceView[]
}

export type GraveJudgementCode =
  | 'ok'
  | 'not-effective'
  | 'chapter-mismatch'
  | 'references-open'
  | 'already-sealed'
  | 'field-missing'

export type GraveJudgement = {
  allowed: boolean
  code: GraveJudgementCode
  message: string
  references: GraveReferenceView[]
}

export function emptyLedger(): GraveLedger {
  return { fields: {}, evidence: [] }
}

export function emptyFieldLedger(): FieldLedger {
  return { record: null, history: [] }
}

export function fieldChapter(row: EntryRow): number {
  const value = Number(row[FIELD_CHAPTER])
  return Number.isFinite(value) ? value : 0
}

export function fieldVersion(row: EntryRow): string {
  return String(row[FIELD_VERSION] ?? '')
}

export function isEffectiveField(row: EntryRow): boolean {
  return String(row.status) === '已生效'
}

export function graveStamp(row: EntryRow): number {
  const value = Number(row[GRAVE_STAMP_FIELD])
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 字段当前是否还能被血缘、汇总引用：必须已生效，且没有生效中的墓碑（待换章或已封碑）。 */
export function isFieldCiteable(row: EntryRow, record?: FieldGraveRecord | null): boolean {
  return (
    isEffectiveField(row) &&
    record?.status !== '已封碑' &&
    record?.status !== '待换章'
  )
}

/** 把引用列里可能用逗号 / 分号 / 空格 / 斜线并列的字段代码拆出来。 */
export function referenceTokens(value: unknown): string[] {
  if (typeof value !== 'string') {
    return []
  }
  return value
    .split(/[\s,，;；/|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

export function rowReferencesField(
  moduleKey: ReferenceModuleKey,
  row: EntryRow,
  fieldCode: string,
): boolean {
  return REFERENCE_FIELDS[moduleKey].some((field) =>
    referenceTokens(row[field]).includes(fieldCode),
  )
}

/**
 * 解析一行引用记录指向的字段：优先用统一登记列「引用字段」；
 * 历史数据只有业务描述列时，取第一个能在元数据管理中查到的字段代码。
 */
export function resolveReferencedField(
  moduleKey: ReferenceModuleKey,
  row: EntryRow,
  knownCodes: string[],
): string {
  const canonical = String(row[REFERENCE_FIELD] ?? '').trim()
  if (canonical) {
    return canonical
  }
  const known = new Set(knownCodes)
  for (const field of REFERENCE_FIELDS[moduleKey]) {
    const hit = referenceTokens(row[field]).find((token) => known.has(token))
    if (hit) {
      return hit
    }
  }
  return ''
}

export function replaceReferenceToken(value: unknown, from: string, to: string): string {
  const tokens = referenceTokens(value)
    .map((token) => (token === from ? to : token))
    .filter(Boolean)
  return tokens.join(',')
}

export function referenceLabel(moduleKey: string, row: EntryRow): string {
  const code = moduleKey === 'lineage' ? row['关系编号'] : row['表编号']
  return code ? String(code) : `${moduleKey}-${row.id}`
}

export function referenceStamp(row: EntryRow): number {
  const value = Number(row[REFERENCE_CHAPTER])
  return Number.isFinite(value) ? value : 0
}

/**
 * 当前仍在引用该字段的血缘边与汇总度量（实时值），立碑申请与完成都看这份清单。
 * switched 为 false 表示引用还没有换章，此时不允许完成立碑。
 *
 * 每条引用只认一个字段（引用字段优先，历史数据回退到业务描述列），
 * 避免描述列里恰好出现的其它字段代码被误算成本字段的引用。
 */
export function collectLiveReferences(
  fieldCode: string,
  rowsByModule: Record<string, EntryRow[]>,
  knownCodes: string[],
): GraveReferenceView[] {
  const result: GraveReferenceView[] = []
  for (const moduleKey of REFERENCE_MODULE_KEYS) {
    for (const row of rowsByModule[moduleKey] ?? []) {
      if (resolveReferencedField(moduleKey, row, knownCodes) !== fieldCode) {
        continue
      }
      result.push({
        module: moduleKey,
        id: Number(row.id),
        label: referenceLabel(moduleKey, row),
        field: fieldCode,
        stamp: referenceStamp(row),
        switched: false,
        status: String(row.status),
        note: '仍在引用该字段，需先换章',
      })
    }
  }
  return result
}

/** 用首次立碑快照与当前引用合并，已不再引用该字段的条目记为已换章。 */
export function mergeReferenceSnapshot(
  fieldCode: string,
  rowsByModule: Record<string, EntryRow[]>,
  snapshot: GraveReferenceView[],
  knownCodes: string[],
): GraveReferenceView[] {
  const live = collectLiveReferences(fieldCode, rowsByModule, knownCodes)
  const liveKeys = new Set(live.map((item) => `${item.module}:${item.id}`))
  const merged = live.map((item) => ({ ...item }))
  for (const item of snapshot) {
    if (liveKeys.has(`${item.module}:${item.id}`)) {
      continue
    }
    merged.push({ ...item, switched: true, note: item.note || '已换章，不再引用该字段' })
  }
  return merged
}

/**
 * 唯一的墓碑判定入口：字段主体与引用主体共用。
 *
 * - 字段主体：只有已生效定义可以盖碑；章号必须一致；引用未换章时不许完成；
 * - 引用主体：已封碑字段、未生效字段、引用章号落后的字段都不能再作为有效引用。
 */
export function judgeGrave(
  subject:
    | {
        kind: 'field'
        row: EntryRow
        record?: FieldGraveRecord | null
        references: GraveReferenceView[]
        expectedChapter?: number
      }
    | {
        kind: 'reference'
        moduleKey: ReferenceModuleKey
        row: EntryRow
        fieldCode?: string
        fieldRow?: EntryRow | null
        fieldRecord?: FieldGraveRecord | null
      },
): GraveJudgement {
  if (subject.kind === 'reference') {
    const { moduleKey, row, fieldRow, fieldRecord } = subject
    const fieldCode = subject.fieldCode ?? String(row[REFERENCE_FIELD] ?? '')
    if (!fieldCode) {
      return { allowed: true, code: 'ok', message: '未登记字段引用', references: [] }
    }
    if (!fieldRow) {
      return {
        allowed: false,
        code: 'field-missing',
        message: `引用的字段 ${fieldCode} 在元数据管理里不存在`,
        references: [],
      }
    }
    if (fieldRecord?.status === '已封碑') {
      return {
        allowed: false,
        code: 'already-sealed',
        message: `字段 ${fieldCode} 已封碑，当前引用必须失效`,
        references: [],
      }
    }
    if (fieldRecord?.status === '待换章') {
      return {
        allowed: false,
        code: 'references-open',
        message: `字段 ${fieldCode} 正在立碑（第 ${fieldRecord.stamp} 章），当前引用必须换章`,
        references: [],
      }
    }
    if (!isEffectiveField(fieldRow)) {
      return {
        allowed: false,
        code: 'not-effective',
        message: `字段 ${fieldCode} 尚未生效，不能作为有效引用`,
        references: [],
      }
    }
    if (
      rowReferencesField(moduleKey, row, fieldCode) &&
      referenceStamp(row) !== fieldChapter(fieldRow)
    ) {
      return {
        allowed: false,
        code: 'chapter-mismatch',
        message: `引用章号 ${referenceStamp(row)} 与字段当前有效章号 ${fieldChapter(fieldRow)} 不一致，请先换章`,
        references: [],
      }
    }
    return { allowed: true, code: 'ok', message: '引用有效', references: [] }
  }

  const { row, record, references, expectedChapter } = subject
  if (record?.status === '已封碑') {
    return {
      allowed: false,
      code: 'already-sealed',
      message: '字段墓碑已存在，重复立碑不重复改写',
      references,
    }
  }
  if (!isEffectiveField(row)) {
    return {
      allowed: false,
      code: 'not-effective',
      message: '墓碑只能盖在已生效定义上，当前字段尚未生效',
      references,
    }
  }
  if (expectedChapter !== undefined && expectedChapter !== fieldChapter(row)) {
    return {
      allowed: false,
      code: 'chapter-mismatch',
      message: `动作章号 ${expectedChapter} 不是字段当前有效章号 ${fieldChapter(row)}，按迟到动作记旁证`,
      references,
    }
  }
  if (references.some((item) => !item.switched)) {
    return {
      allowed: false,
      code: 'references-open',
      message: '仍有血缘边或汇总度量引用该字段，全部换章后才能完成立碑',
      references,
    }
  }
  return { allowed: true, code: 'ok', message: '可以完成立碑', references }
}

export type GraveViewInput = {
  fieldRow: EntryRow
  record: FieldGraveRecord | null
  references: GraveReferenceView[]
  history: GraveEvent[]
  sideEvidence: SideEvidenceView[]
}

/**
 * 统一墓碑视图。侧栏列表、详情页、导出与统计都从这里取数，
 * 保证任何位置看到的“有效章号”只有一个，旧章只出现在历史里。
 */
export function buildFieldGraveView(input: GraveViewInput): FieldGraveView {
  const { fieldRow, record, references, history, sideEvidence } = input
  const chapter = fieldChapter(fieldRow)
  const version = fieldVersion(fieldRow)
  // 已失效的墓碑申请只保留在历史里，不再限制字段当前的引用与章号。
  const activeRecord = record && record.status !== '已失效' ? record : null
  const sealed = record?.status === '已封碑'
  const graveState: FieldGraveView['graveState'] = sealed
    ? '已封碑'
    : record?.status === '已失效'
      ? '已失效'
      : record
        ? '待换章'
        : isEffectiveField(fieldRow)
          ? '未立碑'
          : '未生效'
  return {
    fieldCode: String(fieldRow[FIELD_CODE] ?? ''),
    fieldVersion: version,
    chapter,
    effectiveChapter: sealed || !isEffectiveField(fieldRow) ? 0 : chapter,
    status: sealed ? '已作废' : String(fieldRow.status),
    graveState,
    citeable: isFieldCiteable(fieldRow, activeRecord),
    versionMatchesGrave: record ? record.fieldVersion === version : true,
    cells: { ...fieldRow },
    grave: record
      ? {
          protocol: record.protocol,
          fieldCode: record.fieldCode,
          stamp: record.stamp,
          fieldVersion: record.fieldVersion,
          status: record.status,
          requestedAt: record.requestedAt,
          sealedAt: record.sealedAt,
          retiredAt: record.retiredAt,
          retireReason: record.retireReason,
          snapshot: record.snapshot,
        }
      : null,
    references,
    history,
    sideEvidence,
  }
}

export type ReferenceViewInput = {
  moduleKey: ReferenceModuleKey
  row: EntryRow
  fieldCode?: string
  fieldRow?: EntryRow | null
  fieldRecord?: FieldGraveRecord | null
}

/**
 * 引用侧统一视图：血缘与汇总共用，字段定义与墓碑结论一律取自元数据主对象。
 */
export function buildReferenceGraveView(input: ReferenceViewInput): ReferenceGraveView {
  const { moduleKey, row, fieldRow, fieldRecord } = input
  const fieldCode = input.fieldCode ?? String(row[REFERENCE_FIELD] ?? '')
  // 字段一旦封碑或未生效，有效章号就是 0；引用侧不保留旧章号。
  const effectiveFieldChapter =
    fieldRow && isEffectiveField(fieldRow) ? fieldChapter(fieldRow) : 0
  const base: ReferenceGraveView = {
    module: moduleKey,
    id: Number(row.id),
    label: referenceLabel(moduleKey, row),
    status: String(row.status),
    fieldCode,
    referenceStamp: referenceStamp(row),
    fieldStatus: fieldRow ? String(fieldRow.status) : '不存在',
    fieldVersion: fieldRow ? fieldVersion(fieldRow) : '',
    fieldChapter: effectiveFieldChapter,
    graveState: '未引用',
    valid: true,
    reason: '未登记字段引用',
    cells: { ...row },
  }
  if (!fieldCode) {
    return base
  }
  const judgement = judgeGrave({ kind: 'reference', moduleKey, row, fieldCode, fieldRow, fieldRecord })
  const graveState: ReferenceGraveView['graveState'] =
    fieldRecord?.status === '已封碑'
      ? '已封碑'
      : fieldRecord?.status === '已失效'
        ? '已失效'
        : fieldRecord
          ? '待换章'
          : fieldRow && isEffectiveField(fieldRow)
            ? '未立碑'
            : '未生效'
  return {
    ...base,
    graveState,
    valid: judgement.allowed,
    reason: judgement.message,
  }
}

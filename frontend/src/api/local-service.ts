import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  graveLedger,
  listRows,
  resetGraveLedger,
  resetRows,
  saveGraveLedger,
  saveRows,
} from '@/data/local-store'
import {
  FIELD_CHAPTER,
  FIELD_CODE,
  FIELD_GRAVE_PROTOCOL,
  FIELD_MODULE_KEY,
  FIELD_VERSION,
  GRAVE_STAMP_FIELD,
  REFERENCE_CHAPTER,
  REFERENCE_FIELD,
  REFERENCE_FIELDS,
  REFERENCE_MODULE_KEYS,
  buildFieldGraveView,
  buildReferenceGraveView,
  collectLiveReferences,
  emptyFieldLedger,
  fieldChapter,
  fieldVersion,
  isEffectiveField,
  judgeGrave,
  mergeReferenceSnapshot,
  referenceStamp,
  replaceReferenceToken,
  referenceTokens,
  resolveReferencedField,
} from '@/data/grave-protocol'
import type { FieldGraveRecord, ReferenceModuleKey } from '@/data/grave-protocol'
import type {
  ActionResult,
  EntryRow,
  FieldGraveEventType,
  FieldGraveView,
  GraveReferenceView,
  GraveSummary,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReferenceGraveView,
  SideEvidenceView,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export type ActionOptions = {
  /** 操作人看到的章号。与库里的当前章号不一致时按迟到动作处理，只写旁证。 */
  expectedChapter?: number
  /** 操作人看到的字段版本号。与库里的版本不一致时同样按迟到动作处理。 */
  expectedVersion?: string
  /** 引用换章的目标字段编号；留空表示解除引用。 */
  replacement?: string
  operator?: string
}

const DEFAULT_OPERATOR = '值班管理员'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function now(): string {
  return new Date().toISOString()
}

function nextEventId(history: { id: number }[]): number {
  return history.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function bumpVersion(version: string): string {
  const matched = /^(.*?)(\d+)$/.exec(version)
  if (matched) {
    return `${matched[1]}${Number(matched[2]) + 1}`
  }
  return version ? `${version}.1` : 'v2'
}

function fieldRowByCode(code: string): EntryRow | undefined {
  return listRows(FIELD_MODULE_KEY).find((row) => String(row[FIELD_CODE]) === code)
}

function ledgerFor(code: string) {
  return graveLedger().fields[code] ?? emptyFieldLedger()
}

function referencesForField(code: string, record: FieldGraveRecord | null): GraveReferenceView[] {
  // 只有正在立碑或已封碑时才用立碑快照；失效的旧申请不参与当前视图，改用实时引用。
  if (record?.status === '待换章' || record?.status === '已封碑') {
    return mergeReferenceSnapshot(code, allRows(), record.snapshot, allFieldCodes())
  }
  return collectLiveReferences(code, allRows(), allFieldCodes())
}

function evidenceForField(code: string): SideEvidenceView[] {
  return graveLedger().evidence.filter((item) => item.fieldCode === code)
}

function recordEvent(
  code: string,
  type: FieldGraveEventType,
  options: { chapter?: number; version?: string; target?: string; note?: string; operator?: string } = {},
): void {
  const ledger = graveLedger()
  const existing = ledger.fields[code] ?? emptyFieldLedger()
  const entry = {
    id: nextEventId(existing.history),
    type,
    at: now(),
    operator: options.operator ?? DEFAULT_OPERATOR,
    chapter: options.chapter ?? 0,
    fieldVersion: options.version ?? '',
    target: options.target,
    note: options.note ?? '',
  }
  const next = {
    ...ledger,
    fields: {
      ...ledger.fields,
      [code]: { ...existing, history: [...existing.history, entry] },
    },
  }
  saveGraveLedger(next)
}

/** 迟到动作只写旁证，不改写字段定义、章号、版本或墓碑。 */
function recordLateAction(
  code: string,
  action: string,
  expectedChapter: number | undefined,
  expectedVersion: string | undefined,
  actual: EntryRow,
  operator?: string,
): SideEvidenceView {
  const ledger = graveLedger()
  const id = ledger.evidence.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const evidence: SideEvidenceView = {
    id,
    fieldCode: code,
    action,
    at: now(),
    operator: operator ?? DEFAULT_OPERATOR,
    expectedStamp: expectedChapter ?? -1,
    actualStamp: fieldChapter(actual),
    expectedVersion: expectedVersion ?? '',
    actualVersion: fieldVersion(actual),
    outcome: '未执行，记为旁证',
    note: '动作基于已失效的章号或字段版本，不能覆盖当前有效章号',
  }
  saveGraveLedger({ ...ledger, evidence: [...ledger.evidence, evidence] })
  return evidence
}

function setRecord(code: string, record: FieldGraveRecord | null): void {
  const ledger = graveLedger()
  const existing = ledger.fields[code] ?? emptyFieldLedger()
  saveGraveLedger({
    ...ledger,
    fields: { ...ledger.fields, [code]: { ...existing, record } },
  })
}

function fieldView(row: EntryRow): FieldGraveView {
  const code = String(row[FIELD_CODE] ?? '')
  const { record, history } = ledgerFor(code)
  return buildFieldGraveView({
    fieldRow: row,
    record,
    references: referencesForField(code, record),
    history,
    sideEvidence: evidenceForField(code),
  })
}

/** 元数据管理列表：侧栏、表格、导出、详情共用同一个墓碑视图。 */
export function listFieldGraves(filters: Record<string, string> = {}): FieldGraveView[] {
  return filterRows(listRows(FIELD_MODULE_KEY), filters).map((row) => fieldView(row))
}

export function fieldGraveDetail(idOrCode: number | string): FieldGraveView | null {
  const rows = listRows(FIELD_MODULE_KEY)
  const row =
    typeof idOrCode === 'number'
      ? rows.find((item) => Number(item.id) === idOrCode)
      : rows.find((item) => String(item[FIELD_CODE]) === idOrCode)
  return row ? fieldView(row) : null
}

/** 可供换章使用的目标字段：已生效、未立碑、没有未换章引用。 */
export function listCiteableFields(): FieldGraveView[] {
  return listFieldGraves().filter(
    (item) => item.status === '已生效' && item.citeable && item.graveState === '未立碑',
  )
}

/** 血缘 / 汇总列表：字段定义、章节与墓碑结论都读取元数据主对象。 */
export function listReferenceGraves(
  moduleKey: ReferenceModuleKey,
  filters: Record<string, string> = {},
): ReferenceGraveView[] {
  return filterRows(listRows(moduleKey), filters).map((row) => referenceView(moduleKey, row))
}

export function referenceGraveDetail(
  moduleKey: ReferenceModuleKey,
  id: number,
): ReferenceGraveView | null {
  const row = listRows(moduleKey).find((item) => Number(item.id) === id)
  return row ? referenceView(moduleKey, row) : null
}

function referenceView(moduleKey: ReferenceModuleKey, row: EntryRow): ReferenceGraveView {
  const code = resolveReferencedField(moduleKey, row, allFieldCodes())
  const fieldRow = code ? fieldRowByCode(code) : null
  const fieldRecord = code ? ledgerFor(code).record : null
  return buildReferenceGraveView({ moduleKey, row, fieldCode: code, fieldRow, fieldRecord })
}

function allFieldCodes(): string[] {
  return listRows(FIELD_MODULE_KEY).map((row) => String(row[FIELD_CODE] ?? '')).filter(Boolean)
}

export function graveSummary(): GraveSummary {
  const fields = listFieldGraves()
  const references = REFERENCE_MODULE_KEYS.flatMap((key) => listReferenceGraves(key))
  return {
    fieldTotal: fields.length,
    effectiveFields: fields.filter((item) => item.status === '已生效').length,
    pendingReview: fields.filter((item) => item.status === '待审核').length,
    pendingTombs: fields.filter((item) => item.graveState === '待换章').length,
    sealedTombs: fields.filter((item) => item.graveState === '已封碑').length,
    openReferences: fields.reduce(
      (sum, item) => sum + item.references.filter((ref) => !ref.switched).length,
      0,
    ),
    invalidReferences: references.filter((item) => !item.valid).length,
    sideEvidence: graveLedger().evidence.length,
  }
}

function sealField(row: EntryRow, note: string, operator?: string): ActionResult {
  const code = String(row[FIELD_CODE])
  const record = ledgerFor(code).record
  if (!record) {
    return { ok: false, message: '没有待完成的墓碑申请', code: 'field-missing' }
  }
  const judgement = judgeGrave({
    kind: 'field',
    row,
    record,
    references: referencesForField(code, record),
  })
  if (!judgement.allowed) {
    return {
      ok: false,
      message: judgement.message,
      code: judgement.code,
      references: judgement.references,
      grave: fieldView(row),
    }
  }
  const sealed: FieldGraveRecord = {
    ...record,
    status: '已封碑',
    sealedAt: now(),
    snapshot: record.snapshot,
  }
  setRecord(code, sealed)
  const updated: EntryRow = {
    ...row,
    status: '已作废',
    pending: false,
    abnormal: true,
    [GRAVE_STAMP_FIELD]: record.stamp,
  }
  saveRows(
    FIELD_MODULE_KEY,
    listRows(FIELD_MODULE_KEY).map((item) => (Number(item.id) === Number(row.id) ? updated : item)),
  )
  recordEvent(code, '立碑完成', {
    chapter: record.stamp,
    version: record.fieldVersion,
    note,
    operator,
  })
  return {
    ok: true,
    message: `字段 ${code} 已完成立碑，当前状态「已作废」`,
    code: 'ok',
    grave: fieldView(updated),
  }
}

function invalidatePendingTombstone(row: EntryRow, reason: string, operator?: string): void {
  const code = String(row[FIELD_CODE])
  const record = ledgerFor(code).record
  if (!record || record.status !== '待换章') {
    return
  }
  setRecord(code, {
    ...record,
    status: '已失效',
    retiredAt: now(),
    retireReason: reason,
  })
  recordEvent(code, '立碑失效', {
    chapter: fieldChapter(row),
    version: fieldVersion(row),
    note: reason,
    operator,
  })
}

function runTombstone(row: EntryRow, options: ActionOptions): ActionResult {
  const code = String(row[FIELD_CODE])
  const chapter = fieldChapter(row)
  const version = fieldVersion(row)

  if (options.expectedChapter !== undefined && options.expectedChapter !== chapter) {
    const evidence = recordLateAction(
      code,
      '作废下线',
      options.expectedChapter,
      options.expectedVersion,
      row,
      options.operator,
    )
    return {
      ok: false,
      code: 'chapter-mismatch',
      message: `动作基于第 ${options.expectedChapter} 章，字段当前有效章号为第 ${chapter} 章；迟到动作已记旁证 #${evidence.id}`,
      references: referencesForField(code, ledgerFor(code).record),
      grave: fieldView(row),
    }
  }
  if (options.expectedVersion !== undefined && options.expectedVersion !== version) {
    const evidence = recordLateAction(
      code,
      '作废下线',
      options.expectedChapter,
      options.expectedVersion,
      row,
      options.operator,
    )
    return {
      ok: false,
      code: 'chapter-mismatch',
      message: `动作基于字段版本 ${options.expectedVersion}，当前版本为 ${version}；迟到动作已记旁证 #${evidence.id}`,
      references: referencesForField(code, ledgerFor(code).record),
      grave: fieldView(row),
    }
  }

  const existing = ledgerFor(code).record
  if (existing?.status === '已封碑') {
    return {
      ok: false,
      code: 'already-sealed',
      message: `字段 ${code} 的墓碑已存在，重复立碑不重复改写`,
      grave: fieldView(row),
    }
  }
  if (!isEffectiveField(row)) {
    return {
      ok: false,
      code: 'not-effective',
      message: `墓碑只能盖在已生效定义上；字段 ${code} 当前状态「${row.status}」，不能取得作废章`,
      grave: fieldView(row),
    }
  }

  // 已有待换章申请：先核对申请时的字段版本与章号，变了就是迟到动作。
  if (existing?.status === '待换章') {
    if (existing.stamp !== chapter || existing.fieldVersion !== version) {
      invalidatePendingTombstone(row, '字段章号或字段版本已变更，原墓碑申请作废', options.operator)
      const evidence = recordLateAction(
        code,
        '作废下线',
        existing.stamp,
        existing.fieldVersion,
        row,
        options.operator,
      )
      return {
        ok: false,
        code: 'chapter-mismatch',
        message: `墓碑申请基于第 ${existing.stamp} 章 / 版本 ${existing.fieldVersion}，字段已变更为第 ${chapter} 章 / 版本 ${version}；按迟到动作记旁证 #${evidence.id}`,
        references: referencesForField(code, ledgerFor(code).record),
        grave: fieldView(row),
      }
    }
    const references = referencesForField(code, existing)
    const judgement = judgeGrave({ kind: 'field', row, record: existing, references })
    if (!judgement.allowed) {
      return {
        ok: false,
        code: judgement.code,
        message: judgement.message,
        references,
        grave: fieldView(row),
      }
    }
    return sealField(row, '引用已全部换章，完成立碑', options.operator)
  }

  // 首次立碑：先把引用它的血缘边与汇总度量列出来。
  const liveReferences = referencesForField(code, null)
  const record: FieldGraveRecord = {
    protocol: FIELD_GRAVE_PROTOCOL,
    fieldCode: code,
    stamp: chapter,
    fieldVersion: version,
    status: '待换章',
    requestedAt: now(),
    sealedAt: '',
    retiredAt: '',
    retireReason: '',
    snapshot: liveReferences,
  }
  setRecord(code, record)
  recordEvent(code, '立碑申请', {
    chapter,
    version,
    note: liveReferences.length
      ? `列出 ${liveReferences.length} 条引用：${liveReferences.map((item) => item.label).join('、')}`
      : '无引用，可直接完成',
    operator: options.operator,
  })
  if (liveReferences.some((item) => !item.switched)) {
    return {
      ok: false,
      code: 'references-open',
      message: `字段 ${code} 仍被 ${liveReferences.length} 条引用使用（血缘边 / 汇总度量），全部换章后才能完成立碑`,
      references: liveReferences,
      grave: fieldView(row),
    }
  }
  return sealField(row, '无未换章引用，直接完成立碑', options.operator)
}

function runFieldAction(row: EntryRow, action: string, options: ActionOptions): ActionResult {
  const code = String(row[FIELD_CODE])
  const chapter = fieldChapter(row)
  const version = fieldVersion(row)
  const operator = options.operator

  if (action === '作废下线') {
    return runTombstone(row, options)
  }

  // 章号相关动作：先做迟到判定，迟到只写旁证。
  if (action === '生效发布' || action === '改章发布') {
    if (options.expectedChapter !== undefined && options.expectedChapter !== chapter) {
      const evidence = recordLateAction(
        code,
        action,
        options.expectedChapter,
        options.expectedVersion,
        row,
        operator,
      )
      return {
        ok: false,
        code: 'chapter-mismatch',
        message: `动作基于第 ${options.expectedChapter} 章，字段当前有效章号为第 ${chapter} 章；迟到动作已记旁证 #${evidence.id}`,
        grave: fieldView(row),
      }
    }
    if (options.expectedVersion !== undefined && options.expectedVersion !== version) {
      const evidence = recordLateAction(
        code,
        action,
        options.expectedChapter,
        options.expectedVersion,
        row,
        operator,
      )
      return {
        ok: false,
        code: 'chapter-mismatch',
        message: `动作基于字段版本 ${options.expectedVersion}，当前版本为 ${version}；迟到动作已记旁证 #${evidence.id}`,
        grave: fieldView(row),
      }
    }
  }

  const ledger = ledgerFor(code)
  if (action === '提交审核') {
    if (String(row.status) !== '草稿') {
      return {
        ok: false,
        code: 'not-effective',
        message: `只有草稿可以提交审核，字段 ${code} 当前状态「${row.status}」`,
        grave: fieldView(row),
      }
    }
    const updated: EntryRow = { ...row, status: '待审核', pending: true, abnormal: false }
    saveRows(
      FIELD_MODULE_KEY,
      listRows(FIELD_MODULE_KEY).map((item) =>
        Number(item.id) === Number(row.id) ? updated : item,
      ),
    )
    return {
      ok: true,
      message: `字段 ${code} 已提交审核，当前状态「待审核」`,
      grave: fieldView(updated),
    }
  }

  if (action === '生效发布') {
    if (String(row.status) !== '待审核') {
      return {
        ok: false,
        code: 'not-effective',
        message: `只有待审核字段可以生效发布，字段 ${code} 当前状态「${row.status}」`,
        grave: fieldView(row),
      }
    }
    if (ledger.record?.status === '已封碑') {
      return {
        ok: false,
        code: 'already-sealed',
        message: `字段 ${code} 已封碑，不能重新生效`,
        grave: fieldView(row),
      }
    }
    const nextChapter = chapter > 0 ? chapter : 1
    const updated: EntryRow = {
      ...row,
      status: '已生效',
      pending: false,
      abnormal: false,
      [FIELD_CHAPTER]: nextChapter,
      [FIELD_VERSION]: version || 'v1',
    }
    saveRows(
      FIELD_MODULE_KEY,
      listRows(FIELD_MODULE_KEY).map((item) =>
        Number(item.id) === Number(row.id) ? updated : item,
      ),
    )
    recordEvent(code, '生效发布', {
      chapter: nextChapter,
      version: fieldVersion(updated),
      note: `字段获得第 ${nextChapter} 章`,
      operator,
    })
    return {
      ok: true,
      message: `字段 ${code} 已生效，有效章号第 ${nextChapter} 章`,
      grave: fieldView(updated),
    }
  }

  if (action === '改章发布') {
    if (!isEffectiveField(row)) {
      return {
        ok: false,
        code: 'not-effective',
        message: `只有已生效字段可以改章，字段 ${code} 当前状态「${row.status}」`,
        grave: fieldView(row),
      }
    }
    if (ledger.record?.status === '已封碑') {
      return {
        ok: false,
        code: 'already-sealed',
        message: `字段 ${code} 已封碑，不能再改章`,
        grave: fieldView(row),
      }
    }
    // 并行改章 / 立碑只允许一个有效章号：改章会让旧的墓碑申请失效。
    invalidatePendingTombstone(row, '字段已改章，原墓碑申请作废', operator)
    const nextChapter = chapter + 1
    const updated: EntryRow = {
      ...row,
      status: '已生效',
      pending: false,
      abnormal: false,
      [FIELD_CHAPTER]: nextChapter,
      [FIELD_VERSION]: bumpVersion(version),
    }
    saveRows(
      FIELD_MODULE_KEY,
      listRows(FIELD_MODULE_KEY).map((item) =>
        Number(item.id) === Number(row.id) ? updated : item,
      ),
    )
    recordEvent(code, '改章发布', {
      chapter: nextChapter,
      version: fieldVersion(updated),
      note: `第 ${chapter} 章作废，当前有效章号第 ${nextChapter} 章；引用需重新换章`,
      operator,
    })
    return {
      ok: true,
      message: `字段 ${code} 已改章，有效章号第 ${nextChapter} 章，引用方需重新换章`,
      grave: fieldView(updated),
    }
  }

  return {
    ok: false,
    message: `字段定义没有登记「${action}」这个动作`,
    grave: fieldView(row),
  }
}

/** 血缘边或汇总度量换章：换到另一个已生效字段，或解除引用。 */
export function switchReference(
  moduleKey: ReferenceModuleKey,
  id: number,
  options: ActionOptions = {},
): ActionResult {
  const rows = listRows(moduleKey)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${moduleKey === 'lineage' ? '血缘关系' : '汇总表'}` }
  }
  const row = rows[index]
  const code = resolveReferencedField(moduleKey, row, allFieldCodes())
  if (!code) {
    return { ok: false, message: '该记录没有登记字段引用，无需换章' }
  }
  // 换章时把业务描述列里的字段代码一起换掉，避免列表和详情继续显示旧引用。
  const oldReferences = REFERENCE_FIELDS[moduleKey].filter((field) =>
    referenceTokens(row[field]).includes(code),
  )
  if (
    options.expectedChapter !== undefined &&
    options.expectedChapter !== referenceStamp(row)
  ) {
    const fieldRow = fieldRowByCode(code)
    if (fieldRow) {
      const evidence = recordLateAction(
        code,
        '引用换章',
        options.expectedChapter,
        options.expectedVersion,
        fieldRow,
        options.operator,
      )
      return {
        ok: false,
        code: 'chapter-mismatch',
        message: `引用已从第 ${options.expectedChapter} 章变为第 ${referenceStamp(row)} 章；迟到动作已记旁证 #${evidence.id}`,
        grave: fieldView(fieldRow),
      }
    }
  }

  let replacementRow: EntryRow | null = null
  if (options.replacement) {
    replacementRow = fieldRowByCode(options.replacement) ?? null
    if (!replacementRow) {
      return { ok: false, message: `替换字段 ${options.replacement} 不存在` }
    }
    if (!isEffectiveField(replacementRow)) {
      return { ok: false, message: `替换字段 ${options.replacement} 尚未生效，不能作为引用目标` }
    }
    const replacementRecord = ledgerFor(options.replacement).record
    if (replacementRecord?.status === '已封碑') {
      return { ok: false, message: `替换字段 ${options.replacement} 已封碑，不能作为引用目标` }
    }
    if (replacementRecord?.status === '待换章') {
      return {
        ok: false,
        message: `替换字段 ${options.replacement} 正在立碑（第 ${replacementRecord.stamp} 章），不能作为引用目标`,
      }
    }
    if (replacementRecord?.status === '已失效') {
      return { ok: false, message: `替换字段 ${options.replacement} 的墓碑申请已失效，请先确认字段定义` }
    }
  }

  const nextRow: EntryRow = {
    ...row,
    [REFERENCE_FIELD]: replacementRow ? String(replacementRow[FIELD_CODE]) : '',
    [REFERENCE_CHAPTER]: replacementRow ? fieldChapter(replacementRow) : 0,
  }
  for (const field of oldReferences) {
    nextRow[field] = replaceReferenceToken(
      row[field],
      code,
      replacementRow ? String(replacementRow[FIELD_CODE]) : '',
    )
  }
  const nextRows = [...rows]
  nextRows[index] = nextRow
  saveRows(moduleKey, nextRows)

  const label = moduleKey === 'lineage' ? String(row['关系编号'] ?? id) : String(row['表编号'] ?? id)
  recordEvent(code, '引用换章', {
    chapter: fieldChapter(fieldRowByCode(code) ?? row),
    version: fieldVersion(fieldRowByCode(code) ?? row),
    target: label,
    note: replacementRow
      ? `${label} 换至字段 ${options.replacement}（第 ${fieldChapter(replacementRow)} 章）`
      : `${label} 解除对字段 ${code} 的引用`,
    operator: options.operator,
  })

  // 最后一条引用换章后，待换章墓碑可以自动完成。
  const fieldRow = fieldRowByCode(code)
  const record = ledgerFor(code).record
  if (fieldRow && record?.status === '待换章') {
    const refs = referencesForField(code, record)
    const stillMatches =
      record.stamp === fieldChapter(fieldRow) && record.fieldVersion === fieldVersion(fieldRow)
    if (stillMatches && refs.every((item) => item.switched)) {
      const sealed = sealField(fieldRow, '最后一条引用换章，自动完成立碑', options.operator)
      if (sealed.ok) {
        return {
          ...sealed,
          message: `${label} 已换章；字段 ${code} 引用全部解除，墓碑已完成`,
        }
      }
    }
  }

  return {
    ok: true,
    message: replacementRow
      ? `${label} 已换章至字段 ${options.replacement}（第 ${fieldChapter(replacementRow)} 章）`
      : `${label} 已解除对字段 ${code} 的引用`,
    grave: fieldRow ? fieldView(fieldRow) : undefined,
  }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  options: ActionOptions = {},
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)

  // 字段定义的动作有章号语义：改章发布在已生效状态下仍然是合法动作，
  // 作废下线需要交给墓碑协议做幂等判定，不能在这里按普通状态流转拦掉。
  if (key === FIELD_MODULE_KEY) {
    return runFieldAction(rows[index], action, options)
  }

  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 引用侧启用前，用同一个墓碑协议检查字段主对象是否仍可引用。
  if (REFERENCE_MODULE_KEYS.includes(key as ReferenceModuleKey) && target === '已启用') {
    const referenceModule = key as ReferenceModuleKey
    const fieldCode = resolveReferencedField(referenceModule, rows[index], allFieldCodes())
    if (fieldCode) {
      const fieldRow = fieldRowByCode(fieldCode) ?? null
      const judgement = judgeGrave({
        kind: 'reference',
        moduleKey: referenceModule,
        row: rows[index],
        fieldCode,
        fieldRow,
        fieldRecord: ledgerFor(fieldCode).record,
      })
      if (!judgement.allowed) {
        return {
          ok: false,
          code: judgement.code,
          message: `${meta.entity}引用的字段 ${fieldCode} 当前不可用：${judgement.message}`,
          references: [],
        }
      }
    }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  if (key === FIELD_MODULE_KEY) {
    resetGraveLedger()
  }
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const summary = graveSummary()
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '待换章墓碑', value: summary.pendingTombs },
    { label: '失效引用', value: summary.invalidReferences },
  ]
  return { cards, modules, grave: summary }
}

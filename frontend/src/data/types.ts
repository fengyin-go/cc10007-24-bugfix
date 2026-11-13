/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

/**
 * 一条引用：血缘边（lineage）或汇总度量（dws）。
 * switched 表示该引用已经换章 / 解除引用，不再指向被立碑的字段。
 */
export type GraveReferenceView = {
  module: 'lineage' | 'dws'
  id: number
  label: string
  field: string
  stamp: number
  switched: boolean
  status: string
  note: string
}

export type FieldGraveEventType =
  | '生效发布'
  | '改章发布'
  | '立碑申请'
  | '引用换章'
  | '立碑完成'
  | '立碑失效'
  | '迟到动作'

export type FieldGraveEventView = {
  id: number
  type: FieldGraveEventType
  at: string
  operator: string
  chapter: number
  fieldVersion: string
  target?: string
  note: string
}

export type FieldGraveRecordView = {
  protocol: string
  fieldCode: string
  stamp: number
  fieldVersion: string
  status: '待换章' | '已封碑' | '已失效'
  requestedAt: string
  sealedAt: string
  retiredAt: string
  retireReason: string
  snapshot: GraveReferenceView[]
}

/** 旁证：章号或字段版本已经变化后迟到的动作，只记录，不改写主对象。 */
export type SideEvidenceView = {
  id: number
  fieldCode: string
  action: string
  at: string
  operator: string
  expectedStamp: number
  actualStamp: number
  expectedVersion: string
  actualVersion: string
  outcome: string
  note: string
}

export type FieldGraveView = {
  fieldCode: string
  fieldVersion: string
  /** 字段最近一次发布的章号（历史值，封碑后保留）。 */
  chapter: number
  /** 当前仍然有效的章号；未生效或已封碑时为 0。 */
  effectiveChapter: number
  status: string
  graveState: '未生效' | '未立碑' | '待换章' | '已封碑' | '已失效'
  citeable: boolean
  versionMatchesGrave: boolean
  /** 业务列原值只做展示，不参与章号判定。 */
  cells: Record<string, string | number | boolean>
  grave: FieldGraveRecordView | null
  references: GraveReferenceView[]
  history: FieldGraveEventView[]
  sideEvidence: SideEvidenceView[]
}

/** 血缘 / 汇总页面读取的引用视图：字段定义永远从元数据管理主对象取。 */
export type ReferenceGraveView = {
  module: 'lineage' | 'dws'
  id: number
  label: string
  status: string
  fieldCode: string
  referenceStamp: number
  fieldStatus: string
  fieldVersion: string
  fieldChapter: number
  graveState: FieldGraveView['graveState'] | '未引用'
  valid: boolean
  reason: string
  /** 业务列原值只做展示，不参与章号判定。 */
  cells: Record<string, string | number | boolean>
}

export type GraveSummary = {
  fieldTotal: number
  effectiveFields: number
  pendingReview: number
  pendingTombs: number
  sealedTombs: number
  openReferences: number
  invalidReferences: number
  sideEvidence: number
}

export type ActionResult = {
  ok: boolean
  message: string
  code?: string
  references?: GraveReferenceView[]
  grave?: FieldGraveView
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
  grave: GraveSummary
}

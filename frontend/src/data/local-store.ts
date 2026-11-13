import { SEED_ROWS } from './seed'
import { emptyLedger } from './grave-protocol'
import type { GraveLedger } from './grave-protocol'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'data-layer-studio:entries'
const LEDGER_KEY = 'data-layer-studio:field-grave-ledger'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (!hasStorage()) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    // 业务数据回到示例数据时，墓碑台账也必须一起回到初始状态，
    // 否则清掉 entries 后仍会读到上一次的封碑记录，列表与详情就会再次对不上。
    window.localStorage.removeItem(LEDGER_KEY)
    ledgerCache = null
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(LEDGER_KEY)
    ledgerCache = null
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
let ledgerCache: GraveLedger | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (hasStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 墓碑台账：墓碑、历史与旁证单独存放，业务行只保存最近章号与版本号。 */
export function graveLedger(): GraveLedger {
  if (ledgerCache !== null) {
    return ledgerCache
  }
  const fallback = emptyLedger()
  if (!hasStorage()) {
    ledgerCache = fallback
    return fallback
  }
  const raw = window.localStorage.getItem(LEDGER_KEY)
  if (!raw) {
    ledgerCache = fallback
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GraveLedger>
    ledgerCache = {
      fields: parsed.fields ?? {},
      evidence: parsed.evidence ?? [],
    }
  } catch {
    ledgerCache = fallback
  }
  return ledgerCache
}

export function saveGraveLedger(ledger: GraveLedger): void {
  ledgerCache = ledger
  if (hasStorage()) {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger))
  }
}

export function resetGraveLedger(): void {
  saveGraveLedger(emptyLedger())
}

<template>
  <section class="page" data-module="schema">
    <header class="page-head">
      <div>
        <h2>元数据管理</h2>
        <p class="page-desc">
          字段定义是唯一主对象。墓碑只能盖在已生效定义上，盖碑前先列出引用它的血缘边与汇总度量，
          引用全部换章后才完成；列表、侧栏与详情共用同一份墓碑视图。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记字段定义</button>
        <button class="btn" type="button" @click="exportRows">导出元数据管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">待换章墓碑：{{ summary.pendingTombs }}</span>
      <span class="legend-item">已封碑：{{ summary.sealedTombs }}</span>
      <span class="legend-item">失效引用：{{ summary.invalidReferences }}</span>
      <span class="legend-item">旁证：{{ summary.sideEvidence }}</span>
    </p>

    <div class="grave-layout">
      <div class="grave-main">
        <form class="filter-bar" @submit.prevent="reload">
          <label v-for="field in filterFields" :key="field" class="filter-item">
            <span>{{ field }}</span>
            <input v-model="filters[field]" :placeholder="`按${field}检索`" />
          </label>
          <button class="btn" type="submit">查询</button>
          <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
        </form>

        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>有效章号</th>
              <th>墓碑</th>
              <th>可引用</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="view in graveRows"
              :key="view.fieldCode"
              :class="{ 'row-selected': selectedCode === view.fieldCode }"
              @click="selectField(view)"
            >
              <td v-for="column in columns" :key="column">{{ cellValue(view, column) }}</td>
              <td>{{ view.status }}</td>
              <td>{{ view.effectiveChapter ? `第 ${view.effectiveChapter} 章` : '—' }}</td>
              <td>
                <span class="badge" :class="badgeClass(view.graveState)">{{ view.graveState }}</span>
              </td>
              <td>{{ view.citeable ? '可引用' : '不可引用' }}</td>
              <td class="row-actions" @click.stop>
                <button
                  v-for="action in actions"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runFieldAction(action, view)"
                >
                  {{ action }}
                </button>
              </td>
            </tr>
            <tr v-if="!graveRows.length">
              <td :colspan="columns.length + 5" class="empty-state">暂无元数据管理数据，可先登记字段定义</td>
            </tr>
          </tbody>
        </table>

        <footer class="page-foot">
          <span>共 {{ total }} 条元数据管理记录</span>
          <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        </footer>
      </div>

      <aside class="grave-side">
        <template v-if="selected">
          <div class="side-head">
            <div>
              <h3>{{ selected.fieldCode }}</h3>
              <p class="side-sub">字段版本 {{ selected.fieldVersion || '—' }} · {{ selected.graveState }}</p>
            </div>
            <button class="link" type="button" @click="selectedCode = ''">关闭</button>
          </div>

          <dl class="side-grid">
            <div><dt>字段版本</dt><dd>{{ selected.fieldVersion || '—' }}</dd></div>
            <div><dt>当前有效章号</dt><dd>{{ selected.effectiveChapter ? `第 ${selected.effectiveChapter} 章` : '—' }}</dd></div>
            <div><dt>最近发布章号</dt><dd>{{ selected.chapter ? `第 ${selected.chapter} 章` : '—' }}</dd></div>
            <div><dt>状态</dt><dd>{{ selected.status }}</dd></div>
            <div><dt>墓碑</dt><dd>{{ selected.graveState }}</dd></div>
            <div><dt>可引用</dt><dd>{{ selected.citeable ? '可引用' : '不可引用' }}</dd></div>
          </dl>

          <p v-if="selected.graveState === '已失效'" class="hint-text">
            旧的立碑申请已失效（字段章号或字段版本已变更），不影响当前字段，引用仍按当前章号判定。
          </p>
          <p
            v-else-if="selected.grave && !selected.versionMatchesGrave"
            class="error-text"
          >
            墓碑登记于字段版本 {{ selected.grave.fieldVersion }}，当前字段版本 {{ selected.fieldVersion }}，
            回看时请以字段版本为准核对。
          </p>

          <section class="side-block">
            <h4>引用它的血缘边与汇总度量</h4>
            <p v-if="!selected.references.length" class="side-empty">暂无引用，可直接完成立碑。</p>
            <table v-else class="data-table compact">
              <thead>
                <tr><th>来源</th><th>编号</th><th>章号</th><th>换章</th></tr>
              </thead>
              <tbody>
                <tr v-for="ref in selected.references" :key="`${ref.module}-${ref.id}`">
                  <td>{{ ref.module === 'lineage' ? '血缘边' : '汇总度量' }}</td>
                  <td>{{ ref.label }}</td>
                  <td>{{ ref.stamp ? `第 ${ref.stamp} 章` : '—' }}</td>
                  <td>{{ ref.switched ? '已换章' : '待换章' }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="openReference" class="switch-box">
              <label class="filter-item">
                <span>换章目标字段</span>
                <select v-model="replacement">
                  <option value="">解除引用</option>
                  <option v-for="item in replacementOptions" :key="item.fieldCode" :value="item.fieldCode">
                    {{ item.fieldCode }}（第 {{ item.chapter }} 章 / {{ item.fieldVersion }}）
                  </option>
                </select>
              </label>
              <button class="btn primary" type="button" @click="switchOpenReference">提交换章</button>
            </div>
          </section>

          <section class="side-block">
            <h4>墓碑历史</h4>
            <p v-if="!selected.history.length" class="side-empty">暂无墓碑历史。</p>
            <ul v-else class="event-list">
              <li v-for="event in selected.history" :key="event.id">
                <span class="event-type">{{ event.type }}</span>
                <span>{{ event.at }}</span>
                <span>第 {{ event.chapter }} 章 / {{ event.fieldVersion || '—' }}</span>
                <span class="event-note">{{ event.note }}</span>
              </li>
            </ul>
          </section>

          <section class="side-block">
            <h4>旁证（迟到动作）</h4>
            <p v-if="!selected.sideEvidence.length" class="side-empty">暂无旁证。</p>
            <ul v-else class="event-list">
              <li v-for="item in selected.sideEvidence" :key="item.id">
                <span class="event-type">{{ item.action }}</span>
                <span>{{ item.at }}</span>
                <span>期望第 {{ item.expectedStamp }} 章 / 实际第 {{ item.actualStamp }} 章</span>
                <span class="event-note">{{ item.note }}</span>
              </li>
            </ul>
          </section>
        </template>
        <p v-else class="side-empty">
          选择左侧字段查看墓碑视图。侧栏、列表与详情读取同一份章号结论，历史可查、当前引用必须失效。
        </p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  fieldGraveDetail,
  graveSummary,
  listCiteableFields,
  listFieldGraves,
  moduleMeta,
  runAction as applyAction,
  switchReference,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { FieldGraveView, GraveReferenceView } from '@/data/types'

const meta = moduleMeta('schema')
const session = useSessionStore()
const columns = ["字段编号", "所属表名", "字段名称", "字段类型", "可空标识", "默认值", "业务含义", "版本号"]
const actions = ["提交审核", "生效发布", "改章发布", "作废下线"]
const statuses = ["草稿", "待审核", "已生效", "已作废"]

const graveRows = ref<FieldGraveView[]>([])
const summary = ref(graveSummary())
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedCode = ref('')
const selected = ref<FieldGraveView | null>(null)
const replacement = ref('')

const stats = computed(() => [
  { label: '字段定义总数', value: summary.value.fieldTotal },
  { label: '已生效字段', value: summary.value.effectiveFields },
  { label: '待审核字段', value: summary.value.pendingReview },
  { label: '待换章墓碑', value: summary.value.pendingTombs },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: graveRows.value.filter((row) => row.status === status).length,
  })),
)

const openReference = computed(() => {
  const refs = selected.value?.references ?? []
  return refs.find((item) => !item.switched) ?? null
})

const replacementOptions = computed(() => {
  const current = selected.value?.fieldCode ?? ''
  return listCiteableFields().filter((item) => item.fieldCode !== current)
})

function badgeClass(state: FieldGraveView['graveState']) {
  return {
    'badge-draft': state === '未生效',
    'badge-open': state === '未立碑',
    'badge-pending': state === '待换章',
    'badge-sealed': state === '已封碑',
    'badge-retired': state === '已失效',
  }
}

function cellValue(view: FieldGraveView, column: string) {
  return view.cells[column] ?? '—'
}

function fieldId(fieldCode: string): number {
  const row = graveRows.value.find((item) => item.fieldCode === fieldCode)
  return Number(row?.cells.id ?? 0)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '字段定义登记入口尚未接入审批流'
}

function selectField(view: FieldGraveView) {
  selectedCode.value = view.fieldCode
  selected.value = fieldGraveDetail(view.fieldCode)
}

function refreshSelected() {
  if (!selectedCode.value) {
    selected.value = null
    return
  }
  selected.value = fieldGraveDetail(selectedCode.value)
}

function runFieldAction(action: string, view: FieldGraveView) {
  errorMessage.value = ''
  // 动作携带当前行展示的章号与字段版本；库里的值已经变化时，服务层按迟到动作只写旁证。
  const result = applyAction(meta.key, fieldId(view.fieldCode), action, {
    expectedChapter: view.chapter,
    expectedVersion: view.fieldVersion,
    operator: session.operator,
  })
  if (!result.ok) {
    errorMessage.value = result.message
  }
  selectedCode.value = view.fieldCode
  reload()
  refreshSelected()
}

function switchOpenReference() {
  const ref = openReference.value
  if (!ref) {
    errorMessage.value = '当前没有待换章的引用'
    return
  }
  errorMessage.value = ''
  const result = switchReference(ref.module, ref.id, {
    replacement: replacement.value || undefined,
    expectedChapter: ref.stamp,
    operator: session.operator,
  })
  if (!result.ok) {
    errorMessage.value = result.message
  }
  replacement.value = ''
  reload()
  refreshSelected()
}

function reload() {
  errorMessage.value = ''
  try {
    graveRows.value = listFieldGraves(filters.value)
    summary.value = graveSummary()
    total.value = graveRows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '元数据管理列表读取失败'
  }
}

onMounted(reload)

watch(
  () => selectedCode.value,
  () => refreshSelected(),
)
</script>

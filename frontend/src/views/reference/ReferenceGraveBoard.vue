<template>
  <section class="page" :data-module="moduleKey">
    <header class="page-head">
      <div>
        <h2>{{ title }}</h2>
        <p class="page-desc">{{ desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记{{ entity }}</button>
        <button class="btn" type="button" @click="exportRows">导出{{ title }}清单</button>
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
      <span class="legend-item">失效引用：{{ invalidCount }}</span>
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
              <th>字段有效章号</th>
              <th>引用结论</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in views"
              :key="item.id"
              :class="{ 'row-selected': selectedId === item.id }"
              @click="select(item.id)"
            >
              <td v-for="column in columns" :key="column">{{ cellValue(item, column) }}</td>
              <td>{{ item.status }}</td>
              <td>{{ item.fieldChapter ? `第 ${item.fieldChapter} 章` : '—' }}</td>
              <td>
                <span class="badge" :class="item.valid ? 'badge-open' : 'badge-sealed'">
                  {{ item.valid ? '引用有效' : '引用失效' }}
                </span>
                <span v-if="!item.valid" class="reason-text">{{ item.reason }}</span>
              </td>
              <td class="row-actions" @click.stop>
                <button
                  v-for="action in actions"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runRefAction(action, item)"
                >
                  {{ action }}
                </button>
                <button
                  v-if="item.fieldCode"
                  class="link"
                  type="button"
                  @click="select(item.id)"
                >
                  换章
                </button>
              </td>
            </tr>
            <tr v-if="!views.length">
              <td :colspan="columns.length + 4" class="empty-state">暂无{{ title }}数据，可先登记{{ entity }}</td>
            </tr>
          </tbody>
        </table>

        <footer class="page-foot">
          <span>共 {{ total }} 条{{ title }}记录</span>
          <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        </footer>
      </div>

      <aside class="grave-side">
        <template v-if="selected">
          <div class="side-head">
            <div>
              <h3>{{ selected.label }}</h3>
              <p class="side-sub">{{ moduleKey === 'lineage' ? '血缘边' : '汇总度量' }} · {{ selected.status }}</p>
            </div>
            <button class="link" type="button" @click="selectedId = 0">关闭</button>
          </div>

          <dl class="side-grid">
            <div><dt>引用字段</dt><dd>{{ selected.fieldCode || '—' }}</dd></div>
            <div><dt>引用章号</dt><dd>{{ selected.referenceStamp ? `第 ${selected.referenceStamp} 章` : '—' }}</dd></div>
            <div><dt>字段状态</dt><dd>{{ selected.fieldStatus }}</dd></div>
            <div><dt>字段版本</dt><dd>{{ selected.fieldVersion || '—' }}</dd></div>
            <div><dt>字段有效章号</dt><dd>{{ selected.fieldChapter ? `第 ${selected.fieldChapter} 章` : '—' }}</dd></div>
            <div><dt>墓碑</dt><dd>{{ selected.graveState }}</dd></div>
          </dl>

          <p v-if="!selected.valid" class="error-text">
            {{ selected.reason }}。字段定义与墓碑结论以元数据管理为准，这里不重复判定。
          </p>

          <section class="side-block">
            <h4>换章 / 解除引用</h4>
            <label class="filter-item">
              <span>替换为已生效字段</span>
              <select v-model="replacement">
                <option value="">解除引用</option>
                <option v-for="item in replacementOptions" :key="item.fieldCode" :value="item.fieldCode">
                  {{ item.fieldCode }}（第 {{ item.effectiveChapter }} 章 / {{ item.fieldVersion }}）
                </option>
              </select>
            </label>
            <button class="btn primary" type="button" @click="applySwitch">提交换章</button>
          </section>

          <section class="side-block">
            <h4>字段墓碑历史（只读）</h4>
            <p v-if="!fieldView || !fieldView.history.length" class="side-empty">该字段暂无墓碑历史。</p>
            <ul v-else class="event-list">
              <li v-for="event in fieldView.history" :key="event.id">
                <span class="event-type">{{ event.type }}</span>
                <span>{{ event.at }}</span>
                <span>第 {{ event.chapter }} 章 / {{ event.fieldVersion || '—' }}</span>
                <span class="event-note">{{ event.note }}</span>
              </li>
            </ul>
          </section>
        </template>
        <p v-else class="side-empty">
          选择左侧记录查看引用视图。引用是否有效只读取元数据管理中的字段定义与墓碑，不在这里另算一套。
        </p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  fieldGraveDetail,
  listCiteableFields,
  listReferenceGraves,
  moduleMeta,
  runAction,
  switchReference,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { FieldGraveView, ReferenceGraveView } from '@/data/types'

const props = defineProps<{ moduleKey: 'lineage' | 'dws' }>()

const meta = moduleMeta(props.moduleKey)
const session = useSessionStore()
const title = `${meta.name}管理`
const desc = `${meta.desc} 字段定义以元数据管理为主对象，本页只登记引用并读取统一墓碑视图。`
const entity = meta.entity
const columns = meta.fields.filter((field) => field !== '引用字段' && field !== '引用章号')
const filterFields = columns.slice(0, 3)
const actions = meta.actions

const views = ref<ReferenceGraveView[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const selectedId = ref(0)
const selected = ref<ReferenceGraveView | null>(null)
const fieldView = ref<FieldGraveView | null>(null)
const replacement = ref('')

const invalidCount = computed(() => views.value.filter((item) => !item.valid).length)

const stats = computed(() => {
  const active = meta.statuses[2] ?? ''
  const pending = meta.statuses[1] ?? ''
  return [
    { label: meta.metrics[0] ?? '总数', value: views.value.length },
    { label: meta.metrics[1] ?? active, value: views.value.filter((item) => item.status === active).length },
    { label: meta.metrics[2] ?? pending, value: views.value.filter((item) => item.status === pending).length },
    { label: '失效引用', value: invalidCount.value },
  ]
})

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: views.value.filter((row) => row.status === status).length,
  })),
)

const replacementOptions = computed(() => {
  const current = selected.value?.fieldCode ?? ''
  return listCiteableFields().filter((item) => item.fieldCode !== current)
})

function cellValue(item: ReferenceGraveView, column: string) {
  if (column === '引用字段') {
    return item.fieldCode || '—'
  }
  if (column === '引用章号') {
    return item.referenceStamp ? `第 ${item.referenceStamp} 章` : '—'
  }
  return item.cells[column] ?? '—'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = `${entity}登记入口尚未接入审批流`
}

function select(id: number) {
  selectedId.value = id
  refreshSelected()
}

function refreshSelected() {
  if (!selectedId.value) {
    selected.value = null
    fieldView.value = null
    return
  }
  selected.value = views.value.find((item) => item.id === selectedId.value) ?? null
  fieldView.value = selected.value?.fieldCode
    ? fieldGraveDetail(selected.value.fieldCode)
    : null
}

function runRefAction(action: string, item: ReferenceGraveView) {
  errorMessage.value = ''
  const result = runAction(meta.key, item.id, action, { operator: session.operator })
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function applySwitch() {
  if (!selected.value) {
    return
  }
  errorMessage.value = ''
  const result = switchReference(props.moduleKey, selected.value.id, {
    replacement: replacement.value || undefined,
    expectedChapter: selected.value.referenceStamp,
    operator: session.operator,
  })
  if (!result.ok) {
    errorMessage.value = result.message
  }
  replacement.value = ''
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    views.value = listReferenceGraves(props.moduleKey, filters.value)
    total.value = views.value.length
    refreshSelected()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${title}列表读取失败`
  }
}

onMounted(reload)
</script>

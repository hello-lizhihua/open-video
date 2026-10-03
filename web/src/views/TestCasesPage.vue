<template>
  <section class="page test-cases-page">
    <div class="page-head">
      <div class="page-head-left">
        <h2 class="page-title">测试用例</h2>
        <span class="muted">由用户逐步确认与完善，随时间推移越来越可靠</span>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建用例</el-button>
    </div>

    <div class="cases-layout">
      <aside class="group-side">
        <div class="side-head">
          <span class="side-title">测试组</span>
          <el-button link type="primary" size="small" @click="createGroup">新建</el-button>
        </div>
        <div class="side-list">
          <div
            v-for="row in groupRows"
            :key="row.name"
            class="side-item"
            :class="{ active: row.name === selectedGroup }"
            @click="selectGroup(row.name)"
          >
            <span class="side-name">{{ row.name }}</span>
            <span class="side-count">{{ row.count }}</span>
            <span class="side-actions" @click.stop>
              <el-button
                v-if="row.name !== '全部' && row.name !== '未分组'"
                link
                type="primary"
                size="small"
                :disabled="runningGroups[row.name]"
                @click="runGroup(row.name)"
              >
                {{ runningGroups[row.name] ? '执行中' : '运行' }}
              </el-button>
              <el-button
                v-if="row.name !== '全部' && row.name !== '未分组'"
                link
                size="small"
                @click="renameGroup(row.name)"
              >
                改名
              </el-button>
              <el-button
                v-if="row.name !== '全部' && row.name !== '未分组'"
                link
                type="danger"
                size="small"
                @click="removeGroup(row.name)"
              >
                删除
              </el-button>
            </span>
          </div>
        </div>
      </aside>

      <div class="cases-main">
        <div class="table-wrap">
          <el-table :data="pagedCases" row-key="id" height="100%">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="result-inner">
                  <p v-if="!lastRun(row)" class="muted">还没有执行结果，点「执行」生成前后对照。</p>
                  <template v-else>
                    <p class="muted">
                      执行于 {{ lastRun(row).at }} · 耗时 {{ lastRun(row).seconds }}s
                      <el-tag v-if="lastRun(row).error" type="danger" size="small" class="run-error">
                        执行出错：{{ lastRun(row).error }}
                      </el-tag>
                    </p>
                    <div class="result-columns">
                      <div class="result-col">
                        <h4 class="result-title">使用前（无截断 / 无词汇表）</h4>
                        <pre class="result-doc">{{ lastRun(row).before?.document || '—' }}</pre>
                      </div>
                      <div class="result-col">
                        <h4 class="result-title">使用后（按配置截断{{ lastRun(row).after && rowConfig(row).useGlossary !== false ? ' + 词汇表' : '' }}）</h4>
                        <pre class="result-doc">{{ lastRun(row).after?.document || '—' }}</pre>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="标题" min-width="220">
              <template #default="{ row }">
                <span :class="{ done: row.status === 'pass' }">{{ row.title }}</span>
                <div class="muted config-line">配置：{{ configSummary(row) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="预期" min-width="280">
              <template #default="{ row }">
                <span class="expected">{{ row.expected || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="240">
              <template #default="{ row }">
                <el-button
                  link
                  type="primary"
                  size="small"
                  :disabled="runningCases[row.id]"
                  @click="runCase(row)"
                >
                  {{ runningCases[row.id] ? '执行中…' : '执行' }}
                </el-button>
                <el-button link type="success" size="small" :disabled="row.status === 'pass'" @click="setStatus(row, 'pass')">
                  通过
                </el-button>
                <el-button link type="warning" size="small" :disabled="row.status === 'fail'" @click="setStatus(row, 'fail')">
                  失败
                </el-button>
                <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
                <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="empty">这个测试组还没有用例。</div>
            </template>
          </el-table>
        </div>

        <div class="pagination-bar">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="filteredCases.length"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            background
          />
        </div>
      </div>
    </div>

    <el-drawer
      v-model="editorOpen"
      :title="editingId ? '编辑用例' : '新建用例'"
      size="480px"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="例如:裁剪起点生效(BV… 前 60 秒)" />
        </el-form-item>
        <el-form-item label="测试组（同一组整合多个时间段一起验证）">
          <el-select
            v-model="form.group_name"
            filterable
            allow-create
            clearable
            default-first-option
            placeholder="选择或输入测试组"
            style="width: 100%"
          >
            <el-option v-for="name in selectableGroupNames" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联视频">
          <el-select v-model="form.video_id" filterable placeholder="选择视频" style="width: 100%">
            <el-option v-for="video in videoOptions" :key="video.id" :label="`${video.id} · ${video.label.slice(0, 24)}`" :value="video.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="执行配置">
          <div class="config-form">
            <el-input-number v-model="form.config.start" :min="0" :step="1" placeholder="开始(秒)" />
            <span class="muted">开始(秒)</span>
            <el-input-number v-model="form.config.duration" :min="5" :step="5" placeholder="时长(秒)" />
            <span class="muted">截取时长(秒)</span>
            <el-input-number v-model="form.config.numSpeakers" :min="0" :max="8" :step="1" />
            <span class="muted">说话人数(0=自动)</span>
            <el-checkbox v-model="form.config.useGlossary">使用后变体应用词汇表</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="预期（使用后应满足什么）">
          <el-input v-model="form.expected" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="步骤（每行一步）">
          <el-input v-model="form.steps" type="textarea" :rows="6" />
        </el-form-item>
      </el-form>
      <el-button type="primary" @click="save">保存</el-button>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { request } from '../api.js'

const cases = ref([])
const groups = ref([])
const selectedGroup = ref('全部')
const page = ref(1)
const pageSize = ref(10)
const editorOpen = ref(false)
const editingId = ref(null)
const runningCases = ref({})
const runningGroups = ref({})
const videoOptions = ref([])
const form = ref(defaultForm())

function defaultForm() {
  return {
    title: '',
    group_name: '',
    video_id: null,
    expected: '',
    steps: '',
    config: { start: 0, duration: 60, numSpeakers: 2, useGlossary: true },
  }
}

// 左侧测试组树:全部 + 各组 + 未分组
const groupRows = computed(() => {
  const ungrouped = cases.value.filter((row) => !row.group_name).length
  const rows = [{ name: '全部', count: cases.value.length }]
  for (const group of groups.value) rows.push({ ...group })
  if (ungrouped > 0) rows.push({ name: '未分组', count: ungrouped })
  return rows
})

const filteredCases = computed(() => {
  if (selectedGroup.value === '全部') return cases.value
  if (selectedGroup.value === '未分组') return cases.value.filter((row) => !row.group_name)
  return cases.value.filter((row) => row.group_name === selectedGroup.value)
})

const selectableGroupNames = computed(() =>
  groupRows.value
    .filter((row) => row.name !== '全部' && row.name !== '未分组')
    .map((row) => row.name),
)

const pagedCases = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredCases.value.slice(start, start + pageSize.value)
})

function selectGroup(name) {
  selectedGroup.value = name
  page.value = 1
}

function rowConfig(row) {
  try {
    return JSON.parse(row.config || '{}')
  } catch {
    return {}
  }
}

function configSummary(row) {
  const config = rowConfig(row)
  return `从 ${config.start ?? 0}s 截 ${config.duration ?? 60}s · ${config.numSpeakers || '自动'}人 · ${config.useGlossary !== false ? '用词汇表' : '不用词汇表'}`
}

function lastRun(row) {
  try {
    return JSON.parse(row.last_run || 'null')
  } catch {
    return null
  }
}

async function runCase(row) {
  runningCases.value[row.id] = true
  try {
    await request(`/api/test-cases/${row.id}/run`, { method: 'POST' })
    ElMessage.success('已开始执行，转写完成后结果自动填充')
    const startedAt = Date.now() - 2000
    const timer = setInterval(async () => {
      await refresh()
      const run = lastRun(cases.value.find((c) => c.id === row.id) || {})
      const at = run && run.at ? new Date(run.at.replace(' ', 'T')).getTime() : 0
      if (!Number.isNaN(at) && at >= startedAt) {
        clearInterval(timer)
        delete runningCases.value[row.id]
        ElMessage.success('执行完成，请在展开区对照前后结果')
      }
    }, 3000)
  } catch (err) {
    delete runningCases.value[row.id]
    ElMessage.error(err.message)
  }
}

async function runGroup(name) {
  runningGroups.value[name] = true
  // 本轮开始的时刻(留 2 秒时钟余量);晚于它的执行结果才算本轮产出
  const startedAt = Date.now() - 2000
  try {
    // 整组重跑即重新验证:组成员状态先重置为待确认
    for (const member of cases.value.filter((row) => row.group_name === name)) {
      await request(`/api/test-cases/${member.id}`, { method: 'PUT', body: JSON.stringify({ status: 'pending' }) })
    }
    await request('/api/test-case-groups/run', { method: 'POST', body: JSON.stringify({ group: name }) })
    const count = (groups.value.find((row) => row.name === name) || {}).count || 0
    ElMessage.success(`测试组「${name}」已开始执行，共 ${count} 个用例`)
    const timer = setInterval(async () => {
      await refresh()
      const members = cases.value.filter((row) => row.group_name === name)
      const allDone = members.length > 0 && members.every((row) => {
        const run = lastRun(row)
        if (!run || !run.at) return false
        const at = new Date(run.at.replace(' ', 'T')).getTime()
        return !Number.isNaN(at) && at >= startedAt
      })
      if (allDone) {
        clearInterval(timer)
        delete runningGroups.value[name]
        ElMessage.success('整组执行完成，请在展开区对照前后结果')
      }
    }, 5000)
  } catch (err) {
    delete runningGroups.value[name]
    ElMessage.error(err.message)
  }
}

async function loadVideoOptions() {
  try {
    const data = await request('/api/videos-index')
    videoOptions.value = data.videos || []
  } catch {
    videoOptions.value = []
  }
}

async function refresh() {
  const data = await request('/api/test-cases')
  cases.value = (data.cases || []).map((row) => ({
    ...row,
    config: typeof row.config === 'string' ? row.config : JSON.stringify(row.config || {}),
  }))
  groups.value = data.groups || []
  const maxPage = Math.max(1, Math.ceil(filteredCases.value.length / pageSize.value))
  if (page.value > maxPage) page.value = maxPage
}

async function createGroup() {
  try {
    const { value } = await ElMessageBox.prompt('输入测试组名称', '新建测试组', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '测试组名不能为空',
    })
    await request('/api/test-case-groups', { method: 'POST', body: JSON.stringify({ name: value.trim() }) })
    ElMessage.success('测试组已创建')
    await refresh()
  } catch {
    // 用户取消
  }
}

async function renameGroup(name) {
  try {
    const { value } = await ElMessageBox.prompt('输入新的测试组名称', '测试组改名', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: name,
      inputPattern: /\S+/,
      inputErrorMessage: '测试组名不能为空',
    })
    await request(`/api/test-case-groups/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: value.trim() }),
    })
    if (selectedGroup.value === name) selectedGroup.value = value.trim()
    ElMessage.success('已改名')
    await refresh()
  } catch {
    // 用户取消
  }
}

async function removeGroup(name) {
  try {
    await ElMessageBox.confirm(`删除测试组「${name}」？组内用例会变为未分组。`, '删除测试组', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  await request(`/api/test-case-groups/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (selectedGroup.value === name) selectedGroup.value = '全部'
  ElMessage.success('已删除测试组')
  await refresh()
}

function openCreate() {
  editingId.value = null
  form.value = {
    ...defaultForm(),
    group_name: selectedGroup.value !== '全部' && selectedGroup.value !== '未分组' ? selectedGroup.value : '',
  }
  loadVideoOptions()
  editorOpen.value = true
}

function openEdit(row) {
  editingId.value = row.id
  form.value = {
    title: row.title,
    group_name: row.group_name || '',
    video_id: row.video_id,
    expected: row.expected,
    steps: row.steps,
    config: rowConfig(row),
  }
  loadVideoOptions()
  editorOpen.value = true
}

async function save() {
  if (!form.value.title.trim()) {
    ElMessage.warning('标题不能为空')
    return
  }
  const payload = { ...form.value }
  if (editingId.value) {
    await request(`/api/test-cases/${editingId.value}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  } else {
    await request('/api/test-cases', { method: 'POST', body: JSON.stringify(payload) })
  }
  editorOpen.value = false
  ElMessage.success('已保存')
  await refresh()
}

async function setStatus(row, status) {
  await request(`/api/test-cases/${row.id}`, { method: 'PUT', body: JSON.stringify({ status }) })
  await refresh()
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`删除用例「${row.title}」？`, '删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  await request(`/api/test-cases/${row.id}`, { method: 'DELETE' })
  ElMessage.success('已删除')
  await refresh()
}

function statusLabel(status) {
  return { pending: '待确认', pass: '通过', fail: '失败' }[status] || status
}

function statusType(status) {
  return { pending: 'info', pass: 'success', fail: 'danger' }[status] || 'info'
}

onMounted(() => {
  refresh()
  loadVideoOptions()
})
</script>

<style scoped>
.cases-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
  align-items: stretch;
}

.group-side {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: #fafbfc;
}

.side-title {
  font-size: 13px;
  font-weight: 600;
}

.side-list {
  overflow: auto;
}

.side-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: 13px;
}

.side-item:hover {
  background: #f5f7fa;
}

.side-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.side-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side-count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.side-actions {
  display: none;
  flex-shrink: 0;
}

.side-item:hover .side-actions {
  display: inline-flex;
}

.side-actions .el-button + .el-button {
  margin-left: 2px;
}

.cases-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.done {
  text-decoration: line-through;
  color: var(--el-color-info);
}

.config-line {
  margin-top: 4px;
  font-size: 12px;
}

.expected {
  font-size: 13px;
  line-height: 1.6;
}

.result-inner {
  padding: 4px 16px 12px 24px;
}

.result-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.result-title {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.result-doc {
  margin: 0;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 420px;
  overflow: auto;
  background: #fafbfc;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 10px 12px;
}

.run-error {
  margin-left: 8px;
}

.config-form {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>

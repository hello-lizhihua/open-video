<template>
  <div class="glossary-manager">
    <aside class="glossary-side">
      <div class="side-head">
        <span class="side-title">分类</span>
        <el-button v-if="isGlobal" link type="primary" size="small" @click="createCategory">新建</el-button>
      </div>
      <div class="side-list">
        <div
          v-for="cat in categoryRows"
          :key="cat.name"
          class="side-item"
          :class="{ active: cat.name === selected }"
          @click="selected = cat.name"
        >
          <span class="side-name">{{ cat.name }}</span>
          <span class="side-count">{{ cat.count }}</span>
          <span v-if="cat.name !== '全部'" class="side-actions" @click.stop>
            <el-button link size="small" @click="renameCategory(cat.name)">改名</el-button>
            <el-button link type="danger" size="small" @click="removeCategory(cat.name)">删除</el-button>
          </span>
        </div>
      </div>
    </aside>

    <div class="glossary-main">
      <div class="main-head">
        <span class="muted main-hint">带「误识别词」的词条在文本中自动替换，多个写法用 | 分隔</span>
        <el-button type="primary" size="small" :icon="Plus" @click="openCreate">新建词条</el-button>
      </div>
      <el-table :data="visibleEntries" size="small" class="main-table" :row-key="(row) => `${row.scope}-${row.id}`">
        <el-table-column label="词条" min-width="140">
          <template #default="{ row }">
            <span class="term">{{ row.term }}</span>
            <el-tag v-if="row.scope === 'global'" size="small" effect="plain" class="system-tag">系统</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="误识别词" min-width="150">
          <template #default="{ row }">
            <span :class="{ missing: !row.misread }">{{ row.misread || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="{ missing: !row.note }">{{ row.note || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <template v-if="row.scope !== 'global'">
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="removeEntry(row)">删除</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty">这个分类还没有词条。</div>
        </template>
      </el-table>
    </div>

    <el-dialog v-model="editorOpen" :title="editingId ? '编辑词条' : '新建词条'" width="440px" :close-on-click-modal="false" append-to-body>
      <el-form label-position="top">
        <el-form-item label="分类">
          <el-select v-model="form.category" filterable allow-create clearable default-first-option placeholder="选择或输入分类" style="width: 100%">
            <el-option v-for="name in categoryNames" :key="name" :label="name" :value="name" />
          </el-select>
        </el-form-item>
        <el-form-item label="词条（正确写法）">
          <el-input v-model="form.term" placeholder="例如:Work Buddy" />
        </el-form-item>
        <el-form-item label="误识别词（可选，多个用 | 分隔）">
          <el-input v-model="form.misread" placeholder="例如:work bud|work body" />
        </el-form-item>
        <el-form-item label="说明（可选）">
          <el-input v-model="form.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editorOpen = false">取消</el-button>
        <el-button type="primary" @click="saveEntry">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { request } from '../api.js'

// 全局级(videoId 为空)与视频级共用:左分类右表格,分类与词条都支持增删改。
// 视频级没有独立分类表,分类由词条聚合;新建分类通过词条表单的分类下拉输入。
const props = defineProps({
  videoId: { type: Number, default: null },
})

const isGlobal = computed(() => props.videoId === null)
const entries = ref([])
const globalCategories = ref([])
const selected = ref('全部')
const editorOpen = ref(false)
const editingId = ref(null)
const form = ref({ category: '', term: '', misread: '', note: '' })

const categoryNames = computed(() =>
  categoryRows.value.filter((row) => row.name !== '全部').map((row) => row.name),
)

const categoryRows = computed(() => {
  const counts = new Map()
  for (const entry of entries.value) {
    const name = entry.category || '未分类'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  for (const cat of globalCategories.value) {
    if (!counts.has(cat.name)) counts.set(cat.name, 0)
  }
  const rows = [{ name: '全部', count: entries.value.length }]
  for (const [name, count] of counts) rows.push({ name, count })
  return rows
})

const visibleEntries = computed(() => {
  if (selected.value === '全部') return entries.value
  if (selected.value === '未分类') return entries.value.filter((entry) => !entry.category)
  return entries.value.filter((entry) => entry.category === selected.value)
})

async function refresh() {
  if (isGlobal.value) {
    const data = await request('/api/glossaries/global')
    entries.value = (data.glossaries || []).map((row) => ({
      ...row,
      category: row.category || '',
      scope: 'global',
    }))
    globalCategories.value = data.categories || []
  } else {
    // 继承展示:全局词条只读(标「系统」),视频词条可增删改
    const [videoData, globalData] = await Promise.all([
      request(`/api/videos/${props.videoId}/glossaries`),
      request('/api/glossaries/global'),
    ])
    entries.value = [
      ...(globalData.glossaries || []).map((row) => ({
        ...row,
        category: row.category || '',
        scope: 'global',
      })),
      ...(videoData.glossaries || []).map((row) => ({
        ...row,
        category: row.category || '',
        scope: 'video',
      })),
    ]
    globalCategories.value = globalData.categories || []
  }
  // 当前分类被清空时回到全部
  if (selected.value !== '全部' && !categoryRows.value.some((row) => row.name === selected.value)) {
    selected.value = '全部'
  }
}

function openCreate() {
  editingId.value = null
  form.value = {
    category: selected.value === '全部' || selected.value === '未分类' ? '' : selected.value,
    term: '',
    misread: '',
    note: '',
  }
  editorOpen.value = true
}

function openEdit(entry) {
  if (!isGlobal.value && entry.scope === 'global') return
  editingId.value = entry.id
  form.value = {
    category: entry.category || '',
    term: entry.term,
    misread: entry.misread || '',
    note: entry.note || '',
  }
  editorOpen.value = true
}

async function saveEntry() {
  if (!form.value.term.trim()) {
    ElMessage.warning('词条不能为空')
    return
  }
  const payload = { ...form.value, term: form.value.term.trim() }
  try {
    await submitEntry(payload)
    editorOpen.value = false
    ElMessage.success('已保存')
    await refresh()
  } catch (err) {
    ElMessage.error(err.message)
  }
}

async function submitEntry(payload) {
  if (isGlobal.value) {
    if (editingId.value) {
      await request(`/api/glossaries/global/${editingId.value}`, { method: 'PUT', body: JSON.stringify(payload) })
    } else {
      await request('/api/glossaries/global', { method: 'POST', body: JSON.stringify(payload) })
    }
  } else if (editingId.value) {
    await request(`/api/videos/${props.videoId}/glossaries/${editingId.value}`, { method: 'PUT', body: JSON.stringify(payload) })
  } else {
    await request(`/api/videos/${props.videoId}/glossaries`, { method: 'POST', body: JSON.stringify(payload) })
  }
}

async function removeEntry(entry) {
  if (!isGlobal.value && entry.scope === 'global') return
  try {
    await ElMessageBox.confirm(`删除词条「${entry.term}」？`, '删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const path = isGlobal.value
    ? `/api/glossaries/global/${entry.id}`
    : `/api/videos/${props.videoId}/glossaries/${entry.id}`
  await request(path, { method: 'DELETE' })
  ElMessage.success('已删除')
  await refresh()
}

async function createCategory() {
  try {
    const { value } = await ElMessageBox.prompt('输入分类名称', '新建分类', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '分类名不能为空',
    })
    await request('/api/glossary-categories', { method: 'POST', body: JSON.stringify({ name: value.trim() }) })
    ElMessage.success('分类已创建')
    await refresh()
  } catch {
    // 用户取消
  }
}

async function renameCategory(name) {
  try {
    const { value } = await ElMessageBox.prompt('输入新的分类名称', '分类改名', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: name,
      inputPattern: /\S+/,
      inputErrorMessage: '分类名不能为空',
    })
    const path = isGlobal.value
      ? `/api/glossary-categories/${encodeURIComponent(name)}`
      : `/api/videos/${props.videoId}/glossary-categories/${encodeURIComponent(name)}`
    await request(path, { method: 'PUT', body: JSON.stringify({ name: value.trim() }) })
    if (selected.value === name) selected.value = value.trim()
    ElMessage.success('已改名')
    await refresh()
  } catch {
    // 用户取消
  }
}

async function removeCategory(name) {
  try {
    await ElMessageBox.confirm(`删除分类「${name}」？分类下的词条会变为未分类。`, '删除分类', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const path = isGlobal.value
    ? `/api/glossary-categories/${encodeURIComponent(name)}`
    : `/api/videos/${props.videoId}/glossary-categories/${encodeURIComponent(name)}`
  await request(path, { method: 'DELETE' })
  ElMessage.success('已删除分类')
  await refresh()
}

onMounted(refresh)
</script>

<style scoped>
.glossary-manager {
  display: flex;
  gap: 14px;
  align-items: stretch;
  min-height: 320px;
}

.glossary-side {
  width: 168px;
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

.glossary-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.main-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.main-hint {
  font-size: 12px;
}

.main-table {
  width: 100%;
}

.term {
  font-weight: 500;
}

.system-tag {
  margin-left: 6px;
}

.missing {
  color: var(--el-text-color-placeholder);
}
</style>

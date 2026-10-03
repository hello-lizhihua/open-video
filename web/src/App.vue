<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="topbar-brand" @click="onNavCommand('/projects')">视频转文本</div>
      <el-menu
        class="topbar-menu"
        mode="horizontal"
        :default-active="activeNav"
        :ellipsis="false"
        router
      >
        <el-sub-menu index="video-center">
          <template #title>视频文本中心</template>
          <el-menu-item index="/projects">视频文本</el-menu-item>
          <el-menu-item index="/test-cases">测试用例</el-menu-item>
          <el-menu-item index="/glossary">词汇表</el-menu-item>
        </el-sub-menu>
      </el-menu>
      <div class="topbar-spacer"></div>
    </header>

    <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-tree-head">
        <span class="sidebar-tree-title">项目</span>
        <el-button :icon="Plus" size="small" text @click="onCreateProject">新建</el-button>
      </div>

      <el-tree
        :data="treeData"
        node-key="id"
        :props="{ label: 'name' }"
        :current-node-key="currentProjectId"
        highlight-current
        :expand-on-click-node="false"
        @node-click="onNodeClick"
      >
        <template #default="{ data }">
          <div class="tree-node" :class="{ active: data.id === currentProjectId }">
            <span class="tree-node-label">{{ data.name }}</span>
            <span class="tree-node-actions" @click.stop>
              <el-icon class="tree-action" title="重命名" @click="renameProject(data)"><EditPen /></el-icon>
              <el-icon class="tree-action danger" title="删除" @click="removeProject(data)"><Delete /></el-icon>
            </span>
          </div>
        </template>
      </el-tree>

      <div class="sidebar-foot">
        <el-button :icon="Setting" size="small" text @click="openSettings">设置</el-button>
      </div>
    </aside>

    <main class="content">
      <router-view :key="route.fullPath" />
    </main>

    <!-- 设置抽屉：哔哩哔哩登录凭证 -->
    <el-drawer v-model="settingsOpen" title="设置" size="420px">
      <div class="settings-block">
        <h4 class="settings-heading">外观（皮肤）</h4>
        <el-segmented v-model="skin" :options="skinOptions" style="width: 100%" />
        <p class="muted" style="margin: 8px 0 16px">明亮蓝为克莱因蓝色基调，清新粉为哔哩哔哩粉色基调；各含浅色与深色。</p>
        <h4 class="settings-heading">哔哩哔哩登录凭证（可选）</h4>
        <p class="muted">
          粘贴 cookies.txt 全文或仅 SESSDATA=xxx，可下载会员音质；仅存本机，不回显原文。
        </p>
        <el-input
          v-model="cookieInput"
          type="textarea"
          :rows="4"
          placeholder="# Netscape HTTP Cookie File … 或 SESSDATA=xxx"
        />
        <div class="settings-actions">
          <el-button type="primary" size="small" :disabled="!cookieInput" @click="saveCookie">
            保存凭证
          </el-button>
          <el-button v-if="cookieMask" size="small" type="danger" plain @click="clearCookie">
            清除已存凭证
          </el-button>
        </div>
        <p v-if="cookieMask" class="muted">已设置：{{ cookieMask }}</p>
      </div>
    </el-drawer>
  </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Setting, EditPen, Delete } from '@element-plus/icons-vue'
import {
  createProject,
  deleteProject,
  getSettings,
  listProjects,
  saveSettings,
  updateProject,
} from './api.js'

const route = useRoute()
const router = useRouter()

const projects = ref([])
const settingsOpen = ref(false)
// 皮肤状态与四选项来自 skin.js(main.js 入口一次性设置)
import { skin, skinOptions } from './skin.js'
const cookieInput = ref('')
const cookieMask = ref('')

const treeData = computed(() =>
  projects.value.map((project) => ({ id: project.id, name: project.name })),
)

const currentProjectId = computed(() => {
  const id = Number(route.params.id)
  return Number.isFinite(id) ? id : null
})

const activeNav = computed(() => {
  if (route.path.startsWith('/test-cases')) return '/test-cases'
  if (route.path.startsWith('/glossary')) return '/glossary'
  return '/projects'
})

async function refresh() {
  try {
    projects.value = await listProjects()
  } catch (err) {
    ElMessage.error(err.message)
  }
}

function onNodeClick(data) {
  router.push(`/projects/${data.id}`)
}

function onNavCommand(path) {
  router.push(path)
}

async function onCreateProject() {
  try {
    const { value } = await ElMessageBox.prompt('输入项目名称', '新建项目', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    await createProject(value.trim())
    ElMessage.success('项目已创建')
    await refresh()
    // 新建后直接进入该项目
    const created = projects.value.find((project) => project.name === value.trim())
    if (created) router.push(`/projects/${created.id}`)
  } catch {
    // 用户取消
  }
}

async function renameProject(data) {
  try {
    const { value } = await ElMessageBox.prompt('输入新的项目名称', '重命名项目', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: data.name,
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    await updateProject(data.id, value.trim())
    ElMessage.success('已重命名')
    await refresh()
  } catch {
    // 用户取消
  }
}

async function removeProject(data) {
  try {
    await ElMessageBox.confirm(
      `删除项目「${data.name}」及其全部视频与产物？`,
      '删除项目',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await deleteProject(data.id)
    ElMessage.success('已删除')
    if (currentProjectId.value === data.id) router.push('/')
    await refresh()
  } catch (err) {
    ElMessage.error(err.message)
  }
}

async function openSettings() {
  settingsOpen.value = true
  try {
    const data = await getSettings()
    cookieMask.value = data.cookieMask || ''
  } catch {
    cookieMask.value = ''
  }
}

async function saveCookie() {
  try {
    const result = await saveSettings(cookieInput.value)
    if (result.saved) {
      cookieMask.value = result.mask || '已设置'
      cookieInput.value = ''
      ElMessage.success('凭证已保存')
    }
  } catch (err) {
    ElMessage.error(err.message)
  }
}

async function clearCookie() {
  try {
    await saveSettings('')
    cookieMask.value = ''
    cookieInput.value = ''
    ElMessage.success('已清除凭证')
  } catch (err) {
    ElMessage.error(err.message)
  }
}

onMounted(refresh)
watch(() => route.path, refresh)
</script>

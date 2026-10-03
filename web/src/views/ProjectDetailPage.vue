<template>
  <section class="page">
    <div class="page-head">
      <div class="page-head-left">
        <h2 class="page-title">{{ project ? project.name : '' }}</h2>
        <span v-if="project" class="muted">{{ videos.length }} 个视频</span>
      </div>
      <div class="page-head-actions">
        <el-button type="primary" :icon="Plus" @click="openAddDrawer">添加视频</el-button>
        <el-dropdown :disabled="selectedRows.length === 0" @command="onBatchCommand">
          <el-button :disabled="selectedRows.length === 0">
            批量操作（{{ selectedRows.length }}）<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="download">批量下载文本</el-dropdown-item>
              <el-dropdown-item command="delete" divided>批量删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="table-wrap">
      <el-table
        ref="tableRef"
        :data="pagedVideos"
        row-key="id"
        :expand-row-keys="expandedRowKeys"
        height="100%"
        @selection-change="onSelectionChange"
        @expand-change="onExpandChange"
      >
        <el-table-column type="selection" width="42" reserve-selection />
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="expand-inner">
              <p v-if="transcripts[row.id] === undefined" class="muted">加载中…</p>
              <template v-else>
                <div v-if="row.hasAudio" class="audio-line">
                  <audio
                    :ref="(el) => setAudioRef(row.id, el)"
                    class="audio-player"
                    controls
                    preload="none"
                    :src="audioUrl(row.id)"
                  ></audio>
                </div>
                <el-tabs v-model="tabState[row.id]">
                    <el-tab-pane label="原始文本" name="raw">
                      <template v-if="rowTranscript(row) && rowTranscript(row).paragraphs && rowTranscript(row).paragraphs.length">
                        <div class="transcript-segs">
                          <div
                            v-for="para in rowTranscript(row).paragraphs"
                            :key="para.hash"
                            class="transcript-seg paragraph-block"
                          >
                            <div class="paragraph-meta">
                              <el-tag
                                v-if="para.speaker !== null && para.speaker !== undefined"
                                class="speaker-tag"
                                size="small"
                                effect="plain"
                                @click="renameSpeaker(row, para.speaker)"
                              >
                                {{ speakerLabel(row, para.speaker) }}
                              </el-tag>
                              <el-button class="time-link" link type="primary" size="small" @click="seekAudio(row, para.start)">
                                {{ formatTimestamp(para.start) }}
                              </el-button>
                              <span class="paragraph-hash">#{{ para.hash.slice(0, 6) }}</span>
                            </div>
                            <div class="paragraph-content">{{ para.content }}</div>
                          </div>
                        </div>
                      </template>
                      <pre v-else class="transcript-text">{{ rowTranscript(row) ? rowTranscript(row).text : '' }}</pre>
                    </el-tab-pane>
                    <el-tab-pane label="洗稿文本" name="polished">
                      <div class="chapter-bar">
                        <el-button size="small" @click="autoSplitChapters(row)">自动分章</el-button>
                        <el-button size="small" @click="addChapter(row)">添加章节</el-button>
                        <el-button v-if="(rowTranscript(row)?.chapters || []).length" size="small" type="danger" plain @click="clearChapters(row)">清除章节</el-button>
                      </div>
                      <template v-if="rowTranscript(row) && rowTranscript(row).polishedParagraphs && rowTranscript(row).polishedParagraphs.length">
                        <div class="transcript-segs">
                          <template v-for="entry in polishedRows(row)" :key="entry.para ? entry.para.hash : `ch-${entry.ord}`">
                            <div v-if="entry.type === 'chapter'" class="chapter-head">
                              <span class="chapter-title">{{ entry.title }}</span>
                              <el-button link size="small" @click="renameChapter(row, entry.ord)">改名</el-button>
                              <el-button link type="danger" size="small" @click="deleteChapter(row, entry.ord)">删除章节</el-button>
                            </div>
                            <div v-else class="transcript-seg paragraph-block">
                              <div class="paragraph-meta">
                                <el-tag
                                  v-if="entry.para.speaker !== null && entry.para.speaker !== undefined"
                                  class="speaker-tag"
                                  size="small"
                                  effect="plain"
                                  @click="renameSpeaker(row, entry.para.speaker)"
                                >
                                  {{ speakerLabel(row, entry.para.speaker) }}
                                </el-tag>
                                <el-button class="time-link" link type="primary" size="small" @click="seekAudio(row, entry.para.start)">
                                  {{ formatTimestamp(entry.para.start) }}
                                </el-button>
                                <el-tag v-if="entry.para.edited" size="small" type="warning" effect="light">已编辑</el-tag>
                                <span class="paragraph-hash">#{{ entry.para.hash.slice(0, 6) }}</span>
                                <el-button class="paragraph-edit" :icon="EditPen" link size="small" @click="openPolishEdit(row, entry.para)">编辑</el-button>
                              </div>
                              <div class="paragraph-content">{{ entry.para.content || '（本段清洗后为空）' }}</div>
                            </div>
                          </template>
                        </div>
                      </template>
                      <pre v-else class="transcript-text">{{ rowTranscript(row).polished }}</pre>
                    </el-tab-pane>
                </el-tabs>
                <el-button size="small" class="copy-button" @click="copyTranscript(row)">
                  复制{{ (tabState[row.id] || 'raw') === 'raw' ? '原始' : '洗稿' }}全文
                </el-button>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="ID" width="150">
          <template #default="{ row }">
            <a
              v-if="bvId(row)"
              class="id-link"
              :href="row.url"
              target="_blank"
              rel="noreferrer"
            >{{ bvId(row) }}</a>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="标题" min-width="260">
          <template #default="{ row }">
            <div class="title-cell">
              <span class="title-text">{{ displayTitle(row) }}</span>
              <el-button
                class="title-rename"
                :icon="EditPen"
                size="small"
                text
                title="重命名"
                @click="renameTitle(row)"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="170">
          <template #default="{ row }">
            <el-badge is-dot :hidden="!needsConfirm(row)" class="status-badge">
              <el-tag :type="tagType(row.status)" effect="light" size="small">
                {{ statusLabel(row.status) }}
              </el-tag>
            </el-badge>
            <div v-if="needsConfirm(row)" class="muted progress-line">请确认讲述人</div>
            <div v-if="busy(row) && row.progressMessage" class="muted progress-line">
              {{ row.progressMessage }}
            </div>
            <div v-if="row.error" class="error">{{ row.error }}</div>
          </template>
        </el-table-column>
        <el-table-column label="时长" width="110">
          <template #default="{ row }">
            <span class="muted">{{ formatDuration(row.durationSeconds) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDrawer(row, 'text', true)">查看</el-button>
            <el-button link type="primary" @click="openEditDrawer(row)">编辑</el-button>
            <el-button link type="danger" @click="removeVideo(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty">还没有视频，点右上角「添加视频」开始。</div>
        </template>
      </el-table>
    </div>

    <div class="pagination-bar">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="videos.length"
        :page-sizes="[5, 10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
      />
    </div>

    <!-- 编辑抽屉(查看与编辑共用同一套页签) -->
    <el-drawer
      v-model="editOpen"
      :title="editRow ? displayTitle(editRow) : '编辑视频'"
      size="800px"
      :close-on-click-modal="editMaskClosable"
    >
      <template v-if="editRow">
        <div class="edit-tabs-block">
          <el-tabs v-model="editDrawerTab" class="edit-tabs">
            <el-tab-pane label="基础" name="basic" />
            <el-tab-pane label="校准讲述人" name="calibrate" />
            <el-tab-pane label="文本" name="text" />
            <el-tab-pane label="词汇表" name="glossary" />
            <el-tab-pane label="设置" name="settings" />
          </el-tabs>

          <div v-if="editDrawerTab === 'basic'">
            <div class="meta-row">
              <a
                v-if="bvId(editRow)"
                class="id-link"
                :href="editRow.url"
                target="_blank"
                rel="noreferrer"
              >{{ bvId(editRow) }}</a>
              <span v-else class="muted">{{ editRow.url }}</span>
              <el-tag :type="tagType(editRow.status)" size="small">{{ statusLabel(editRow.status) }}</el-tag>
              <span v-if="editRow.durationSeconds" class="muted">
                {{ formatDuration(editRow.durationSeconds) }}
              </span>
            </div>
            <p v-if="busy(editRow) && editRow.progressMessage" class="muted">
              {{ editRow.progressMessage }}
            </p>
            <p v-if="editRow.error" class="error">{{ editRow.error }}</p>
            <div class="drawer-actions">
              <el-button size="small" :disabled="busy(editRow)" @click="triggerJobAction(editRow, 'download')">
                下载音频
              </el-button>
              <el-button
                size="small"
                :disabled="busy(editRow) || !editRow.hasAudio"
                @click="triggerJobAction(editRow, 'transcribe')"
              >
                转写文本
              </el-button>
              <el-tooltip
                content="下载音频完成后自动衔接转写，产出文本，一次点击完成全部流程"
                placement="top"
              >
                <el-button
                  size="small"
                  type="primary"
                  :disabled="busy(editRow)"
                  @click="triggerJobAction(editRow, 'pipeline')"
                >
                  一键转写
                </el-button>
              </el-tooltip>
            </div>
            <el-form label-position="top">
              <el-form-item label="显示名称">
                <el-input
                  v-model="editName"
                  :placeholder="editRow.title || editRow.url"
                  clearable
                />
                <div class="muted field-hint">留空则使用抓取到的标题</div>
              </el-form-item>
              <el-form-item label="视频类型">
                <el-radio-group v-model="editVideoType">
                  <el-radio value="live">直播连麦</el-radio>
                  <el-radio value="solo">个人录屏</el-radio>
                  <el-radio value="unknown">未知</el-radio>
                </el-radio-group>
                <div class="muted field-hint">个人录屏跳过说话人分离，更快更准</div>
              </el-form-item>
              <el-form-item label="说话人数">
                <el-select v-model="editNumSpeakers" style="width: 140px" :disabled="editVideoType === 'solo'">
                  <el-option label="自动" :value="0" />
                  <el-option v-for="n in [2, 3, 4, 5, 6, 8]" :key="n" :label="`${n} 人`" :value="n" />
                </el-select>
                <div class="muted field-hint">已知人数时指定，说话人分离更准</div>
              </el-form-item>
            </el-form>
            <el-button type="primary" @click="saveEdit">保存</el-button>
          </div>

          <div v-else-if="editDrawerTab === 'calibrate'">
            <div v-if="editRow.hasAudio" class="audio-line">
              <audio
                :ref="(el) => setCalibrateAudioRef(editRow.id, el)"
                class="audio-player"
                controls
                preload="none"
                :src="audioUrl(editRow.id)"
              ></audio>
            </div>
            <div class="confirm-section">
              <div class="confirm-head">
                <span class="confirm-title">讲述人确认</span>
                <span v-if="sampling" class="muted">声纹采样中…</span>
                <span v-else-if="!voiceSamples.length" class="muted">还没有样本</span>
                <span v-else-if="samplesConfirmedFlag" class="muted">已确认,重新转写后生效</span>
                <el-button v-if="!voiceSamples.length && !sampling" size="small" type="primary" plain @click="resample">
                  开始采样
                </el-button>
                <el-button v-else size="small" link type="primary" @click="resample">重新采样</el-button>
              </div>
              <div v-for="sample in voiceSamples" :key="sample.idx" class="sample-row">
                <span class="sample-idx">声音 {{ sample.idx + 1 }}</span>
                <el-button
                  link
                  type="primary"
                  size="small"
                  @click="playSample(editRow, sample)"
                >
                  试听 {{ formatTimestamp(sample.start) }}
                </el-button>
                <el-input
                  v-model="sampleNames[sample.idx]"
                  size="small"
                  placeholder="这个人是谁？例如 杜雨"
                  style="flex: 1"
                />
              </div>
              <el-button
                v-if="voiceSamples.length"
                size="small"
                type="primary"
                @click="confirmSamples"
              >
                确认讲述人
              </el-button>
              <p class="muted confirm-hint">
                确认后重新转写,系统按这些声音纠正整段视频的讲述人归属。
              </p>
            </div>
          </div>

          <div v-else-if="editDrawerTab === 'text'">
            <p v-if="!editRow.hasTranscript" class="muted">转写完成后，这里可以查看文本。</p>
            <template v-else>
              <p v-if="transcripts[editRow.id] === undefined" class="muted">加载中…</p>
              <template v-else>
                <div class="text-actions">
                  <el-button size="small" @click="copyEditTranscript">复制{{ editTextTab === 'raw' ? '原始' : '洗稿' }}全文</el-button>
                  <el-button size="small" tag="a" :href="artifactUrl(editRow.id, 'txt')" download>下载 txt</el-button>
                  <el-button size="small" tag="a" :href="artifactUrl(editRow.id, 'polished.txt')" download>下载洗稿</el-button>
                  <el-button size="small" tag="a" :href="artifactUrl(editRow.id, 'srt')" download>下载 srt</el-button>
                </div>
                <div v-if="editRow.hasAudio" class="audio-line">
                  <audio
                    :ref="(el) => setEditAudioRef(editRow.id, el)"
                    class="audio-player"
                    controls
                    preload="none"
                    :src="audioUrl(editRow.id)"
                  ></audio>
                </div>
                <el-tabs v-model="editTextTab">
                  <el-tab-pane label="原始文本" name="raw">
                    <template v-if="rowTranscript(editRow).paragraphs && rowTranscript(editRow).paragraphs.length">
                      <div class="transcript-segs drawer-transcript">
                        <div
                          v-for="para in rowTranscript(editRow).paragraphs"
                          :key="para.hash"
                          class="transcript-seg paragraph-block"
                        >
                          <div class="paragraph-meta">
                            <el-tag
                              v-if="para.speaker !== null && para.speaker !== undefined"
                              class="speaker-tag"
                              size="small"
                              effect="plain"
                              @click="renameSpeaker(editRow, para.speaker)"
                            >
                              {{ speakerLabel(editRow, para.speaker) }}
                            </el-tag>
                            <el-button class="time-link" link type="primary" size="small" @click="seekEditAudio(editRow, para.start)">
                              {{ formatTimestamp(para.start) }}
                            </el-button>
                            <span class="paragraph-hash">#{{ para.hash.slice(0, 6) }}</span>
                          </div>
                          <div class="paragraph-content">{{ para.content }}</div>
                        </div>
                      </div>
                    </template>
                    <pre v-else class="transcript-text">{{ rowTranscript(editRow).text }}</pre>
                  </el-tab-pane>
                  <el-tab-pane label="洗稿文本" name="polished">
                    <div class="chapter-bar">
                      <el-button size="small" @click="autoSplitChapters(editRow)">自动分章</el-button>
                      <el-button size="small" @click="addChapter(editRow)">添加章节</el-button>
                      <el-button v-if="(rowTranscript(editRow)?.chapters || []).length" size="small" type="danger" plain @click="clearChapters(editRow)">清除章节</el-button>
                    </div>
                    <template v-if="rowTranscript(editRow).polishedParagraphs && rowTranscript(editRow).polishedParagraphs.length">
                      <div class="transcript-segs drawer-transcript">
                        <template v-for="entry in polishedRows(editRow)" :key="entry.para ? entry.para.hash : `ch-${entry.ord}`">
                          <div v-if="entry.type === 'chapter'" class="chapter-head">
                            <span class="chapter-title">{{ entry.title }}</span>
                            <el-button link size="small" @click="renameChapter(editRow, entry.ord)">改名</el-button>
                            <el-button link type="danger" size="small" @click="deleteChapter(editRow, entry.ord)">删除章节</el-button>
                          </div>
                          <div v-else class="transcript-seg paragraph-block">
                            <div class="paragraph-meta">
                              <el-tag
                                v-if="entry.para.speaker !== null && entry.para.speaker !== undefined"
                                class="speaker-tag"
                                size="small"
                                effect="plain"
                                @click="renameSpeaker(editRow, entry.para.speaker)"
                              >
                                {{ speakerLabel(editRow, entry.para.speaker) }}
                              </el-tag>
                              <el-button class="time-link" link type="primary" size="small" @click="seekEditAudio(editRow, entry.para.start)">
                                {{ formatTimestamp(entry.para.start) }}
                              </el-button>
                              <el-tag v-if="entry.para.edited" size="small" type="warning" effect="light">已编辑</el-tag>
                              <span class="paragraph-hash">#{{ entry.para.hash.slice(0, 6) }}</span>
                              <el-button class="paragraph-edit" :icon="EditPen" link size="small" @click="openPolishEdit(editRow, entry.para)">编辑</el-button>
                            </div>
                            <div class="paragraph-content">{{ entry.para.content || '（本段清洗后为空）' }}</div>
                          </div>
                        </template>
                      </div>
                    </template>
                    <pre v-else class="transcript-text">{{ rowTranscript(editRow).polished }}</pre>
                  </el-tab-pane>
                </el-tabs>
              </template>
            </template>
          </div>

          <div v-else-if="editDrawerTab === 'settings'">
            <el-form label-position="top">
              <el-form-item label="转写起点（秒）">
                <el-input-number
                  v-model="editTrimStart"
                  :min="0"
                  :max="14400"
                  :step="1"
                  style="width: 160px"
                />
                <div class="muted field-hint">
                  转写从该时间开始，跳过片头精华；例如设 9 表示从「各位网友大家好」开始
                </div>
              </el-form-item>
            </el-form>
            <el-button type="primary" @click="saveEdit">保存</el-button>
          </div>
          <div v-else-if="editDrawerTab === 'glossary'">
            <GlossaryManager :video-id="editRow.id" />
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- 添加抽屉 -->
    <el-drawer
      v-model="addOpen"
      title="添加视频"
      size="480px"
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <el-form-item label="视频类型">
          <el-radio-group v-model="addVideoType">
            <el-radio value="live">直播连麦</el-radio>
            <el-radio value="solo">个人录屏</el-radio>
            <el-radio value="unknown">未知</el-radio>
          </el-radio-group>
          <div class="muted field-hint">直播连麦会做讲述人确认与分离；个人录屏跳过分离更快</div>
        </el-form-item>
        <el-form-item label="视频网址">
          <el-input
            v-model="videoUrls"
            type="textarea"
            :rows="5"
            placeholder="每行一个哔哩哔哩视频网址，可批量粘贴，例如 https://www.bilibili.com/video/BV..."
          />
          <el-button
            size="small"
            class="detect-parts"
            :loading="detecting"
            :disabled="!videoUrls"
            @click="detectParts"
          >
            探测分P（多P自动拆分）
          </el-button>
        </el-form-item>
        <el-button type="primary" :loading="adding" :disabled="!videoUrls" @click="add">添加</el-button>
      </el-form>
    </el-drawer>

    <!-- 洗稿段落编辑抽屉 -->
    <el-drawer
      v-model="polishOpen"
      title="编辑洗稿段落"
      size="480px"
      :close-on-click-modal="false"
    >
      <template v-if="polishEdit">
        <div class="muted polish-meta">
          讲述人：{{ polishEdit.speakerLabel }} · 段落 #{{ polishEdit.hash.slice(0, 6) }}
          <span v-if="polishEdit.start !== null">· {{ formatTimestamp(polishEdit.start) }}</span>
        </div>
        <el-input
          v-model="polishContent"
          type="textarea"
          :rows="10"
        />
        <div class="drawer-actions">
          <el-button type="primary" @click="savePolishEdit">保存</el-button>
          <el-button v-if="polishEdit.edited" @click="resetPolishEdit">恢复默认</el-button>
          <el-button @click="polishOpen = false">取消</el-button>
        </div>
        <p class="muted">段落 hash 与原始文本关联，手动编辑不会丢失对应关系。</p>
      </template>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, EditPen, Plus } from '@element-plus/icons-vue'
import {
  addVideos,
  artifactUrl,
  deleteVideo,
  getProject,
  getTranscript,
  getVideoParts,
  renameVideo,
  setNumSpeakers,
  setSpeakerName,
  triggerJob,
  request,
} from '../api.js'
import GlossaryManager from '../components/GlossaryManager.vue'

const route = useRoute()

const project = ref(null)
const videos = ref([])
const videoUrls = ref('')
const adding = ref(false)
const detecting = ref(false)
const addVideoType = ref('live')
const transcripts = reactive({})
const tabState = reactive({})
const audioRefs = reactive({})
const expandedId = ref(null)
const selectedRows = ref([])
const tableRef = ref(null)
const editOpen = ref(false)
const editRow = ref(null)
const editName = ref('')
const editNumSpeakers = ref(0)
const addOpen = ref(false)
const polishOpen = ref(false)
const polishEdit = ref(null)
const polishContent = ref('')

const voiceSamples = ref([])
const sampleNames = reactive({})
const samplesConfirmedFlag = ref(false)
const sampling = ref(false)
const editVideoType = ref('unknown')
const editTrimStart = ref(0)
const editDrawerTab = ref('basic')
// 查看模式(点空白可关)与编辑模式(点空白不可关,防误触丢编辑)共用同一个抽屉
const editMaskClosable = ref(false)
// 编辑抽屉「文本」页签:音频播放器 + 原始/洗稿两个子页签,交互与展开区完全相同
const editTextTab = ref('raw')
const editAudioRefs = reactive({})
const calibrateAudioRefs = reactive({})
const page = ref(1)
const pageSize = ref(10)

const pagedVideos = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return videos.value.slice(start, start + pageSize.value)
})

// 声明式展开：轮询替换数据后 el-table 依据 expand-row-keys 恢复展开态，不再依赖命令式重放
const expandedRowKeys = computed(() => (expandedId.value === null ? [] : [String(expandedId.value)]))

let pollTimer = null
let lastPayload = ''

async function refresh() {
  try {
    const data = await getProject(route.params.id)
    project.value = data.project
    const payload = JSON.stringify(data.videos)
    if (payload !== lastPayload) {
      lastPayload = payload
      const maxPage = Math.max(1, Math.ceil(data.videos.length / pageSize.value))
      if (page.value > maxPage) page.value = maxPage
      videos.value = data.videos
      if (editRow.value) {
        const fresh = data.videos.find((video) => video.id === editRow.value.id)
        if (fresh) editRow.value = fresh
      }
      samplesConfirmedFlag.value = data.videos.some(
        (video) => video.id === editRow.value?.id && video.samplesConfirmed,
      ) || samplesConfirmedFlag.value
    }
  } catch (err) {
    ElMessage.error(err.message)
  }
}

function startPolling() {
  stopPolling()
  refresh()
  pollTimer = setInterval(refresh, 1500)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function displayTitle(video) {
  return video.displayName || video.title || video.url
}

function bvId(video) {
  const match = /BV[0-9A-Za-z]+/.exec(video.url || '')
  return match ? match[0] : null
}

function formatDuration(seconds) {
  const total = Number(seconds)
  if (!Number.isFinite(total) || total <= 0) return '—'
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.round(total % 60)
  const pad = (value) => String(value).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function busy(video) {
  return ['queued', 'downloading', 'transcribing'].includes(video.status)
}

function statusLabel(status) {
  const labels = {
    idle: '未处理',
    queued: '排队中',
    downloading: '下载中',
    transcribing: '转写中',
    audioReady: '音频就绪',
    done: '已完成',
    failed: '已失败',
  }
  return labels[status] || status
}

function tagType(status) {
  const types = {
    done: 'success',
    failed: 'danger',
    audioReady: 'primary',
    downloading: 'warning',
    transcribing: 'warning',
    queued: 'info',
  }
  return types[status] || 'info'
}

function rowTranscript(row) {
  return transcripts[row.id]
}

function audioUrl(videoId) {
  return `/api/videos/${videoId}/audio`
}

function setAudioRef(videoId, el) {
  if (el) audioRefs[videoId] = el
}

function seekAudio(row, start) {
  const audio = audioRefs[row.id]
  if (!audio) {
    ElMessage.info('请先展开原始文本的音频播放器')
    return
  }
  audio.currentTime = Number(start) || 0
  audio.play()
}

function setEditAudioRef(videoId, el) {
  if (el) editAudioRefs[videoId] = el
  else delete editAudioRefs[videoId]
}

// 「校准讲述人」页签自己的播放器:试听样本用它
function setCalibrateAudioRef(videoId, el) {
  if (el) calibrateAudioRefs[videoId] = el
  else delete calibrateAudioRefs[videoId]
}

// 编辑抽屉内的时间戳跳转:使用抽屉自己的播放器
function seekEditAudio(row, start) {
  const audio = editAudioRefs[row.id]
  if (!audio) {
    ElMessage.info('请先在文本页签打开音频播放器')
    return
  }
  audio.currentTime = Number(start) || 0
  audio.play()
}

async function copyEditTranscript() {
  const data = transcripts[editRow.value.id]
  if (!data) return
  const content = editTextTab.value === 'raw' ? data.text : data.polished
  if (content) await navigator.clipboard.writeText(content)
  ElMessage.success('已复制')
}

function onSelectionChange(rows) {
  selectedRows.value = rows
}

// 表格自带展开箭头接管展开:同步声明式展开态,展开时拉取最新转写
function onExpandChange(row, expandedRows) {
  const isOpen = expandedRows.some((item) => item.id === row.id)
  if (isOpen && expandedId.value !== row.id) {
    expandedId.value = row.id
    loadTranscript(row)
  } else if (!isOpen && expandedId.value === row.id) {
    expandedId.value = null
  }
}

async function loadTranscript(row) {
  try {
    transcripts[row.id] = await getTranscript(row.id)
    if (!tabState[row.id]) tabState[row.id] = 'raw'
  } catch (err) {
    transcripts[row.id] = {
      text: `读取失败：${err.message}`,
      polished: '',
      paragraphs: [],
      polishedParagraphs: [],
      segments: [],
      speakers: [],
    }
  }
}

async function openEditDrawer(row, tab = 'basic', maskClosable = false) {
  editMaskClosable.value = maskClosable
  editRow.value = row
  editName.value = row.displayName || ''
  editNumSpeakers.value = row.numSpeakers || 0
  editVideoType.value = row.videoType || 'unknown'
  editTrimStart.value = row.trimStartSeconds ?? 0
  editDrawerTab.value = tab
  editTextTab.value = 'raw'
  editOpen.value = true
  if (row.hasAudio) await loadVoiceSamples(row)
  // 每次打开都重新拉取,保证改名与洗稿编辑后的文本是最新的
  if (row.hasTranscript) await loadTranscript(row)
}

async function loadVoiceSamples(row) {
  try {
    const data = await request(`/api/videos/${row.id}/voice-samples`)
    voiceSamples.value = data.samples || []
    samplesConfirmedFlag.value = Boolean(data.confirmed)
    // 回显已入库的讲述人名字:没有回显会让人误以为校对没有保存
    const speakers = await request(`/api/videos/${row.id}/speakers`)
    for (const speaker of speakers.speakers || []) {
      if (sampleNames[speaker.spk] === undefined || sampleNames[speaker.spk] === '') {
        sampleNames[speaker.spk] = speaker.name
      }
    }
  } catch {
    voiceSamples.value = []
  }
}

async function resample() {
  const row = editRow.value
  if (!row) return
  sampling.value = true
  try {
    await request(`/api/videos/${row.id}/voice-samples/resample`, { method: 'POST' })
    // 轮询样本就绪
    const timer = setInterval(async () => {
      const data = await request(`/api/videos/${row.id}/voice-samples`)
      if (data.samples && data.samples.length > 0) {
        clearInterval(timer)
        sampling.value = false
        voiceSamples.value = data.samples
        samplesConfirmedFlag.value = Boolean(data.confirmed)
        ElMessage.success('声纹样本已就绪')
      }
    }, 3000)
  } catch (err) {
    sampling.value = false
    ElMessage.error(err.message)
  }
}

async function confirmSamples() {
  const row = editRow.value
  if (!row) return
  const names = {}
  for (const sample of voiceSamples.value) {
    const name = (sampleNames[sample.idx] || '').trim()
    if (name) names[sample.idx] = name
  }
  try {
    await request(`/api/videos/${row.id}/voice-samples/confirm`, {
      method: 'PUT',
      body: JSON.stringify({ names }),
    })
    samplesConfirmedFlag.value = true
    ElMessage.success('讲述人已确认,重新转写后按此纠正归属')
    await refresh()
  } catch (err) {
    ElMessage.error(err.message)
  }
}

async function playSample(row, sample) {
  const audio = calibrateAudioRefs[row.id]
  if (!audio) {
    ElMessage.info('音频播放器不可用')
    return
  }
  audio.currentTime = sample.start
  audio.play()
  const stopAt = sample.end
  const stopper = () => {
    if (audio.currentTime >= stopAt) {
      audio.pause()
      audio.removeEventListener('timeupdate', stopper)
    }
  }
  audio.addEventListener('timeupdate', stopper)
}

function needsConfirm(row) {
  return (
    (row.videoType || 'unknown') !== 'solo' &&
    row.hasAudio &&
    !row.samplesConfirmed
  )
}

async function saveEdit() {
  const row = editRow.value
  if (!row) return
  try {
    if ((row.displayName || '') !== editName.value) {
      await renameVideo(row.id, editName.value)
    }
    if ((row.numSpeakers || 0) !== editNumSpeakers.value) {
      await setNumSpeakers(row.id, editNumSpeakers.value)
    }
    if ((row.videoType || 'unknown') !== editVideoType.value) {
      await request(`/api/videos/${row.id}/video-type`, {
        method: 'PUT',
        body: JSON.stringify({ videoType: editVideoType.value }),
      })
    }
    if ((row.trimStartSeconds ?? 0) !== editTrimStart.value) {
      await request(`/api/videos/${row.id}/trim-start`, {
        method: 'PUT',
        body: JSON.stringify({ seconds: editTrimStart.value }),
      })
    }
    editOpen.value = false
    ElMessage.success('已保存')
    await refresh()
  } catch (err) {
    ElMessage.error(err.message)
  }
}

async function renameTitle(row) {
  try {
    const { value } = await ElMessageBox.prompt(
      `原抓取标题：${row.title || row.url}`,
      '重命名视频',
      {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue: row.displayName || '',
      },
    )
    await renameVideo(row.id, value.trim())
    ElMessage.success('已重命名')
    await refresh()
  } catch {
    // 用户取消
  }
}

async function changeNumSpeakers(row, count) {
  try {
    await setNumSpeakers(row.id, count)
    row.numSpeakers = count
  } catch (err) {
    ElMessage.error(err.message)
  }
}

async function renameSpeaker(row, spk) {
  const current = speakerLabel(row, spk)
  const fallback = `说话人${spk + 1}`
  try {
    const { value } = await ElMessageBox.prompt(
      `修改讲述人名称（当前：${current}）`,
      '讲述人改名',
      {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue: current === fallback ? '' : current,
      },
    )
    const trimmed = value.trim()
    if (!trimmed) return
    await setSpeakerName(row.id, spk, trimmed)
    transcripts[row.id] = await getTranscript(row.id)
    ElMessage.success('讲述人已改名')
  } catch {
    // 用户取消
  }
}

function speakerLabel(row, spk) {
  const data = transcripts[row.id]
  const found = data && data.speakers
    ? data.speakers.find((item) => item.spk === spk)
    : null
  return found && found.name ? found.name : `说话人${spk + 1}`
}

async function copyTranscript(row) {
  const data = transcripts[row.id]
  if (!data) return
  const tab = tabState[row.id] || 'raw'
  const content = tab === 'raw' ? data.text : data.polished
  if (content) await navigator.clipboard.writeText(content)
  ElMessage.success('已复制')
}

// 章节:把洗稿段落按 hash 区间组织,标题可改名
function rowChapters(row) {
  return transcripts[row.id]?.chapters || []
}

function polishedRows(row) {
  const data = transcripts[row.id]
  const paras = data?.polishedParagraphs || []
  const chapters = data?.chapters || []
  const starts = new Map(chapters.map((chapter) => [chapter.hashStart, chapter]))
  const out = []
  for (const para of paras) {
    const chapter = starts.get(para.hash)
    if (chapter) {
      out.push({ type: 'chapter', ord: chapter.ord, title: chapter.title })
    }
    out.push({ type: 'para', para })
  }
  return out
}

async function saveChapters(row, chapters) {
  await request(`/api/videos/${row.id}/chapters`, {
    method: 'PUT',
    body: JSON.stringify({
      chapters: chapters.map((chapter, ord) => ({
        ord,
        hashStart: chapter.hashStart,
        hashEnd: chapter.hashEnd,
        title: chapter.title,
      })),
    }),
  })
  await loadTranscript(row)
}

function autoSplitChapters(row) {
  const data = transcripts[row.id]
  const paras = data?.polishedParagraphs || []
  if (paras.length === 0) {
    ElMessage.info('还没有洗稿段落')
    return
  }
  const CHUNK = 15
  const chapters = []
  let current = { hashStart: paras[0].hash, hashEnd: paras[0].hash }
  let count = 1
  for (let i = 1; i < paras.length; i += 1) {
    if (count >= CHUNK) {
      current.title = `章节 ${chapters.length + 1}：${paras[i - 1].content.slice(0, 12)}…`
      chapters.push(current)
      current = { hashStart: paras[i].hash, hashEnd: paras[i].hash }
      count = 0
    }
    current.hashEnd = paras[i].hash
    count += 1
  }
  current.title = `章节 ${chapters.length + 1}：${paras[paras.length - 1].content.slice(0, 12)}…`
  chapters.push(current)
  saveChapters(row, chapters)
  ElMessage.success(`已按每 ${CHUNK} 段自动分成 ${chapters.length} 章，可改名`)
}

function addChapter(row) {
  const data = transcripts[row.id]
  const paras = data?.polishedParagraphs || []
  if (paras.length === 0) return
  const chapters = rowChapters(row).map((chapter) => ({ ...chapter }))
  chapters.push({ hashStart: paras[0].hash, hashEnd: paras[paras.length - 1].hash, title: `章节 ${chapters.length + 1}` })
  saveChapters(row, chapters)
}

async function renameChapter(row, ord) {
  const chapters = rowChapters(row)
  const chapter = chapters.find((item) => item.ord === ord)
  if (!chapter) return
  try {
    const { value } = await ElMessageBox.prompt('章节名称', '章节改名', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: chapter.title,
    })
    chapter.title = value.trim() || chapter.title
    await saveChapters(row, chapters)
  } catch {
    // 用户取消
  }
}

async function deleteChapter(row, ord) {
  const chapters = rowChapters(row).filter((item) => item.ord !== ord)
  await saveChapters(row, chapters)
}

async function clearChapters(row) {
  chaptersState[row.id] = []
  await request(`/api/videos/${row.id}/chapters`, {
    method: 'PUT',
    body: JSON.stringify({ chapters: [] }),
  })
  ElMessage.success('章节已清除')
}

async function triggerJobAction(row, kind) {
  try {
    await triggerJob(row.id, kind)
    ElMessage.success('任务已加入队列')
    await refresh()
  } catch (err) {
    ElMessage.error(err.message)
  }
}

async function removeVideo(row) {
  try {
    await ElMessageBox.confirm(
      `删除「${displayTitle(row)}」及其音频与转写产物？`,
      '删除视频',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await deleteVideo(row.id)
    ElMessage.success('已删除')
    await refresh()
  } catch (err) {
    ElMessage.error(err.message)
  }
}

function onBatchCommand(command) {
  if (command === 'delete') batchDelete()
  if (command === 'download') batchDownloadText()
}

async function batchDelete() {
  const targets = [...selectedRows.value]
  if (targets.length === 0) return
  try {
    await ElMessageBox.confirm(
      `批量删除 ${targets.length} 个视频及其音频与转写产物？`,
      '批量删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  for (const row of targets) {
    try {
      await deleteVideo(row.id)
    } catch (err) {
      ElMessage.error(err.message)
    }
  }
  tableRef.value.clearSelection()
  await refresh()
}

function batchDownloadText() {
  const targets = selectedRows.value.filter((row) => row.hasTranscript)
  if (targets.length === 0) {
    ElMessage.warning('所选视频没有已完成的转写文本')
    return
  }
  targets.forEach((row, index) => {
    setTimeout(() => {
      const anchor = document.createElement('a')
      anchor.href = artifactUrl(row.id, 'txt')
      anchor.download = ''
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    }, index * 400)
  })
}

function openAddDrawer() {
  addOpen.value = true
}

async function detectParts() {
  const url = videoUrls.value.split('\n').map((line) => line.trim()).filter(Boolean)[0]
  if (!url) return
  detecting.value = true
  try {
    const data = await getVideoParts(url)
    if (!data.parts || data.parts.length === 0) {
      ElMessage.info('该视频没有多分P，无需拆分')
      return
    }
    videoUrls.value = data.parts.map((part) => part.url).join('\n')
    ElMessage.success(`已拆分为 ${data.parts.length} 个分P，请检查后添加`)
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    detecting.value = false
  }
}

async function add() {
  const urls = videoUrls.value.split('\n').map((line) => line.trim()).filter(Boolean)
  if (urls.length === 0) return
  adding.value = true
  try {
    const result = await addVideos(project.value.id, urls, addVideoType.value)
    videoUrls.value = ''
    addOpen.value = false
    if (result.errors && result.errors.length > 0) {
      ElMessage.warning(
        `部分网址未添加：${result.errors.map((item) => `${item.url}（${item.message}）`).join('；')}`,
      )
    } else {
      ElMessage.success(`已添加 ${result.added.length} 个视频`)
    }
    await refresh()
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    adding.value = false
  }
}

// 词汇表
// 洗稿段落编辑
function openPolishEdit(row, para) {
  polishEdit.value = {
    videoId: row.id,
    hash: para.hash,
    speakerLabel:
      para.speaker !== null && para.speaker !== undefined
        ? speakerLabel(row, para.speaker)
        : '（无讲述人）',
    start: para.start,
    edited: para.edited,
  }
  polishContent.value = para.content
  polishOpen.value = true
}

async function savePolishEdit() {
  const edit = polishEdit.value
  if (!edit) return
  try {
    await request(`/api/videos/${edit.videoId}/polished`, {
      method: 'PUT',
      body: JSON.stringify({ hash: edit.hash, content: polishContent.value }),
    })
    polishOpen.value = false
    ElMessage.success('洗稿段落已保存')
    const row = videos.value.find((video) => video.id === edit.videoId)
    if (row) await loadTranscript(row)
  } catch (err) {
    ElMessage.error(err.message)
  }
}

async function resetPolishEdit() {
  const edit = polishEdit.value
  if (!edit) return
  try {
    await request(`/api/videos/${edit.videoId}/polished/${edit.hash}`, { method: 'DELETE' })
    polishOpen.value = false
    ElMessage.success('已恢复默认洗稿')
    const row = videos.value.find((video) => video.id === edit.videoId)
    if (row) await loadTranscript(row)
  } catch (err) {
    ElMessage.error(err.message)
  }
}

watch(
  () => route.params.id,
  () => {
    page.value = 1
    expandedId.value = null
    startPolling()
  },
  { immediate: true },
)
watch(pageSize, () => {
  page.value = 1
})
onUnmounted(stopPolling)
</script>

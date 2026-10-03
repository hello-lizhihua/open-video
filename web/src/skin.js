// 皮肤:一次性在 main.js 引入本模块完成设置;组件只绑定此处导出的状态。
import { ref, watch } from 'vue'

export const skinOptions = [
  { label: '明亮蓝 · 浅', value: 'blue-light' },
  { label: '明亮蓝 · 深', value: 'blue-dark' },
  { label: '清新粉 · 浅', value: 'pink-light' },
  { label: '清新粉 · 深', value: 'pink-dark' },
]

const saved = localStorage.getItem('app-skin')
export const skin = ref(saved || 'pink-light')

function apply(value) {
  const [name, mode] = value.split('-')
  document.documentElement.dataset.skin = name
  document.documentElement.classList.toggle('dark', mode === 'dark')
  localStorage.setItem('app-skin', value)
}

watch(skin, apply, { immediate: true })

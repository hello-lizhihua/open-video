import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import '@hello-lizhihua/element-plus/skins/blue-light.css'
import '@hello-lizhihua/element-plus/skins/blue-dark.css'
import '@hello-lizhihua/element-plus/skins/pink-light.css'
import '@hello-lizhihua/element-plus/skins/pink-dark.css'
import '@hello-lizhihua/element-plus/components/index.css'
// 皮肤在 main.js 一次性设置:导入即按保存值(默认 pink-light)挂载 data-skin 与明暗类
import './skin.js'
import App from './App.vue'
import router from './router.js'
import './styles.css'

createApp(App).use(router).use(ElementPlus, { locale: zhCn }).mount('#app')

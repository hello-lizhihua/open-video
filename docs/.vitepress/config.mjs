import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'open-video',
  description: '本地视频转文本管理系统：哔哩哔哩音频下载 + 本地语音转写 + 说话人分离',
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/installation' },
      { text: '使用指南', link: '/guide/usage' },
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '安装', link: '/guide/installation' },
          { text: '使用指南', link: '/guide/usage' },
        ],
      },
    ],
    outline: [2, 3],
    docFooter: { prev: '上一页', next: '下一页' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
  },
})

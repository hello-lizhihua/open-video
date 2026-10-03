---
layout: home

hero:
  name: open-video
  text: 本地视频转文本管理系统
  tagline: 哔哩哔哩音频下载 + 本地语音转写 + 说话人分离，数据不出本机
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/installation
    - theme: alt
      text: 使用指南
      link: /guide/usage

features:
  - title: 本地语音转写
    details: 基于 SenseVoice int8 模型（sherpa-onnx），约 60 倍实时速率，不依赖在线语音服务。
  - title: 说话人分离与校准
    details: 多人对谈自动分人；声纹采样、试听命名、确认后重新转写即纠正全片归属。
  - title: 长音频并行加速
    details: 自动分块并行转写（默认 300 秒块 + 20 秒接缝），两小时播客约十几分钟完成。
  - title: 结构化转写文档
    details: 段落 hash + 讲述人 + 时间戳，原始与洗稿文本一一对应，支持手动修订与章节。
  - title: 两级词汇表
    details: 全局词汇表按分类管理、跨视频生效；视频级继承全局词条，并可添加专属词条。
  - title: 测试用例与测试组
    details: 使用前 / 使用后对照验证识别效果，测试组整合多个时间段一起验证。
---

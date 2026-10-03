<template>
  <section class="page glossary-page">
    <div class="page-head">
      <div class="page-head-left">
        <h2 class="page-title">词汇表</h2>
        <span class="muted">全局词汇表跨视频生效；左侧选分类，右侧管理词条</span>
      </div>
    </div>
    <div class="table-wrap glossary-wrap">
      <GlossaryManager />
    </div>
  </section>
</template>

<script setup>
import GlossaryManager from '../components/GlossaryManager.vue'
</script>

<style scoped>
.glossary-wrap {
  padding: 14px;
}
</style>

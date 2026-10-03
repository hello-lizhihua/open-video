import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import ProjectDetailPage from './views/ProjectDetailPage.vue'
import TestCasesPage from './views/TestCasesPage.vue'
import GlobalGlossaryPage from './views/GlobalGlossaryPage.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/projects', component: HomeView },
    { path: '/projects/:id', component: ProjectDetailPage },
    { path: '/test-cases', component: TestCasesPage },
    { path: '/glossary', component: GlobalGlossaryPage },
  ],
})

export default router

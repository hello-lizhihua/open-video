export async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...options,
  })
  if (!response.ok) {
    let message = `请求失败(${response.status})`
    try {
      const body = await response.json()
      if (body && body.error) message = body.error
    } catch {
      // 保留默认错误信息
    }
    throw new Error(message)
  }
  return response.json()
}

export function listProjects() {
  return request('/api/projects')
}

export function createProject(name) {
  return request('/api/projects', { method: 'POST', body: JSON.stringify({ name }) })
}

export function deleteProject(id) {
  return request(`/api/projects/${id}`, { method: 'DELETE' })
}

export function updateProject(id, name) {
  return request(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })
}

export function getProject(id) {
  return request(`/api/projects/${id}`)
}

export function addVideo(projectId, url) {
  return request(`/api/projects/${projectId}/videos`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}

export function addVideos(projectId, urls, videoType) {
  return request(`/api/projects/${projectId}/videos`, {
    method: 'POST',
    body: JSON.stringify({ urls, videoType }),
  })
}

export function getVideoParts(url) {
  return request(`/api/video-parts?url=${encodeURIComponent(url)}`)
}

export function getSettings() {
  return request('/api/settings')
}

export function saveSettings(cookie) {
  return request('/api/settings', { method: 'PUT', body: JSON.stringify({ cookie }) })
}

export function deleteVideo(videoId) {
  return request(`/api/videos/${videoId}`, { method: 'DELETE' })
}

export function triggerJob(videoId, kind) {
  return request(`/api/videos/${videoId}/jobs`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  })
}

export function getTranscript(videoId) {
  return request(`/api/videos/${videoId}/transcript`)
}

export function setSpeakerName(videoId, spk, name) {
  return request(`/api/videos/${videoId}/speakers`, {
    method: 'PUT',
    body: JSON.stringify({ spk, name }),
  })
}

export function setNumSpeakers(videoId, count) {
  return request(`/api/videos/${videoId}/num-speakers`, {
    method: 'PUT',
    body: JSON.stringify({ count }),
  })
}

export function renameVideo(videoId, name) {
  return request(`/api/videos/${videoId}/name`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
}

export function artifactUrl(videoId, ext) {
  return `/api/videos/${videoId}/artifacts/${ext}`
}

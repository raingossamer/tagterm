/**
 * 会话列表镜像：主进程是真相源，load() 拉取一次并订阅 session:changed 全量替换；
 * action 只调 SDK，不本地改数组。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CreateSessionInput, SessionPatch } from '@shared/ipc'
import type { Session } from '@shared/models'
import type { Unsubscribe } from '@shared/api'

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<Session[]>([])
  let unsubscribe: Unsubscribe | null = null

  const count = computed(() => sessions.value.length)
  const byId = (id: string): Session | undefined => sessions.value.find((s) => s.id === id)

  async function load(): Promise<void> {
    unsubscribe?.()
    unsubscribe = window.tagterm.session.onChanged((list) => {
      sessions.value = list
    })
    sessions.value = await window.tagterm.session.list()
  }

  function create(input: CreateSessionInput): Promise<Session> {
    return window.tagterm.session.create(input)
  }

  function update(id: string, patch: SessionPatch): Promise<Session> {
    return window.tagterm.session.update(id, patch)
  }

  function remove(id: string): Promise<void> {
    return window.tagterm.session.remove(id)
  }

  return { sessions, count, byId, load, create, update, remove }
})
